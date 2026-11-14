"""
Chatbot endpoints: answers natural-language questions about library data,
and (for librarians only) lets them perform basic circulation actions.

Trust levels served here:

  - HOD: full READ access to all curated views via free-form model-generated
    SQL (STAFF_ALLOWED_VIEWS). No actions.

  - Librarian: everything the HOD has, PLUS three "propose" tools for
    issuing, returning and renewing books. Those tools never change
    anything — they only look the request up and return a preview. The
    librarian has to press Confirm in the chat, which calls a separate
    endpoint (/api/chatbot/execute-action) that verifies the caller really
    is a librarian account and then runs the app's EXISTING issue / return /
    renew logic, so every existing rule (blocked students, overdue renewal
    limits, waiting queues, fines) applies exactly as it does in the normal
    UI. The model never executes anything itself.

  - Librarian, per-student menu: typing a student's roll number returns the
    operations possible for that student right now (issue, return, renew,
    collect fine, resolve lost/damaged, NOC, summary) via
    /api/chatbot/student-menu. Choosing one walks through
    /api/chatbot/student-flow step by step, and the last step is the same
    Confirm card. The menu and the flow compute availability from the
    database directly, not from the model.

  - Student: two read-only tools. "run_catalog_query" (public catalog views
    only) and "get_my_library_status" (fixed query scoped to the student's
    own roll number — never model-controlled).

Safety model (defense in depth):
  1. DB-level: model-generated SQL runs as "chatbot_ro", a Postgres role
     with SELECT granted only on the curated views — no write privileges.
  2. App-level: every model-generated query is validated before running
     (single SELECT/WITH, no write/DDL keywords, no comments, only
     allowlisted views for the current role).
  3. Actions are propose-then-confirm; writes only happen in
     /api/chatbot/execute-action, never from a model tool call.
  4. Only "librarian", "hod" and "student" roles can call the ask endpoint,
     and only librarians can propose or execute actions.
"""
import json
import logging
import os
import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import create_engine, func, or_, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session

import models
from config import MAX_FREE_RENEWALS, RENEWAL_EARLY_DAYS, RENEWAL_WINDOW_DAYS
from database import get_db
from models import AccountStatus, CopyStatus, NotificationStatus, RoleEnum
import auth

logger = logging.getLogger("chatbot")

router = APIRouter()
# Routes below require a valid, approved login (see auth.get_current_user).
protected = APIRouter(dependencies=[Depends(auth.get_current_user)])

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
CHATBOT_MODEL = os.environ.get("OPENAI_CHATBOT_MODEL", "gpt-4.1-nano")

DATABASE_URL = os.environ.get("DATABASE_URL", "")
CHATBOT_DB_PASSWORD = os.environ.get("CHATBOT_DB_PASSWORD", "")
CHATBOT_STUDENT_DB_PASSWORD = os.environ.get("CHATBOT_STUDENT_DB_PASSWORD", "")

ALLOWED_ROLES = {"librarian", "hod", "student"}

# Librarian / HOD can query any of these.
STAFF_ALLOWED_VIEWS = {
    "v_books", "v_book_copies", "v_fines", "v_users", "v_book_requests",
    "v_override_requests", "v_course_limits", "v_book_history",
    "v_announcements", "v_broadcast_messages",
}

# Students can only run free-form SQL against these — nothing here exposes
# any other person's private data. Their own borrowed books/fines/history
# are answered through get_my_library_status instead, never through this path.
STUDENT_ALLOWED_VIEWS = {
    "v_books", "v_course_limits", "v_announcements", "v_broadcast_messages",
}

FORBIDDEN_KEYWORDS = [
    "insert", "update", "delete", "drop", "alter", "grant", "revoke",
    "truncate", "create", "copy", "execute", "call", "vacuum", "reindex",
    "into", "merge", "replace",
]

MAX_ROWS = 50

RUN_SQL_TOOL_NAME = "run_sql_query"
RUN_CATALOG_TOOL_NAME = "run_catalog_query"
MY_STATUS_TOOL_NAME = "get_my_library_status"
PROPOSE_ISSUE_TOOL_NAME = "propose_issue_book"
PROPOSE_RETURN_TOOL_NAME = "propose_return_book"
PROPOSE_RENEW_TOOL_NAME = "propose_renew_book"
PROPOSE_TOOL_NAMES = {
    PROPOSE_ISSUE_TOOL_NAME, PROPOSE_RETURN_TOOL_NAME, PROPOSE_RENEW_TOOL_NAME,
}


_engines = {}


def _build_chatbot_engine(username: str, password: str):
    """Read-only engine on the same host and database as the main app, logged in
    as a restricted chatbot role. Sessions are also forced read-only at the
    connection level, as a second line of defence after validate_sql."""
    if not password:
        raise RuntimeError("Chatbot database password is not configured.")
    db_url = make_url(DATABASE_URL)
    login = username
    # Supabase's shared pooler requires the project reference suffix on every
    # role name (for example, chatbot_ro.<project-ref>).
    if db_url.host and db_url.host.endswith(".pooler.supabase.com"):
        base_user = db_url.username or ""
        if "." in base_user:
            login = f"{username}.{base_user.rsplit('.', 1)[1]}"
    url = db_url.set(
        drivername="postgresql+psycopg2", username=login, password=password
    )
    engine_options = {
        "pool_pre_ping": True,
        "connect_args": {"options": "-c default_transaction_read_only=on"},
    }
    if os.environ.get("VERCEL"):
        engine_options.update(pool_size=1, max_overflow=0, pool_recycle=300)
    return create_engine(
        url,
        **engine_options,
    )


def _engine_for(username: str, password: str):
    if username not in _engines:
        _engines[username] = _build_chatbot_engine(username, password)
    return _engines[username]


def get_chatbot_engine():
    """Staff-level curated views (librarian and HOD questions)."""
    return _engine_for("chatbot_ro", CHATBOT_DB_PASSWORD)


def get_student_chatbot_engine():
    """Students can reach only the catalogue views granted to chatbot_student_ro."""
    return _engine_for("chatbot_student_ro", CHATBOT_STUDENT_DB_PASSWORD)


