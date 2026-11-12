"""
One-time (idempotent) setup for the chatbot's database access:

  1. Create two restricted Postgres roles, with passwords from environment
     variables (there is no fallback default):
       - chatbot_ro          staff questions (librarian and HOD)
       - chatbot_student_ro  student questions: catalogue views only
  2. Give both CONNECT on this database, USAGE on the public schema, and a
     short statement_timeout so a slow or expensive query can't hang.
  3. Apply chatbot_setup.sql, which creates the curated views.
  4. Grant SELECT on exactly the views each role may read. Neither role can
     read the underlying tables.

Safe to run repeatedly. Re-run it after changing any password or after
pulling this change.
"""
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL", "")
CHATBOT_DB_PASSWORD = os.environ.get("CHATBOT_DB_PASSWORD", "")
CHATBOT_STUDENT_DB_PASSWORD = os.environ.get("CHATBOT_STUDENT_DB_PASSWORD", "")

SQL_FILE = Path(__file__).parent / "chatbot_setup.sql"

STAFF_VIEWS = (
    "v_books, v_book_copies, v_fines, v_users, v_book_requests, "
    "v_override_requests, v_course_limits, v_book_history, "
    "v_announcements, v_broadcast_messages"
)
STUDENT_VIEWS = "v_books, v_course_limits, v_announcements, v_broadcast_messages"


def _ensure_role(cur, role: str, password: str):
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,))
    if cur.fetchone():
        cur.execute(f"ALTER ROLE {role} WITH PASSWORD %s", (password,))
        print(f"{role} already existed; password refreshed.")
    else:
        cur.execute(f"CREATE ROLE {role} WITH LOGIN PASSWORD %s", (password,))
        print(f"{role} created.")
    # Role names are fixed constants in this file, never user input.
    cur.execute(f"ALTER ROLE {role} SET statement_timeout = '3s'")
    cur.execute(f"ALTER ROLE {role} SET default_transaction_read_only = on")


def main():
    if not DATABASE_URL:
        sys.exit("DATABASE_URL is not set.")
    if not CHATBOT_DB_PASSWORD or not CHATBOT_STUDENT_DB_PASSWORD:
        sys.exit("CHATBOT_DB_PASSWORD and CHATBOT_STUDENT_DB_PASSWORD must both be set.")

    parsed = urlparse(DATABASE_URL)
    dbname = parsed.path.lstrip("/")

    conn = psycopg2.connect(
        dbname=dbname,
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port or 5432,
    )
    conn.autocommit = True
    cur = conn.cursor()

    _ensure_role(cur, "chatbot_ro", CHATBOT_DB_PASSWORD)
    _ensure_role(cur, "chatbot_student_ro", CHATBOT_STUDENT_DB_PASSWORD)

    # dbname is taken from our own DATABASE_URL, not from user input.
    cur.execute(f'GRANT CONNECT ON DATABASE "{dbname}" TO chatbot_ro, chatbot_student_ro')
    cur.execute("GRANT USAGE ON SCHEMA public TO chatbot_ro, chatbot_student_ro")

    # Views and helper function (chatbot_setup.sql is idempotent).
    cur.execute(SQL_FILE.read_text())

    # Each role gets SELECT on its own views only.
    cur.execute(f"REVOKE ALL ON {STAFF_VIEWS} FROM chatbot_student_ro")
    cur.execute(f"GRANT SELECT ON {STAFF_VIEWS} TO chatbot_ro")
    cur.execute(f"GRANT SELECT ON {STUDENT_VIEWS} TO chatbot_student_ro")

    print("Chatbot read-only views and grants are up to date.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