STAFF_SCHEMA_DESCRIPTION = """
You answer questions about a library's data by querying read-only SQL
views. You can query ONLY the following views (Postgres). Every column
listed is real — never invent a column or table name that isn't here.

v_books(book_id, book_code, isbn, title, author, subject, courses, edition,
        media_type, book_type, mrp, replacement_cost, total_copies,
        available_copies, is_active, created_at)

v_book_copies(copy_id, copy_code, book_title, book_author, status,
              condition_note, reserved_by_roll, reserved_at,
              reservation_expires_at, issued_to_roll, issued_to_name,
              issued_at, due_date, returned_at, renewal_count, added_at)
  -- status is one of: available, reserved, issued, returned, lost, damaged

v_fines(fine_id, roll_number, total_fine, amount_paid, remaining,
        copy_code, book_title, is_cleared, created_at, updated_at)

v_users(user_id, roll_number, role, is_blocked, is_approved,
        approval_status, department)
  -- role is one of: student, librarian, hod, staff, admin
  -- department is derived from the roll number and may be NULL.
  -- department holds the FULL expanded name, one of exactly these values
  -- (never a short code) — when the user says a short code or informal
  -- name, translate it using this table before filtering:
  --   "CS" / "computer science"        -> 'Computer Science'
  --   "AI" / "ai/ml" / "machine learning" -> 'AI/ML'
  --   "EC" / "ece" / "electronics"      -> 'ECE'
  --   "EE" / "eee" / "electrical"       -> 'EEE'
  --   "ME" / "mechanical"               -> 'Mechanical Engineering'
  --   "CV" / "civil"                    -> 'Civil Engineering'
  --   "BT" / "biotech"                  -> 'Biotechnology'
  -- Always filter with an EXACT match, e.g. department = 'Computer Science'
  -- — never a partial/prefix match like department ILIKE 'cs%', since the
  -- short code never actually appears as a substring of the full name.

v_book_requests(request_id, requested_by_roll, title, author, isbn, reason,
                request_type, status, hod_comment, created_at, reviewed_at)

v_override_requests(request_id, requested_by_roll, reason, affected_record,
                     status, hod_comment, created_at, reviewed_at)

v_course_limits(course_prefix, max_books, updated_at)

v_book_history(history_id, book_title, changed_by_roll, change_type,
               change_detail, changed_at)

v_announcements(announcement_id, title, body, is_active, created_at, expires_at)

v_broadcast_messages(broadcast_id, title, body, target_roles, is_active,
                      created_at, expires_at)

Rules for writing the query:
- You MUST call the run_sql_query tool to answer — never answer from
  memory or guesswork, and never just describe or print a query instead
  of running it.
- Write exactly ONE SELECT (or WITH ... SELECT) statement. Never write
  INSERT/UPDATE/DELETE/DROP/ALTER or any other modifying statement.
- Only reference the views listed above — never the underlying real tables.
- Always compare "today" using CURRENT_DATE / CURRENT_TIMESTAMP, never a
  hardcoded date.
- Keep results small: prefer aggregates (COUNT, SUM, AVG) when the question
  asks "how many" or "how much" rather than returning every matching row.
- If the question genuinely cannot be answered from these views, run a
  trivial query like "SELECT 1 AS na" so the tool still gets called, then
  explain in your final answer what you don't have access to.
"""

LIBRARIAN_ACTIONS_NOTE = """

ADDITIONAL TOOLS FOR THIS USER (a librarian) — circulation actions:
- propose_issue_book, propose_return_book and propose_renew_book let you
  PROPOSE an action. They do not execute anything: the librarian reviews a
  preview and has to confirm it in the chat window.
- Use run_sql_query for questions (reads). Use a propose_* tool INSTEAD of
  run_sql_query whenever the librarian asks you to issue, return/check in,
  or renew a book. The "You MUST call run_sql_query" rule above applies to
  questions only, not to action requests.
- Only pass values the librarian actually stated (copy code, student roll
  number, book title). Never invent or guess a copy code or roll number.
- If the librarian says a returned book is lost or damaged, still call
  propose_return_book and set condition accordingly.
- You cannot do anything else (no deleting, no editing records, no
  recording fine payments). If asked, say that isn't something you can do
  from the chat yet.
"""

STUDENT_SCHEMA_DESCRIPTION = """
You answer a student's questions about the library. You have two tools:

1. run_catalog_query — free-form read-only SQL against these PUBLIC views
   only (Postgres). Use this for anything about the book catalog or public
   notices — never for anything about a specific person.

   v_books(book_id, book_code, isbn, title, author, subject, courses,
           edition, media_type, book_type, mrp, total_copies,
           available_copies, is_active, created_at)

   v_course_limits(course_prefix, max_books, updated_at)

   v_announcements(announcement_id, title, body, is_active, created_at, expires_at)

   v_broadcast_messages(broadcast_id, title, body, target_roles, is_active,
                         created_at, expires_at)

2. get_my_library_status — takes no arguments. Use this for ANYTHING about
   the student's own account. It returns TWO kinds of data together —
   read both before answering, they answer different kinds of question:
     - "current": books issued to them right now, active reservations,
       and any unpaid fines. Use this for "what do I have right now",
       "when is my book due", "do I owe any fines".
     - "history": their ALL-TIME totals — total distinct books ever
       borrowed, total borrow count (a book borrowed twice counts twice),
       and total renewals, ever. Use this for "how many books have I
       read/borrowed", "total books borrowed till date", or anything
       phrased as a lifetime/cumulative count. An empty "current" section
       does NOT mean the history totals are zero — always check "history"
       separately for any lifetime/cumulative question; never answer a
       lifetime question using only the "current" section.

Rules:
- You MUST call one of these tools to answer — never answer from memory.
- For run_catalog_query: write exactly ONE SELECT (or WITH ... SELECT)
  statement, only against the views listed above, never a modifying
  statement, and never any other table or view name.
- Never attempt to look up another student's borrowed books, fines, or
  personal information — you have no tool that can do that, and you
  should say so plainly if asked.
"""

ANSWER_STYLE_INSTRUCTION = """
Now answer the user's original question using the tool results above.

- Give ONLY the direct, natural-language answer. One or two short sentences.
- Do NOT mention SQL, "query used", tables, views, or how you found the
  answer. Do not repeat or paraphrase the query. Just state the answer,
  the way a knowledgeable librarian would say it out loud.
- If the results list multiple items (e.g. books borrowed), give a short
  natural sentence followed by a simple list of the item names — no raw
  column names, no JSON, no code formatting.
- If the result set is empty, say so plainly (e.g. "You don't have any
  books borrowed right now.") — but only for the specific thing that was
  actually asked about; don't imply a lifetime total is zero just because
  nothing is currently active, and vice versa.
"""

RUN_SQL_TOOL = {
    "type": "function",
    "function": {
        "name": RUN_SQL_TOOL_NAME,
        "description": "Run a single read-only SQL SELECT query against the library's data views.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A single SELECT (or WITH...SELECT) statement using only the allowed views.",
                }
            },
            "required": ["query"],
        },
    },
}

RUN_CATALOG_TOOL = {
    "type": "function",
    "function": {
        "name": RUN_CATALOG_TOOL_NAME,
        "description": "Run a single read-only SQL SELECT query against the public catalog views only.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A single SELECT (or WITH...SELECT) statement using only the allowed public views.",
                }
            },
            "required": ["query"],
        },
    },
}

MY_STATUS_TOOL = {
    "type": "function",
    "function": {
        "name": MY_STATUS_TOOL_NAME,
        "description": (
            "Get the current student's own library status: currently-issued books, "
            "active reservations, outstanding fines, AND all-time lifetime totals "
            "(total distinct books ever borrowed, total borrow count, total renewals). "
            "Takes no arguments. Use this for both 'what do I have right now' questions "
            "and 'how many books have I read/borrowed in total' questions."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}

_ACTION_ID_PROPERTIES = {
    "copy_code": {
        "type": "string",
        "description": "Exact physical copy code, e.g. BK-13425678904-260608-01. Only if the user gave one.",
    },
    "book_title": {
        "type": "string",
        "description": "Book title (or part of it). Only if the user gave one.",
    },
}

PROPOSE_ISSUE_TOOL = {
    "type": "function",
    "function": {
        "name": PROPOSE_ISSUE_TOOL_NAME,
        "description": (
            "Propose issuing a book copy to a student. Does NOT execute anything — the "
            "librarian must confirm the preview. Give either copy_code or book_title."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "roll_number": {
                    "type": "string",
                    "description": "Roll number of the student the book is issued to.",
                },
                **_ACTION_ID_PROPERTIES,
            },
            "required": ["roll_number"],
        },
    },
}

PROPOSE_RETURN_TOOL = {
    "type": "function",
    "function": {
        "name": PROPOSE_RETURN_TOOL_NAME,
        "description": (
            "Propose checking a book back in. Does NOT execute anything — the librarian "
            "must confirm the preview. Identify the copy by copy_code, or by the "
            "borrowing student's roll_number and/or book_title."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "roll_number": {
                    "type": "string",
                    "description": "Roll number of the student returning the book, if given.",
                },
                **_ACTION_ID_PROPERTIES,
                "condition": {
                    "type": "string",
                    "enum": ["good", "lost", "damaged"],
                    "description": "Condition of the returned book. Default good.",
                },
            },
        },
    },
}

PROPOSE_RENEW_TOOL = {
    "type": "function",
    "function": {
        "name": PROPOSE_RENEW_TOOL_NAME,
        "description": (
            "Propose renewing an issued book for the student who has it. Does NOT execute "
            "anything — the librarian must confirm the preview. Identify the copy by "
            "copy_code, or by the borrowing student's roll_number and/or book_title."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "roll_number": {
                    "type": "string",
                    "description": "Roll number of the student who has the book, if given.",
                },
                **_ACTION_ID_PROPERTIES,
            },
        },
    },
}

FORCE_STAFF_TOOL_CHOICE = {"type": "function", "function": {"name": RUN_SQL_TOOL_NAME}}


class ChatTurn(BaseModel):
    question: str
    answer: str


class ChatbotRequest(BaseModel):
    question: str
    role: str
    roll_number: Optional[str] = None  # required for role == "student"
    history: Optional[List[ChatTurn]] = None


class PendingAction(BaseModel):
    """A fully-resolved action waiting for the librarian's confirmation."""
    action: str                      # "issue" | "return" | "renew" | "collect_fine" | "resolve_damage"
    copy_code: str
    roll_number: Optional[str] = None
    summary: str
    fine_id: Optional[int] = None    # collect_fine only
    resolution: Optional[str] = None  # resolve_damage only: "replace" | "pay"


class ChatbotResponse(BaseModel):
    answer: str
    sql: Optional[str] = None
    pending_action: Optional[PendingAction] = None


class ExecuteActionRequest(BaseModel):
    action: str
    copy_code: str
    roll_number: Optional[str] = None
    user_id: int                     # the librarian performing the action
    fine_id: Optional[int] = None    # collect_fine
    resolution: Optional[str] = None  # resolve_damage: "replace" | "pay"


class ExecuteActionResponse(BaseModel):
    ok: bool
    message: str


def validate_sql(query: str, allowed_views: set) -> str:
    """Raises ValueError with a human-readable reason if the query isn't
    safe to run. Returns the (possibly LIMIT-appended) query if it is."""
    q = query.strip().rstrip(";").strip()

    if not q:
        raise ValueError("Empty query.")

    first_word = re.match(r"^\s*(\w+)", q)
    first_word = first_word.group(1).lower() if first_word else ""
    if first_word not in ("select", "with"):
        raise ValueError("Only SELECT statements are allowed.")

    if ";" in q:
        raise ValueError("Multiple statements are not allowed.")

    if "--" in q or "/*" in q:
        raise ValueError("Comments are not allowed in the query.")

    lowered = q.lower()
    for kw in FORBIDDEN_KEYWORDS:
        if re.search(rf"\b{kw}\b", lowered):
            raise ValueError(f"The keyword '{kw}' is not allowed.")

    referenced = re.findall(r"\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)", lowered)
    for name in referenced:
        if name not in allowed_views:
            raise ValueError(f"'{name}' is not an accessible table or view.")

    if not re.search(r"\blimit\b", lowered):
        q = f"{q} LIMIT {MAX_ROWS}"

    return q


def run_query(query: str, engine=None):
    engine = engine or get_chatbot_engine()
    with engine.connect() as conn:
        result = conn.execute(text(query))
        rows = result.mappings().all()
        return [dict(row) for row in rows]


def run_my_library_status(roll_number: str):
    """Fixed, parameterized queries scoped to exactly one roll number — the
    model has no way to influence or override which roll number this
    filters on, since it isn't a tool argument at all.

    Returns both CURRENT state (issued/reserved/unpaid fines) and ALL-TIME
    history (total books ever borrowed, renewals) — a student asking "how
    many books have I read" needs the history half, not the current half,
    and the two are easy to conflate if only one is ever fetched.
    """
    engine = get_chatbot_engine()
    # Exact event phrases, so roll "CS001" never matches "CS0012".
    issued_needle = f" issued to {roll_number}."
    renewed_needle = f" renewed by {roll_number}."

    with engine.connect() as conn:
        issued = conn.execute(
            text("""
                SELECT book_title, book_author, copy_code, issued_at, due_date, renewal_count,
                       (due_date < CURRENT_TIMESTAMP) AS overdue
                FROM v_book_copies
                WHERE issued_to_roll = :roll AND status = 'issued'
                LIMIT 20
            """),
            {"roll": roll_number},
        ).mappings().all()

        reserved = conn.execute(
            text("""
                SELECT book_title, book_author, copy_code, reserved_at, reservation_expires_at
                FROM v_book_copies
                WHERE reserved_by_roll = :roll AND status = 'reserved'
                LIMIT 20
            """),
            {"roll": roll_number},
        ).mappings().all()

        fines = conn.execute(
            text("""
                SELECT book_title, total_fine, amount_paid, remaining, created_at
                FROM v_fines
                WHERE roll_number = :roll AND is_cleared = false
                LIMIT 20
            """),
            {"roll": roll_number},
        ).mappings().all()

        # All-time history: v_book_history.changed_by_roll is the STAFF
        # member who performed the action, not the student — so, matching
        # how the rest of this app already links history events to a
        # student, we match the roll number as a substring of the free-text
        # change_detail (e.g. "Issued to PES1UG24CS001 ..."). This is a
        # fixed, hardcoded pattern built from the authenticated request's
        # own roll number — never anything the model supplies.
        issued_events = conn.execute(
            text("""
                SELECT book_title, changed_at
                FROM v_book_history
                WHERE change_type = 'issued' AND POSITION(LOWER(:needle) IN LOWER(change_detail)) > 0
                LIMIT 200
            """),
            {"needle": issued_needle},
        ).mappings().all()

        renewed_events = conn.execute(
            text("""
                SELECT book_title, changed_at
                FROM v_book_history
                WHERE change_type = 'renewed' AND POSITION(LOWER(:needle) IN LOWER(change_detail)) > 0
                LIMIT 200
            """),
            {"needle": renewed_needle},
        ).mappings().all()

        distinct_books = {row["book_title"] for row in issued_events}

        return {
            "current": {
                "issued": [dict(r) for r in issued],
                "reserved": [dict(r) for r in reserved],
                "unpaid_fines": [dict(r) for r in fines],
            },
            "history": {
                "total_distinct_books_ever_borrowed": len(distinct_books),
                "total_times_borrowed_all_time": len(issued_events),
                "total_renewals_all_time": len(renewed_events),
                "distinct_book_titles": sorted(distinct_books),
            },
        }


# ─────────────────────────────────────────────────────────────────────────────
# Librarian actions — step 1: PROPOSE (read-only lookup, builds a preview)
# ─────────────────────────────────────────────────────────────────────────────
#
# Everything below only SELECTs from the curated views, through the same
# read-only chatbot_ro connection as the rest of the chatbot. Nothing here
# can change data. Queries use LOWER(...) LIKE LOWER(...) rather than ILIKE
# so they behave the same on any SQL backend.

_COPY_COLUMNS = (
    "copy_code, book_title, status, issued_to_roll, reserved_by_roll, "
    "due_date, renewal_count, (due_date < CURRENT_TIMESTAMP) AS overdue"
)


def _clean(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def _fmt_date(value):
    if value is None:
        return "unknown"
    if hasattr(value, "strftime"):
        return value.strftime("%d %b %Y")
    return str(value)[:10]


def _like(term: str) -> str:
    return f"%{term}%"


def _find_copy_by_code(conn, code: str):
    return conn.execute(
        text(f"SELECT {_COPY_COLUMNS} FROM v_book_copies WHERE LOWER(copy_code) = LOWER(:c) LIMIT 1"),
        {"c": code},
    ).mappings().first()


def _check_student(conn, roll: str):
    """Returns (canonical_roll, None) if this roll number can be issued
    books, else (None, human-readable reason)."""
    row = conn.execute(
        text("SELECT roll_number, role, is_blocked, is_approved FROM v_users "
             "WHERE LOWER(roll_number) = LOWER(:r) LIMIT 1"),
        {"r": roll},
    ).mappings().first()
    if not row:
        return None, f"I couldn't find an account with roll number {roll}."
    if str(row["role"]).lower() != "student":
        return None, f"{row['roll_number']} isn't a student account, so I can't issue books to it."
    if not row["is_approved"]:
        return None, f"{row['roll_number']}'s account hasn't been approved yet."
    if row["is_blocked"]:
        return None, (f"{row['roll_number']} is currently blocked (pending fines or an unresolved "
                      f"lost/damaged book), so books can't be issued until that's cleared.")
    return row["roll_number"], None


def _resolve_issue(conn, roll: str, copy_code, book_title):
    student_roll, err = _check_student(conn, roll)
    if err:
        return err

    if copy_code:
        copy = _find_copy_by_code(conn, copy_code)
        if not copy:
            return f"I couldn't find a copy with code {copy_code}."
        status = str(copy["status"])
        if status not in ("available", "reserved"):
            return f"Copy {copy['copy_code']} (“{copy['book_title']}”) is {status}, so it can't be issued."
        reserved_for = copy["reserved_by_roll"]
        if status == "reserved" and reserved_for and reserved_for.lower() != student_roll.lower():
            return (f"Copy {copy['copy_code']} is reserved for {reserved_for}. Issue it to them, "
                    f"or choose a different copy.")
    elif book_title:
        titles = conn.execute(
            text("SELECT DISTINCT book_title FROM v_book_copies "
                 "WHERE LOWER(book_title) LIKE LOWER(:t) ORDER BY book_title LIMIT 6"),
            {"t": _like(book_title)},
        ).scalars().all()
        if not titles:
            return f"I couldn't find a book matching “{book_title}”."
        if len(titles) > 1:
            return "That matches more than one book: " + "; ".join(titles) + ". Which one do you mean?"
        # Prefer a copy this student already reserved, otherwise any free copy.
        copy = conn.execute(
            text(f"""
                SELECT {_COPY_COLUMNS} FROM v_book_copies
                WHERE book_title = :t
                  AND (status = 'available'
                       OR (status = 'reserved' AND LOWER(reserved_by_roll) = LOWER(:r)))
                ORDER BY CASE WHEN status = 'reserved' THEN 0 ELSE 1 END, copy_code
                LIMIT 1
            """),
            {"t": titles[0], "r": student_roll},
        ).mappings().first()
        if not copy:
            return f"There are no copies of “{titles[0]}” available to issue right now."
    else:
        return "Which book should I issue? Please give a copy code or a book title."

    return PendingAction(
        action="issue",
        copy_code=copy["copy_code"],
        roll_number=student_roll,
        summary=(f"Issue “{copy['book_title']}” (copy {copy['copy_code']}) to {student_roll}. "
                 f"The due date is set automatically."),
    )


def _resolve_issued_copy(conn, copy_code, roll, book_title, verb: str):
    """Finds the single currently-issued copy the librarian means.
    Returns (copy_row, None) or (None, message)."""
    if copy_code:
        copy = _find_copy_by_code(conn, copy_code)
        if not copy:
            return None, f"I couldn't find a copy with code {copy_code}."
        if str(copy["status"]) != "issued":
            return None, (f"Copy {copy['copy_code']} (“{copy['book_title']}”) isn't currently "
                          f"issued (it's {copy['status']}).")
        holder = copy["issued_to_roll"] or ""
        if roll and holder.lower() != roll.lower():
            return None, f"Copy {copy['copy_code']} is issued to {holder}, not {roll}."
        return copy, None

    if not roll and not book_title:
        return None, (f"Which book should I {verb}? Please give a copy code, or the "
                      f"student's roll number.")

    conditions = ["status = 'issued'"]
    params = {}
    if roll:
        conditions.append("LOWER(issued_to_roll) = LOWER(:r)")
        params["r"] = roll
    if book_title:
        conditions.append("LOWER(book_title) LIKE LOWER(:t)")
        params["t"] = _like(book_title)

    rows = conn.execute(
        text(f"SELECT {_COPY_COLUMNS} FROM v_book_copies WHERE {' AND '.join(conditions)} "
             f"ORDER BY due_date LIMIT 6"),
        params,
    ).mappings().all()

    if not rows:
        what = f" matching “{book_title}”" if book_title else ""
        who = f" to {roll}" if roll else ""
        return None, f"I couldn't find any issued book{what}{who}."
    if len(rows) > 1:
        options = "; ".join(
            f"“{r['book_title']}” (copy {r['copy_code']}" + ("" if roll else f", {r['issued_to_roll']}") + ")"
            for r in rows
        )
        return None, f"More than one issued copy matches: {options}. Which one do you mean?"
    return rows[0], None


def build_pending_action(tool_name: str, args: dict):
    """Resolves a propose_* tool call into either a PendingAction (ready for
    the librarian to confirm) or a plain-text message explaining why not /
    what's missing. Read-only: never changes anything."""
    copy_code = _clean(args.get("copy_code"))
    roll = _clean(args.get("roll_number"))
    title = _clean(args.get("book_title"))

    try:
        with get_chatbot_engine().connect() as conn:
            if tool_name == PROPOSE_ISSUE_TOOL_NAME:
                if not roll:
                    return "Which student should I issue it to? Please give their roll number."
                return _resolve_issue(conn, roll, copy_code, title)

            if tool_name == PROPOSE_RETURN_TOOL_NAME:
                condition = (_clean(args.get("condition")) or "good").lower()
                if condition != "good":
                    return ("Lost or damaged returns create replacement-cost fines, so please "
                            "record those from the Return screen rather than the chatbot.")
                copy, err = _resolve_issued_copy(conn, copy_code, roll, title, "return")
                if err:
                    return err
                holder = copy["issued_to_roll"]
                summary = f"Return “{copy['book_title']}” (copy {copy['copy_code']}) from {holder}, in good condition."
                if copy["overdue"]:
                    summary += " It's overdue, so a fine will be recorded automatically."
                return PendingAction(action="return", copy_code=copy["copy_code"],
                                     roll_number=holder, summary=summary)

            if tool_name == PROPOSE_RENEW_TOOL_NAME:
                copy, err = _resolve_issued_copy(conn, copy_code, roll, title, "renew")
                if err:
                    return err
                holder = copy["issued_to_roll"]
                summary = (f"Renew “{copy['book_title']}” (copy {copy['copy_code']}) for {holder}. "
                           f"Current due date: {_fmt_date(copy['due_date'])}. The renewal rules "
                           f"(timing, limit, waiting list) are checked when you confirm.")
                return PendingAction(action="renew", copy_code=copy["copy_code"],
                                     roll_number=holder, summary=summary)
    except SQLAlchemyError as exc:
        logger.exception("Lookup failed while building a pending action")
        if _is_db_connection_problem(exc):
            raise HTTPException(status_code=503, detail=DB_LOGIN_HELP)
        return "I couldn't look that up right now. Please try again in a moment."

    return "I don't know how to do that."


# ─────────────────────────────────────────────────────────────────────────────
# Librarian actions — step 2: EXECUTE (only after the librarian confirms)
# ─────────────────────────────────────────────────────────────────────────────

@protected.post("/api/chatbot/execute-action", response_model=ExecuteActionResponse)
def execute_action(req: ExecuteActionRequest, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.librarian))):
    """Runs a confirmed circulation action by calling the app's EXISTING
    issue / return / renew functions, so every existing business rule
    applies unchanged. The caller must be a real, approved librarian."""
    import models
    import schemas
    from models import RoleEnum

    # The acting librarian comes from the login token, never from the request body.
    librarian = current

    # Imported here (not at the top) because main.py imports this module while
    # it is itself still loading; by the time a request arrives, it's loaded.
    try:
        import main as app_main
    except ImportError:
        raise HTTPException(status_code=500, detail="Server is not ready to run actions.")

    try:
        if req.action == "issue":
            if not req.roll_number:
                raise HTTPException(status_code=400, detail="A student roll number is required to issue a book.")
            result = app_main.issue_book(
                schemas.IssueRequest(copy_code=req.copy_code, roll_number=req.roll_number,
                                     librarian_id=librarian.id),
                db, current=librarian,
            )
            message = (f"Issued copy {result['copy_code']} to {req.roll_number}. "
                       f"Due {_fmt_date(result.get('due_date'))}.")

        elif req.action == "return":
            result = app_main.return_book(
                schemas.ReturnRequest(copy_code=req.copy_code, librarian_id=librarian.id,
                                      condition="good"),
                db, current=librarian,
            )
            message = result.get("message", "Book returned.").rstrip(".") + "."
            if result.get("fine"):
                message += f" An overdue fine of Rs. {result['fine']} was recorded."

        elif req.action == "renew":
            copy = db.query(models.BookCopy).filter(models.BookCopy.copy_code == req.copy_code).first()
            if not copy or not copy.issued_to_roll:
                raise HTTPException(status_code=400, detail="That copy isn't currently issued.")
            borrower = db.query(models.User).filter(
                models.User.roll_number == copy.issued_to_roll
            ).first()
            if not borrower:
                raise HTTPException(status_code=400, detail="Couldn't find the student who has this copy.")
            # The existing renew logic acts on behalf of the borrowing student.
            result = app_main.renew_book(
                schemas.RenewRequest(copy_code=req.copy_code, user_id=borrower.id), db, current=librarian,
            )
            message = result.get("message", "Book renewed.")
            if "renewals_left" in result:
                message += f" ({result['renewals_left']} renewal(s) left.)"

        elif req.action == "collect_fine":
            fine = db.query(models.FineRecord).filter(models.FineRecord.id == req.fine_id).first()
            if not fine:
                raise HTTPException(status_code=404, detail="That fine no longer exists.")
            # Full remaining amount, read fresh from the DB, so collect_fine's
            # "must match remaining exactly" rule always passes for this fine.
            result = app_main.collect_fine(
                schemas.FinePayment(fine_id=fine.id, roll_number=fine.roll_number,
                                    amount_paid=fine.remaining, recorded_by=librarian.id),
                db, current=librarian,
            )
            message = result["message"]
            if result.get("student_unblocked"):
                message += " The student has been unblocked."

        elif req.action == "resolve_damage":
            if not req.roll_number:
                raise HTTPException(status_code=400, detail="A student roll number is required.")
            if req.resolution not in ("replace", "pay"):
                raise HTTPException(status_code=400, detail="Resolution must be 'replace' or 'pay'.")
            result = app_main.resolve_damage_loss(
                copy_code=req.copy_code, roll_number=req.roll_number,
                resolution=req.resolution, librarian_id=librarian.id, db=db, current=librarian,
            )
            message = result["message"]

        else:
            raise HTTPException(status_code=400, detail="Unknown action.")

    except HTTPException as exc:
        # Business-rule refusals (e.g. "renewal opens 3 days before due")
        # come back here as normal messages for the chat, not server errors.
        if exc.status_code in (400, 404, 409):
            # Some existing messages interpolate enum members directly
            # ("Copy is CopyStatus.issued ..."); strip that prefix for the chat.
            return ExecuteActionResponse(ok=False, message=str(exc.detail).replace("CopyStatus.", ""))
        raise

    logger.info("chatbot action %s on %s by librarian %s", req.action, req.copy_code, librarian.roll_number)
    return ExecuteActionResponse(ok=True, message=message)


# ─────────────────────────────────────────────────────────────────────────────
# Librarian: per-student menu and guided operations
# ─────────────────────────────────────────────────────────────────────────────
#
# A librarian types a student's roll number. The menu lists ONLY the operations
# that are possible for that student right now, using the same rules the normal
# screens enforce. Picking one opens a short guided flow (pick a book / fine /
# option, or type a title). Every flow ends in the same propose-then-confirm
# card as above, so nothing changes until the librarian presses Confirm, which
# goes through /api/chatbot/execute-action and the app's existing functions.
#
# The flow is stateless: the frontend sends the operation and the selection so
# far on every step, and every step re-checks the rules from scratch.

OP_ISSUE = "issue"
OP_RETURN = "return"
OP_RENEW = "renew"
OP_COLLECT_FINE = "collect_fine"
OP_RESOLVE_DAMAGE = "resolve_damage"
OP_NOC = "noc"
OP_SUMMARY = "summary"

OPERATION_LABELS = {
    OP_ISSUE: "Issue a book",
    OP_RETURN: "Return a book",
    OP_RENEW: "Renew a book",
    OP_COLLECT_FINE: "Collect a fine",
    OP_RESOLVE_DAMAGE: "Resolve a lost / damaged book",
    OP_NOC: "Generate No-Dues (NOC) certificate",
    OP_SUMMARY: "Show account summary",
}


class MenuRequest(BaseModel):
    roll_number: str
    user_id: int                     # the librarian asking


class MenuOperation(BaseModel):
    key: str
    label: str


class StudentMenuResponse(BaseModel):
    is_student: bool
    roll_number: str
    message: str
    operations: List[MenuOperation] = []


class StudentFlowRequest(BaseModel):
    user_id: int                     # the librarian performing the flow
    roll_number: str
    operation: str
    selection: Optional[str] = None  # None = first step; otherwise the choice / typed answer


class FlowChoice(BaseModel):
    label: str
    value: str


class FlowDownload(BaseModel):
    kind: str                        # "noc"
    roll_number: str


class StudentFlowResponse(BaseModel):
    message: str
    choices: List[FlowChoice] = []
    awaiting_text: bool = False      # True = the next thing the librarian types is the answer
    pending_action: Optional[PendingAction] = None
    download: Optional[FlowDownload] = None


def _require_librarian(db: Session, user_id: int):
    librarian = db.query(models.User).filter(models.User.id == user_id).first()
    if not librarian or librarian.role != RoleEnum.librarian or not librarian.is_approved:
        raise HTTPException(status_code=403, detail="Only librarian accounts can use chatbot actions.")
    return librarian


def _get_student(db: Session, roll: str):
    return db.query(models.User).filter(
        func.lower(models.User.roll_number) == roll.lower(),
        models.User.role == RoleEnum.student,
    ).first()


def _issued_copies(db: Session, roll: str):
    return db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == roll,
        models.BookCopy.status == CopyStatus.issued,
    ).order_by(models.BookCopy.due_date).all()


def _open_fines(db: Session, roll: str):
    return db.query(models.FineRecord).filter(
        models.FineRecord.roll_number == roll,
        models.FineRecord.is_cleared == False,  # noqa: E712
        models.FineRecord.remaining > 0,
    ).order_by(models.FineRecord.created_at).all()


def _renew_state(db: Session, copy) -> str:
    """Mirrors the rules in renew_book (and get_student_issued's renew_status).
    Only "can_renew" means the renew button should be offered."""
    if not copy.due_date:
        return "not_eligible"
    now = datetime.utcnow()
    due = copy.due_date.replace(tzinfo=None) if getattr(copy.due_date, "tzinfo", None) else copy.due_date
    if due < now:
        return "overdue"
    if copy.renewal_count >= MAX_FREE_RENEWALS:
        return "max_reached"
    waiting = db.query(models.BookNotification).filter(
        models.BookNotification.book_id == copy.book_id,
        models.BookNotification.status == NotificationStatus.waiting,
    ).count()
    if waiting > 0:
        return "blocked_by_queue"
    if (due - now).days <= RENEWAL_EARLY_DAYS:
        return "can_renew"
    return "too_early"


def _open_damage_copies(db: Session, roll: str):
    """(fine, copy) pairs for lost/damaged books that still need a decision
    (replace or pay). Once a decision is recorded it drops off this list; a
    'pay' decision then shows up under Collect a fine instead."""
    results = []
    for fine in _open_fines(db, roll):
        if not fine.copy_code:
            continue
        copy = db.query(models.BookCopy).filter(models.BookCopy.copy_code == fine.copy_code).first()
        if not copy or copy.status not in (CopyStatus.lost, CopyStatus.damaged):
            continue
        decided = db.query(models.BookHistory).filter(
            models.BookHistory.book_id == copy.book_id,
            models.BookHistory.change_type.in_(["resolution_pay", "resolution_replace"]),
            or_(
                models.BookHistory.change_detail.contains(f"copy {copy.copy_code}."),
                models.BookHistory.change_detail.contains(f"copy {copy.copy_code} "),
            ),
        ).first()
        if decided:
            continue
        results.append((fine, copy))
    return results


def _noc_eligible(db: Session, roll: str) -> bool:
    import main as app_main  # lazy: main imports this module while loading
    try:
        return app_main.check_noc_eligibility(roll_number=roll, db=db)["eligible"]
    except HTTPException:
        return False


def _available_operations(db: Session, student) -> List[str]:
    """Every operation that makes sense for this student at this moment."""
    roll = student.roll_number
    ops = []

    if student.is_approved and not student.is_blocked and student.account_status == AccountStatus.active:
        ops.append(OP_ISSUE)

    issued = _issued_copies(db, roll)
    if issued:
        ops.append(OP_RETURN)
        if any(_renew_state(db, c) == "can_renew" for c in issued):
            ops.append(OP_RENEW)

    if _open_fines(db, roll):
        ops.append(OP_COLLECT_FINE)
    if _open_damage_copies(db, roll):
        ops.append(OP_RESOLVE_DAMAGE)
    if _noc_eligible(db, roll):
        ops.append(OP_NOC)

    ops.append(OP_SUMMARY)  # always available: it only reads
    return ops


def _choose(message: str, options) -> StudentFlowResponse:
    """options: list of (label, value)."""
    if not options:
        return StudentFlowResponse(message="There's nothing to choose from right now.")
    return StudentFlowResponse(
        message=message,
        choices=[FlowChoice(label=label, value=value) for label, value in options],
    )


def _from_outcome(outcome) -> StudentFlowResponse:
    """Turns build_pending_action's result (PendingAction or a sentence) into a step."""
    if isinstance(outcome, PendingAction):
        return StudentFlowResponse(message=outcome.summary, pending_action=outcome)
    return StudentFlowResponse(message=outcome)


def _copy_label(copy) -> str:
    return f"{copy.book.title} — {copy.copy_code}"


def _flow_issue(db: Session, roll: str, sel: Optional[str]) -> StudentFlowResponse:
    if not sel:
        return StudentFlowResponse(
            message=f"Which book should I issue to {roll}? Type its title or copy code.",
            awaiting_text=True,
        )
    # Copy codes look like BK-13425678904-260608-01; anything else is treated as a title.
    is_code = bool(re.fullmatch(r"[A-Za-z]{2}-\d[\w-]*", sel))
    args = {"roll_number": roll, "copy_code": sel} if is_code else {"roll_number": roll, "book_title": sel}
    outcome = build_pending_action(PROPOSE_ISSUE_TOOL_NAME, args)
    if isinstance(outcome, PendingAction):
        return _from_outcome(outcome)
    # Couldn't resolve (no match, several matches, no free copy): ask again.
    return StudentFlowResponse(message=outcome, awaiting_text=True)


def _flow_return(db: Session, roll: str, sel: Optional[str]) -> StudentFlowResponse:
    copies = _issued_copies(db, roll)
    if not sel:
        return _choose(
            f"Which book is {roll} returning? It will be checked in as returned in good condition. "
            f"Lost or damaged returns are recorded from the Return screen.",
            [(_copy_label(c), c.copy_code) for c in copies],
        )
    if sel not in {c.copy_code for c in copies}:
        return StudentFlowResponse(message=f"{sel} isn't a book {roll} currently has issued.")
    outcome = build_pending_action(PROPOSE_RETURN_TOOL_NAME,
                                   {"roll_number": roll, "copy_code": sel, "condition": "good"})
    return _from_outcome(outcome)


def _flow_renew(db: Session, roll: str, sel: Optional[str]) -> StudentFlowResponse:
    renewable = [c for c in _issued_copies(db, roll) if _renew_state(db, c) == "can_renew"]
    if not sel:
        return _choose(
            f"Which book should I renew for {roll}? Renewal adds {RENEWAL_WINDOW_DAYS} days to the due date.",
            [(f"{_copy_label(c)} (due {_fmt_date(c.due_date)})", c.copy_code) for c in renewable],
        )
    if sel not in {c.copy_code for c in renewable}:
        return StudentFlowResponse(message="That book can't be renewed right now.")
    outcome = build_pending_action(PROPOSE_RENEW_TOOL_NAME, {"roll_number": roll, "copy_code": sel})
    return _from_outcome(outcome)


def _flow_collect(db: Session, roll: str, sel: Optional[str]) -> StudentFlowResponse:
    fines = _open_fines(db, roll)
    if not sel:
        return _choose(
            f"Which fine should {roll} pay? Only full payment is accepted. "
            f"Overdue fines on books still out are added when the book is returned.",
            [(f"Rs. {f.remaining:.2f} — {f.book_title or f.copy_code or 'fine'}", str(f.id)) for f in fines],
        )
    fine = next((f for f in fines if str(f.id) == sel), None)
    if not fine:
        return StudentFlowResponse(message="That fine isn't open any more.")
    title = f" for “{fine.book_title}”" if fine.book_title else ""
    summary = (f"Collect the full payment of Rs. {fine.remaining:.2f} from {roll}{title}. "
               f"The student is unblocked if no other fines remain.")
    pending = PendingAction(action="collect_fine", copy_code=fine.copy_code or "",
                            roll_number=roll, summary=summary, fine_id=fine.id)
    return _from_outcome(pending)


def _flow_resolve(db: Session, roll: str, sel: Optional[str]) -> StudentFlowResponse:
    pairs = _open_damage_copies(db, roll)
    if not sel:
        return _choose(
            f"Which lost or damaged book is {roll} settling?",
            [(_copy_label(copy), copy.copy_code) for _, copy in pairs],
        )

    resolution, _, code = sel.rpartition(":")  # "replace:CODE" / "pay:CODE" / "CODE"
    copy = next((c for _, c in pairs if c.copy_code == code), None)
    if not copy:
        return StudentFlowResponse(message="That book doesn't need a decision right now.")

    if resolution not in ("replace", "pay"):
        cost = copy.book.replacement_cost
        return _choose(
            f"How should {roll} settle “{copy.book.title}” ({copy.copy_code})?",
            [
                ("Replace with a new copy of the same edition", f"replace:{copy.copy_code}"),
                (f"Pay the replacement cost (Rs. {cost:.2f})", f"pay:{copy.copy_code}"),
            ],
        )

    if resolution == "replace":
        summary = (f"Accept a replacement copy of “{copy.book.title}” ({copy.copy_code}) from {roll}. "
                   f"The fine is cleared and the student is unblocked. You still need to add the "
                   f"new physical copy to the system.")
    else:
        summary = (f"Record that {roll} will pay Rs. {copy.book.replacement_cost:.2f} for "
                   f"“{copy.book.title}” ({copy.copy_code}). Collect it from Collect a fine; the "
                   f"student stays blocked until it's paid.")
    pending = PendingAction(action="resolve_damage", copy_code=copy.copy_code, roll_number=roll,
                            summary=summary, resolution=resolution)
    return _from_outcome(pending)


def _flow_noc(db: Session, roll: str) -> StudentFlowResponse:
    import main as app_main  # lazy: see _noc_eligible
    result = app_main.check_noc_eligibility(roll_number=roll, db=db)
    if not result["eligible"]:
        return StudentFlowResponse(
            message=f"{roll} isn't eligible for a NOC yet: " + "; ".join(result["blocking_reasons"]) + "."
        )
    return StudentFlowResponse(
        message=f"{roll} is eligible for a No-Dues (NOC) certificate.",
        download=FlowDownload(kind="noc", roll_number=roll),
    )


def _flow_summary(db: Session, student) -> StudentFlowResponse:
    roll = student.roll_number
    issued = _issued_copies(db, roll)
    reserved = db.query(models.BookCopy).filter(
        models.BookCopy.reserved_by_roll == roll,
        models.BookCopy.status == CopyStatus.reserved,
    ).all()
    fines = _open_fines(db, roll)

    lines = [
        f"Account summary for {roll}",
        f"Account status: {student.account_status.value}. Blocked: {'yes' if student.is_blocked else 'no'}.",
    ]
    if issued:
        lines.append(f"Books issued ({len(issued)}):")
        lines += [f"• {c.book.title} — due {_fmt_date(c.due_date)}" for c in issued]
    else:
        lines.append("Books issued: none.")
    if reserved:
        lines.append(f"Reserved ({len(reserved)}): " + "; ".join(c.book.title for c in reserved))
    if fines:
        lines.append(f"Unpaid fines: Rs. {sum(f.remaining for f in fines):.2f} across {len(fines)} record(s).")
    else:
        lines.append("Unpaid fines: none.")
    return StudentFlowResponse(message="\n".join(lines))


@protected.post("/api/chatbot/student-menu", response_model=StudentMenuResponse)
def student_menu(req: MenuRequest, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.librarian))):
    """Called when a librarian types a roll number. Returns the operations that
    are possible for that student right now. is_student=False means the number
    isn't a student, and the chat should treat the text as an ordinary question."""
    roll = _clean(req.roll_number) or ""
    student = _get_student(db, roll) if roll else None
    if not student:
        return StudentMenuResponse(is_student=False, roll_number=roll,
                                   message=f"I couldn't find a student with roll number {roll}.")
    return StudentMenuResponse(
        is_student=True,
        roll_number=student.roll_number,
        message=f"What would you like to do for {student.roll_number}?",
        operations=[MenuOperation(key=k, label=OPERATION_LABELS[k])
                    for k in _available_operations(db, student)],
    )


@protected.post("/api/chatbot/student-flow", response_model=StudentFlowResponse)
def student_flow(req: StudentFlowRequest, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.librarian))):
    """One step of a guided operation. Never changes anything itself: the last
    step returns a pending_action, which the librarian confirms separately."""
    student = _get_student(db, req.roll_number)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    if req.operation not in OPERATION_LABELS:
        raise HTTPException(status_code=400, detail="Unknown operation.")

    roll = student.roll_number
    sel = _clean(req.selection)

    if req.operation not in _available_operations(db, student):
        return StudentFlowResponse(
            message=f"{OPERATION_LABELS[req.operation]} isn't available for {roll} right now."
        )

    try:
        if req.operation == OP_ISSUE:
            return _flow_issue(db, roll, sel)
        if req.operation == OP_RETURN:
            return _flow_return(db, roll, sel)
        if req.operation == OP_RENEW:
            return _flow_renew(db, roll, sel)
        if req.operation == OP_COLLECT_FINE:
            return _flow_collect(db, roll, sel)
        if req.operation == OP_RESOLVE_DAMAGE:
            return _flow_resolve(db, roll, sel)
        if req.operation == OP_NOC:
            return _flow_noc(db, roll)
        return _flow_summary(db, student)
    except SQLAlchemyError as exc:
        logger.exception("Student flow step failed")
        if _is_db_connection_problem(exc):
            raise HTTPException(status_code=503, detail=DB_LOGIN_HELP)
        return StudentFlowResponse(message="I couldn't look that up right now. Please try again in a moment.")



# ─────────────────────────────────────────────────────────────────────────────
# Readable failures
# ─────────────────────────────────────────────────────────────────────────────
#
# Without these, any OpenAI or database-login problem surfaced as an
# unhandled 500, and the chat window could only say "something went wrong".
# Now the real reason reaches the chat (and the full traceback goes to the
# backend log).

DB_LOGIN_HELP = (
    "The chatbot is temporarily unavailable because its database connection is not "
    "working. Please ask an administrator to check the chatbot database setup."
)


def _is_query_timeout(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "statement timeout" in msg or "canceling statement" in msg


def _is_db_connection_problem(exc: Exception) -> bool:
    """True for 'can't connect / can't log in' failures, as opposed to a bad
    query or a query that simply ran too long."""
    return isinstance(exc, OperationalError) and not _is_query_timeout(exc)


def _describe_openai_error(exc: Exception) -> str:
    """Maps SDK errors to a short message. Details go to the server log only."""
    try:
        import openai
    except ImportError:
        return "The AI assistant is unavailable right now."
    if isinstance(exc, openai.AuthenticationError):
        return "The AI assistant is not configured correctly. Please contact an administrator."
    if isinstance(exc, openai.PermissionDeniedError):
        return "The AI assistant is not permitted to answer right now. Please contact an administrator."
    if isinstance(exc, openai.RateLimitError):
        return "The AI assistant is busy. Please try again in a moment."
    if isinstance(exc, openai.NotFoundError):
        return "The AI assistant is not configured correctly. Please contact an administrator."
    if isinstance(exc, openai.BadRequestError):
        return "The AI assistant could not process that request. Try rephrasing it."
    if isinstance(exc, (openai.APIConnectionError, openai.APITimeoutError)):
        return "The AI assistant could not be reached. Please try again."
    return "The AI assistant hit an unexpected error. Please try again."


def _complete(client, **kwargs):
    """Calls OpenAI; any failure becomes a readable HTTP 502."""
    try:
        return client.chat.completions.create(model=CHATBOT_MODEL, **kwargs)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - deliberately broad: SDK raises many types
        logger.exception("OpenAI call failed")
        raise HTTPException(status_code=502, detail=_describe_openai_error(exc))


@router.get("/api/chatbot/health")
def chatbot_health():
    """Liveness check for Docker. Deliberately reveals no configuration."""
    return {"status": "ok"}


@protected.get("/api/chatbot/health/details", dependencies=[Depends(auth.require_roles(RoleEnum.admin))])
def chatbot_health_details():
    """Quick self-check — open http://localhost:8000/api/chatbot/health.
    Doesn't call OpenAI (so it costs nothing); reports whether a key is
    configured, which model is set, and whether the read-only database
    login and views work."""
    status = {
        "openai_key_configured": bool(OPENAI_API_KEY),
        "model": CHATBOT_MODEL,
        "database": "ok",
    }
    try:
        with get_chatbot_engine().connect() as conn:
            conn.execute(text("SELECT 1 FROM v_books LIMIT 1"))
    except OperationalError as exc:
        logger.error("chatbot health: database connection failed: %s", exc)
        msg = str(exc).lower()
        if "password authentication failed" in msg or ("role" in msg and "does not exist" in msg):
            status["database"] = "login_failed - run setup_chatbot_db.py, then restart the backend"
        else:
            status["database"] = "unreachable"
    except SQLAlchemyError as exc:
        logger.error("chatbot health: query failed: %s", exc)
        status["database"] = "views_missing_or_no_permission - run setup_chatbot_db.py"
    return status


def _client():
    from openai import OpenAI
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="Chatbot is not configured (missing OPENAI_API_KEY).")
    return OpenAI(api_key=OPENAI_API_KEY)


def _handle_tool_call(tool_call, req: ChatbotRequest):
    """Executes one READ tool call and returns (result_rows_or_dict, sql_used_or_None).
    Raises ValueError/SQLAlchemyError on failure, same as before. (propose_*
    tools are handled separately in ask_chatbot and never reach here.)"""
    name = tool_call.function.name

    if name == RUN_SQL_TOOL_NAME:
        args = json.loads(tool_call.function.arguments)
        safe_query = validate_sql(args["query"], STAFF_ALLOWED_VIEWS)
        return run_query(safe_query), safe_query

    if name == RUN_CATALOG_TOOL_NAME:
        args = json.loads(tool_call.function.arguments)
        safe_query = validate_sql(args["query"], STUDENT_ALLOWED_VIEWS)
        return run_query(safe_query, get_student_chatbot_engine()), safe_query

    if name == MY_STATUS_TOOL_NAME:
        if not req.roll_number:
            raise ValueError("No roll number available for this student.")
        return run_my_library_status(req.roll_number), None

    raise ValueError(f"Unknown tool '{name}'.")


@protected.post("/api/chatbot/ask", response_model=ChatbotResponse)
def ask_chatbot(req: ChatbotRequest, current: models.User = Depends(auth.get_current_user)):
    # Identity is taken from the authenticated account. The client-sent role and
    # roll number are ignored, so one student can't ask about another student.
    req.role = current.role.value
    req.roll_number = current.roll_number
    if req.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Chatbot is only available to student, librarian, and HOD accounts.")
    if req.role == "student" and not req.roll_number:
        raise HTTPException(status_code=400, detail="roll_number is required for student requests.")

    client = _client()

    if req.role == "student":
        system_prompt = STUDENT_SCHEMA_DESCRIPTION
        tools = [RUN_CATALOG_TOOL, MY_STATUS_TOOL]
        tool_choice = "required"
    elif req.role == "librarian":
        system_prompt = STAFF_SCHEMA_DESCRIPTION + LIBRARIAN_ACTIONS_NOTE
        tools = [RUN_SQL_TOOL, PROPOSE_ISSUE_TOOL, PROPOSE_RETURN_TOOL, PROPOSE_RENEW_TOOL]
        tool_choice = "required"   # must call SOME tool; the model picks which
    else:  # hod
        system_prompt = STAFF_SCHEMA_DESCRIPTION
        tools = [RUN_SQL_TOOL]
        tool_choice = FORCE_STAFF_TOOL_CHOICE

    messages = [{"role": "system", "content": system_prompt}]
    for turn in (req.history or [])[-3:]:
        messages.append({"role": "user", "content": turn.question})
        messages.append({"role": "assistant", "content": turn.answer})
    messages.append({"role": "user", "content": req.question})

    last_sql = None

    # Up to 2 attempts: first try, and one retry if the tool call was
    # invalid or failed to execute (with the error fed back to the model).
    #
    # tool_choice is FORCED/REQUIRED (never "auto") so the model can never
    # just type out an answer (or a SQL query as plain text) without
    # actually calling a tool first.
    #
    # temperature is intentionally NOT set — some models only support the
    # default value and reject any explicit override with a 400 error.
    for attempt in range(2):
        completion = _complete(
            client,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
        )
        msg = completion.choices[0].message

        if not msg.tool_calls:
            # Shouldn't happen with a forced/required tool_choice, but stay safe.
            return ChatbotResponse(answer=msg.content or "I couldn't find an answer to that.", sql=None)

        tool_call = msg.tool_calls[0]

        # Action proposals: resolve to a preview and hand it straight back to
        # the UI for confirmation. No second model call, nothing is executed.
        if tool_call.function.name in PROPOSE_TOOL_NAMES:
            if req.role != "librarian":
                return ChatbotResponse(answer="Only librarians can perform actions from the chat.")
            try:
                args = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            outcome = build_pending_action(tool_call.function.name, args)
            if isinstance(outcome, PendingAction):
                return ChatbotResponse(answer=outcome.summary, pending_action=outcome)
            return ChatbotResponse(answer=outcome)

        try:
            result, sql_used = _handle_tool_call(tool_call, req)
            last_sql = sql_used
        except (ValueError, SQLAlchemyError, json.JSONDecodeError, KeyError) as exc:
            if _is_db_connection_problem(exc):
                logger.exception("chatbot database connection failed")
                raise HTTPException(status_code=503, detail=DB_LOGIN_HELP)
            messages.append(msg.model_dump(exclude_unset=True))
            messages.append({
                "role": "tool", "tool_call_id": tool_call.id,
                "content": json.dumps({"error": str(exc)}),
            })
            continue

        # Success — ask the model to turn the result into a clean natural-
        # language answer only (no SQL, no "query used" commentary).
        messages.append(msg.model_dump(exclude_unset=True))
        messages.append({
            "role": "tool", "tool_call_id": tool_call.id,
            "content": json.dumps(result, default=str),
        })
        messages.append({"role": "system", "content": ANSWER_STYLE_INSTRUCTION})
        final = _complete(client, messages=messages)
        answer = final.choices[0].message.content or "Here's what I found."
        return ChatbotResponse(answer=answer.strip(), sql=last_sql)

    return ChatbotResponse(
        answer="I wasn't able to safely answer that question — try rephrasing it.",
        sql=None,
    )


# Mount the protected chatbot routes on the router main.py includes.
router.include_router(protected)
