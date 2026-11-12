from fastapi import APIRouter, FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from database import Base, engine, get_db
import models, schemas, auth
from models import RoleEnum, ApprovalStatus, MediaType, BookType, NotificationStatus, CopyStatus, OverrideStatus, AccountStatus
from config import (
    APP_NAME,
    STUDENT_EMAIL_IDENTIFIER,
    ROLES_REQUIRING_HOD_APPROVAL,
    ROLES_REQUIRING_ADMIN_APPROVAL,
    BOOK_ISSUE_DAYS,
    NOTIFICATION_WINDOW_HOURS,
    COURSE_MAP,
    DUE_SOON_ALERT_DAYS,
    FINE_PER_DAY,
    MAX_FREE_RENEWALS,
    RENEWAL_EARLY_DAYS,
    RENEWAL_WINDOW_DAYS,
)
from datetime import datetime, timedelta
import io

Base.metadata.create_all(bind=engine)

# Interactive docs and the schema are not served (they list every endpoint).
app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)

# Every route on `api` requires a valid, approved login. Only register and
# login stay on `app` directly. Role/ownership checks sit on each handler.
api = APIRouter(dependencies=[Depends(auth.get_current_user)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from chatbot import router as chatbot_router
app.include_router(chatbot_router)

RESERVATION_WINDOW_HOURS = 24


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def lock_book_and_copy(db: Session, copy_code: str):
    """Locks the copy's book row, then the copy row. Concurrent issue, return,
    renew and reserve calls queue up here instead of racing. Always lock the
    book first, so the order never changes and deadlocks can't happen."""
    row = db.query(models.BookCopy.book_id).filter(models.BookCopy.copy_code == copy_code).first()
    if not row:
        return None
    db.query(models.Book).filter(models.Book.id == row.book_id).with_for_update().populate_existing().first()
    return db.query(models.BookCopy).filter(models.BookCopy.copy_code == copy_code).with_for_update().populate_existing().first()


def detect_role_from_email(email: str):
    if STUDENT_EMAIL_IDENTIFIER in email:
        return RoleEnum.student
    return None


def detect_course_prefix(roll_number: str) -> str:
    roll_upper = roll_number.upper()
    sorted_prefixes = sorted(COURSE_MAP.keys(), key=len, reverse=True)
    for prefix in sorted_prefixes:
        if prefix in roll_upper:
            return prefix
    return None


def generate_book_code(isbn: str, media_type: MediaType, entry_date: str) -> str:
    prefix = "BK" if media_type == MediaType.book else "MZ"
    clean_isbn = isbn.replace("-", "")
    return f"{prefix}-{clean_isbn}-{entry_date}"


def get_fine_per_day(db: Session) -> int:
    """Live fine rate set by Admin, falls back to config default."""
    setting = db.query(models.SystemSetting).filter(
        models.SystemSetting.key == "fine_per_day"
    ).first()
    if setting:
        try:
            return int(setting.value)
        except (TypeError, ValueError):
            pass
    return FINE_PER_DAY


def calculate_fine(due_date: datetime, db: Session = None) -> int:
    if not due_date:
        return 0
    now = datetime.utcnow()
    if hasattr(due_date, "tzinfo") and due_date.tzinfo is not None:
        due_date = due_date.replace(tzinfo=None)
    if due_date >= now:
        return 0
    days_overdue = (now - due_date).days
    if days_overdue == 0:
        days_overdue = 1
    rate = get_fine_per_day(db) if db is not None else FINE_PER_DAY
    return days_overdue * rate


def expire_stale_notifications(book_id: int, db: Session):
    now = datetime.utcnow()
    stale = db.query(models.BookNotification).filter(
        models.BookNotification.book_id == book_id,
        models.BookNotification.status == NotificationStatus.notified,
        models.BookNotification.expires_at < now
    ).all()
    for n in stale:
        n.status = NotificationStatus.expired
        queue_count = db.query(models.BookNotification).filter(
            models.BookNotification.book_id == book_id,
            models.BookNotification.status == NotificationStatus.waiting
        ).count()
        db.add(models.BookNotification(
            book_id=n.book_id, user_id=n.user_id,
            queue_position=queue_count + 1,
            status=NotificationStatus.waiting,
        ))
    if stale:
        db.commit()


def get_system_actor_id(db: Session):
    """Returns a real user id to attribute automated/system actions to
    (e.g. reservation expiry) — book_history.changed_by is a required FK
    to users.id, so this can never be a placeholder like 0 that doesn't
    correspond to an actual row. Falls back to None if no admin exists
    yet, so callers can skip logging rather than crash the request."""
    admin = db.query(models.User).filter(models.User.role == RoleEnum.admin).first()
    return admin.id if admin else None


def expire_stale_reservations(db: Session):
    """Cancel reservations older than 24hrs and restore availability.
    Uses a manual Python loop + tzinfo stripping to avoid SQL-level
    timezone-naive vs timezone-aware comparison failures."""
    now_utc = datetime.utcnow()

    all_reserved = db.query(models.BookCopy).filter(
        models.BookCopy.status == CopyStatus.reserved,
        models.BookCopy.reservation_expires_at.isnot(None)
    ).all()

    expired = []
    for copy in all_reserved:
        exp = copy.reservation_expires_at
        if exp is None:
            continue
        if hasattr(exp, "tzinfo") and exp.tzinfo is not None:
            exp = exp.replace(tzinfo=None)
        if exp < now_utc:
            expired.append(copy)

    system_actor_id = get_system_actor_id(db) if expired else None

    for copy in expired:
        roll = copy.reserved_by_roll
        book_id = copy.book_id
        copy.status = CopyStatus.available
        copy.reserved_by_roll = None
        copy.reserved_at = None
        copy.reservation_expires_at = None
        copy.book.available_copies += 1
        if system_actor_id is not None:
            db.add(models.BookHistory(
                book_id=book_id, changed_by=system_actor_id,
                change_type="reservation_expired",
                change_detail=f"Reservation by {roll} expired. Copy {copy.copy_code} made available.",
            ))

    if expired:
        db.commit()


def compute_outstanding_dues(db: Session, roll_number: str):
    """Returns (issued_count, unpaid_fine_total) for a student."""
    issued_count = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == roll_number,
        models.BookCopy.status == CopyStatus.issued,
    ).count()
    unpaid_fine_total = db.query(func.coalesce(func.sum(models.FineRecord.remaining), 0.0)).filter(
        models.FineRecord.roll_number == roll_number,
        models.FineRecord.is_cleared == False,
    ).scalar()
    return issued_count, float(unpaid_fine_total or 0.0)


def disable_student_account(db: Session, user: "models.User", new_status: AccountStatus, reason_label: str):
    """Disables a student's account. Dues never block this — if there are
    unpaid fines or books still issued, a SystemAlert is raised for the
    admin to follow up on instead of refusing to disable the account."""
    issued_count, unpaid_total = compute_outstanding_dues(db, user.roll_number)
    user.account_status = new_status
    if issued_count > 0 or unpaid_total > 0:
        parts = []
        if issued_count > 0:
            parts.append(f"{issued_count} book(s) still issued")
        if unpaid_total > 0:
            parts.append(f"Rs. {unpaid_total:.2f} in unpaid fines")
        db.add(models.SystemAlert(
            message=f"{user.roll_number}'s account was disabled ({reason_label}) with outstanding dues: {', '.join(parts)}. Manual follow-up required.",
        ))
    db.commit()
    return issued_count, unpaid_total


def check_and_apply_graduation_expiry(db: Session, user: "models.User"):
    """If this student's stated graduation year has fully ended (i.e. we
    are past Dec 31 of that year) and they're still active, auto-disable
    them now. This app has no background job scheduler, so — matching the
    lazy-check pattern already used for reservation expiry above — this
    runs at the one moment it actually matters: right before login would
    otherwise succeed."""
    if user.role != RoleEnum.student:
        return
    if user.account_status != AccountStatus.active:
        return
    if not user.graduation_year:
        return
    year_end = datetime(user.graduation_year, 12, 31, 23, 59, 59)
    if datetime.utcnow() > year_end:
        disable_student_account(db, user, AccountStatus.graduated, f"graduation year {user.graduation_year} ended")


def notify_next_in_queue(book_id: int, available_count: int, db: Session):
    expire_stale_notifications(book_id, db)
    waiting = db.query(models.BookNotification).filter(
        models.BookNotification.book_id == book_id,
        models.BookNotification.status == NotificationStatus.waiting
    ).order_by(models.BookNotification.queue_position).limit(available_count).all()
    now = datetime.utcnow()
    for n in waiting:
        n.status = NotificationStatus.notified
        n.notified_at = now
        n.expires_at = now + timedelta(hours=NOTIFICATION_WINDOW_HOURS)
    if waiting:
        db.commit()


def get_student_book_limit(roll_number: str, db: Session) -> int:
    prefix = detect_course_prefix(roll_number)
    if prefix:
        limit = db.query(models.CourseLimit).filter(
            models.CourseLimit.course_prefix == prefix
        ).first()
        if limit:
            return limit.max_books
    return 3  # default


def parse_date(s):
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except (TypeError, ValueError):
        return None


def normalize_role_list(target_roles):
    return ",".join(sorted({r.value if isinstance(r, RoleEnum) else str(r) for r in target_roles}))


# ─────────────────────────────────────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/register", response_model=schemas.TokenResponse)
def register(req: schemas.RegisterRequest, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.roll_number == req.roll_number).first():
        raise HTTPException(status_code=400, detail="Roll number already registered")
    if db.query(models.User).filter(models.User.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    auto_role = detect_role_from_email(req.email)
    if auto_role:
        role = auto_role
    elif req.role:
        role = req.role
    else:
        raise HTTPException(status_code=400, detail="Please select a role")

    if role == RoleEnum.admin:
        raise HTTPException(status_code=400, detail="Admin account cannot be self-registered")

    if role.value in ROLES_REQUIRING_ADMIN_APPROVAL:
        is_approved, approval_status = False, ApprovalStatus.pending
    elif role.value in ROLES_REQUIRING_HOD_APPROVAL:
        is_approved, approval_status = False, ApprovalStatus.pending
    else:
        is_approved, approval_status = True, ApprovalStatus.approved

    user = models.User(
        roll_number=req.roll_number, email=req.email,
        hashed_password=auth.hash_password(req.password),
        role=role, is_blocked=False, role_locked=True,
        is_approved=is_approved, approval_status=approval_status,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = auth.create_access_token({"sub": str(user.id), "role": user.role.value})
    needs_graduation_year = (user.role == RoleEnum.student and user.graduation_year is None)
    return {
        "access_token": token, "token_type": "bearer", "user": user,
        "needs_graduation_year": needs_graduation_year,
    }


@app.post("/api/login", response_model=schemas.TokenResponse)
def login(req: schemas.LoginRequest, db: Session = Depends(get_db)):
    rate_key = req.roll_number.strip().lower()
    auth.ensure_login_allowed(rate_key)
    user = db.query(models.User).filter(models.User.roll_number == req.roll_number).first()
    if not user or not auth.verify_password(req.password, user.hashed_password):
        auth.record_login_failure(rate_key)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    auth.clear_login_failures(rate_key)
    if not auth.is_hashed(user.hashed_password):
        # Legacy plaintext row: upgrade it now that we hold the correct password.
        user.hashed_password = auth.hash_password(req.password)
        db.commit()
    if user.approval_status == ApprovalStatus.rejected:
        raise HTTPException(status_code=403, detail="rejected")
    if not user.is_approved:
        raise HTTPException(status_code=403, detail="pending")

    # Lazily check whether this student's stated graduation year has ended
    # — if so, disable them now, before letting them log in.
    check_and_apply_graduation_expiry(db, user)

    if user.account_status != AccountStatus.active:
        friendly = {
            AccountStatus.graduated: "This account is marked as graduated and can no longer log in.",
            AccountStatus.dropped: "This account is marked as dropped and can no longer log in.",
            AccountStatus.suspended: "This account has been suspended. Contact the library admin.",
        }.get(user.account_status, "This account is no longer active.")
        raise HTTPException(status_code=403, detail=friendly)

    token = auth.create_access_token({"sub": str(user.id), "role": user.role.value})
    needs_graduation_year = (user.role == RoleEnum.student and user.graduation_year is None)
    return {
        "access_token": token, "token_type": "bearer", "user": user,
        "needs_graduation_year": needs_graduation_year,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Student — one-time graduation year
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/student/graduation-year")
def submit_graduation_year(req: schemas.GraduationYearSubmit, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == req.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != RoleEnum.student:
        raise HTTPException(status_code=400, detail="Only student accounts have a graduation year")
    if user.graduation_year is not None:
        raise HTTPException(status_code=409, detail="Graduation year is already set and cannot be changed")

    current_year = datetime.utcnow().year
    if req.graduation_year < current_year or req.graduation_year > current_year + 10:
        raise HTTPException(status_code=400, detail=f"Enter a realistic graduation year (between {current_year} and {current_year + 10})")

    user.graduation_year = req.graduation_year
    db.commit()
    return {"message": f"Graduation year set to {req.graduation_year}. This cannot be changed later."}



# ─────────────────────────────────────────────────────────────────────────────
# HOD approves librarian / staff
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/hod/pending-users", dependencies=[Depends(auth.require_roles(RoleEnum.hod))], response_model=list[schemas.UserOut])
def hod_pending_users(db: Session = Depends(get_db)):
    return db.query(models.User).filter(
        models.User.approval_status == ApprovalStatus.pending,
        models.User.role.in_([RoleEnum.librarian, RoleEnum.staff])
    ).all()


@api.post("/api/hod/approve-user", dependencies=[Depends(auth.require_roles(RoleEnum.hod))])
def hod_approve_user(action: schemas.ApprovalAction, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == action.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role not in [RoleEnum.librarian, RoleEnum.staff]:
        raise HTTPException(status_code=400, detail="HOD can only approve librarian or staff")
    if action.action == "approve":
        user.is_approved = True
        user.approval_status = ApprovalStatus.approved
    elif action.action == "reject":
        user.is_approved = False
        user.approval_status = ApprovalStatus.rejected
    else:
        raise HTTPException(status_code=400, detail="Action must be approve or reject")
    db.commit()
    return {"message": f"User {action.action}d successfully"}


# ─────────────────────────────────────────────────────────────────────────────
# Admin approves HOD / librarian / staff
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/admin/pending-users", dependencies=[Depends(auth.require_roles(RoleEnum.admin))], response_model=list[schemas.UserOut])
def admin_pending_users(db: Session = Depends(get_db)):
    return db.query(models.User).filter(
        models.User.approval_status == ApprovalStatus.pending,
        models.User.role.in_([RoleEnum.hod, RoleEnum.librarian, RoleEnum.staff])
    ).all()


@api.post("/api/admin/approve-user", dependencies=[Depends(auth.require_roles(RoleEnum.admin))])
def admin_approve_user(action: schemas.ApprovalAction, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == action.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role not in [RoleEnum.hod, RoleEnum.librarian, RoleEnum.staff]:
        raise HTTPException(status_code=400, detail="Admin can only approve HOD, librarian or staff")
    if action.action == "approve":
        user.is_approved = True
        user.approval_status = ApprovalStatus.approved
    elif action.action == "reject":
        user.is_approved = False
        user.approval_status = ApprovalStatus.rejected
    else:
        raise HTTPException(status_code=400, detail="Action must be approve or reject")
    db.commit()
    return {"message": f"User {action.action}d successfully"}


# ─────────────────────────────────────────────────────────────────────────────
# Admin — student account status (active / graduated / dropped / suspended)
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/admin/students/{roll_number}/account-status", dependencies=[Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.hod, RoleEnum.admin))])
def get_account_status(roll_number: str, db: Session = Depends(get_db)):
    student = db.query(models.User).filter(
        models.User.roll_number == roll_number,
        models.User.role == RoleEnum.student,
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    issued_count, unpaid_total = compute_outstanding_dues(db, roll_number)

    return {
        "roll_number": roll_number,
        "user_id": student.id,
        "account_status": student.account_status.value,
        "graduation_year": student.graduation_year,
        "has_dues": issued_count > 0 or unpaid_total > 0,
        "issued_count": issued_count,
        "unpaid_total": unpaid_total,
    }


@api.post("/api/admin/account-status")
def set_account_status(req: schemas.AccountStatusUpdate, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.admin))):
    req.changed_by = current.id
    admin = db.query(models.User).filter(models.User.id == req.changed_by).first()
    if not admin or admin.role != RoleEnum.admin:
        raise HTTPException(status_code=403, detail="Only admin accounts can change account status")

    user = db.query(models.User).filter(models.User.id == req.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != RoleEnum.student:
        raise HTTPException(status_code=400, detail="Account status changes are currently only supported for student accounts")

    if req.new_status == AccountStatus.active:
        user.account_status = AccountStatus.active
        db.commit()
        return {"message": f"{user.roll_number}'s account status updated to active"}

    # Disabling always succeeds — dues never block this. If the student has
    # unpaid fines or books still issued, a SystemAlert is raised for the
    # admin instead of refusing the change.
    issued_count, unpaid_total = disable_student_account(db, user, req.new_status, "disabled by admin")
    message = f"{user.roll_number}'s account status updated to {req.new_status.value}"
    if issued_count > 0 or unpaid_total > 0:
        message += f" — note: this account has {issued_count} book(s) issued and Rs. {unpaid_total:.2f} in unpaid dues."
    return {"message": message}


# ─────────────────────────────────────────────────────────────────────────────
# Admin — system alerts (things that need manual follow-up)
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/admin/system-alerts", dependencies=[Depends(auth.require_roles(RoleEnum.admin))], response_model=list[schemas.SystemAlertOut])
def get_system_alerts(unread_only: bool = False, db: Session = Depends(get_db)):
    q = db.query(models.SystemAlert)
    if unread_only:
        q = q.filter(models.SystemAlert.is_read == False)
    return q.order_by(models.SystemAlert.created_at.desc()).all()


@api.post("/api/admin/system-alerts/{alert_id}/mark-read", dependencies=[Depends(auth.require_roles(RoleEnum.admin))])
def mark_system_alert_read(alert_id: int, db: Session = Depends(get_db)):
    alert = db.query(models.SystemAlert).filter(models.SystemAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.is_read = True
    db.commit()
    return {"message": "Marked as read"}




@api.get("/api/admin/settings")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(models.SystemSetting).all()
    result = {s.key: s.value for s in settings}
    if "fine_per_day" not in result:
        result["fine_per_day"] = str(FINE_PER_DAY)
    return result


@api.post("/api/admin/settings")
def update_setting(key: str, value: str, updated_by: int, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.admin))):
    updated_by = current.id
    if key not in ["fine_per_day"]:
        raise HTTPException(status_code=400, detail=f"Unknown setting: {key}")

    if key == "fine_per_day":
        try:
            v = int(value)
            if v < 1 or v > 500:
                raise HTTPException(status_code=400, detail="Fine must be between Rs. 1 and Rs. 500 per day")
        except ValueError:
            raise HTTPException(status_code=400, detail="Fine per day must be a whole number")

    existing = db.query(models.SystemSetting).filter(models.SystemSetting.key == key).first()
    if existing:
        existing.value = value
        existing.updated_by = updated_by
        existing.updated_at = datetime.utcnow()
    else:
        db.add(models.SystemSetting(key=key, value=value, updated_by=updated_by))
    db.commit()
    return {"message": f"Setting '{key}' updated to {value}"}


# ─────────────────────────────────────────────────────────────────────────────
# Course limits (HOD)
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/course-limits", response_model=list[schemas.CourseLimitOut])
def get_course_limits(db: Session = Depends(get_db)):
    return db.query(models.CourseLimit).all()


@api.post("/api/course-limits", response_model=schemas.CourseLimitOut)
def set_course_limit(req: schemas.CourseLimitSet, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.hod, RoleEnum.admin))):
    req.set_by = current.id
    if req.course_prefix not in COURSE_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown course prefix: {req.course_prefix}")
    if req.max_books < 1 or req.max_books > 20:
        raise HTTPException(status_code=400, detail="Max books must be between 1 and 20")
    existing = db.query(models.CourseLimit).filter(
        models.CourseLimit.course_prefix == req.course_prefix
    ).first()
    if existing:
        existing.max_books = req.max_books
        existing.set_by = req.set_by
        db.commit()
        db.refresh(existing)
        return existing
    limit = models.CourseLimit(course_prefix=req.course_prefix, max_books=req.max_books, set_by=req.set_by)
    db.add(limit)
    db.commit()
    db.refresh(limit)
    return limit


# ─────────────────────────────────────────────────────────────────────────────
# Books
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/books", response_model=schemas.BookOut)
def add_book(req: schemas.BookCreate, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.admin))):
    req.added_by = current.id
    if req.media_type == MediaType.book:
        if not any([req.elig_students, req.elig_teaching_staff, req.elig_non_teaching_staff]):
            raise HTTPException(status_code=400, detail="At least one eligibility group must be selected")
    book_type = BookType.reference if req.media_type == MediaType.magazine else BookType.borrowable
    master_code = generate_book_code(req.isbn, req.media_type, req.entry_date)
    if db.query(models.Book).filter(models.Book.book_code == master_code).first():
        raise HTTPException(status_code=400, detail="A book with this ISBN and date already exists")
    replacement_cost = round(req.mrp * (req.replacement_percent / 100), 2)
    book = models.Book(
        isbn=req.isbn, title=req.title, author=req.author,
        subject=req.subject, courses=req.courses, edition=req.edition,
        media_type=req.media_type, book_code=master_code, book_type=book_type,
        mrp=req.mrp, replacement_cost=replacement_cost,
        total_copies=req.total_copies, available_copies=req.total_copies,
        elig_students=req.elig_students, elig_teaching_staff=req.elig_teaching_staff,
        elig_non_teaching_staff=req.elig_non_teaching_staff,
        added_by=req.added_by, is_active=True, cover_image=req.cover_image,
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    width = len(str(req.total_copies))
    for i in range(1, req.total_copies + 1):
        db.add(models.BookCopy(
            book_id=book.id,
            copy_code=f"{master_code}-{str(i).zfill(width)}",
            status=models.CopyStatus.available,
        ))
    db.commit()
    db.add(models.BookHistory(
        book_id=book.id, changed_by=req.added_by, change_type="created",
        change_detail=f"'{book.title}' added — {book.total_copies} copies, code: {master_code}",
    ))
    db.commit()
    db.refresh(book)
    return book


@api.get("/api/books", response_model=list[schemas.BookOut])
def get_books(db: Session = Depends(get_db)):
    expire_stale_reservations(db)
    return db.query(models.Book).filter(models.Book.is_active == True).all()


@api.get("/api/books/search")
def search_books(
    isbn: str = None, title: str = None, author: str = None,
    subject: str = None, media_type: str = None,
    availability: str = None, course: str = None,
    db: Session = Depends(get_db)
):
    expire_stale_reservations(db)
    if not any([isbn, title, author, subject, media_type, availability, course]):
        raise HTTPException(status_code=400, detail="Enter at least one search field")

    query = db.query(models.Book).filter(models.Book.is_active == True)

    text_filters = []
    if isbn:
        text_filters.append(models.Book.isbn.ilike(f"%{isbn.replace('-','')}%"))
    if title:
        text_filters.append(models.Book.title.ilike(f"%{title}%"))
    if author:
        text_filters.append(models.Book.author.ilike(f"%{author}%"))
    if subject:
        text_filters.append(models.Book.subject.ilike(f"%{subject}%"))
    if text_filters:
        query = query.filter(or_(*text_filters))

    if media_type and media_type != "all":
        query = query.filter(models.Book.media_type == media_type)
    if availability == "available":
        query = query.filter(models.Book.available_copies > 0)
    if availability == "unavailable":
        query = query.filter(models.Book.available_copies == 0)
    if course and course != "all":
        query = query.filter(
            or_(
                models.Book.courses.ilike(f"{course},%"),
                models.Book.courses.ilike(f"%,{course},%"),
                models.Book.courses.ilike(f"%,{course}"),
                models.Book.courses == course,
            )
        )

    return query.all()


@api.get("/api/books/recommendations")
def get_recommendations(roll_number: str = None, limit: int = 6, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    if current.role == RoleEnum.student:
        # Students only ever see recommendations for their own course.
        roll_number = current.roll_number
    query = db.query(models.Book).filter(
        models.Book.is_active == True,
        models.Book.elig_students == True,
    )
    matched_prefix = None
    if roll_number:
        matched_prefix = detect_course_prefix(roll_number)

    if matched_prefix:
        query = query.filter(
            or_(
                models.Book.courses.ilike(f"{matched_prefix},%"),
                models.Book.courses.ilike(f"%,{matched_prefix},%"),
                models.Book.courses.ilike(f"%,{matched_prefix}"),
                models.Book.courses == matched_prefix,
            )
        )

    books = query.order_by(func.random()).limit(limit).all()

    if len(books) < limit:
        existing_ids = [b.id for b in books]
        extras = db.query(models.Book).filter(
            models.Book.is_active == True,
            models.Book.elig_students == True,
            ~models.Book.id.in_(existing_ids) if existing_ids else True
        ).order_by(func.random()).limit(limit - len(books)).all()
        books = books + extras

    return books


@api.get("/api/books/{book_id}", response_model=schemas.BookOut)
def get_book(book_id: int, db: Session = Depends(get_db)):
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@api.delete("/api/books/{book_id}")
def delete_book(book_id: int, changed_by: int, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.admin))):
    changed_by = current.id
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.available_copies < book.total_copies:
        raise HTTPException(status_code=400, detail="Cannot deactivate while copies are issued or reserved")
    book.is_active = False
    db.commit()
    db.add(models.BookHistory(
        book_id=book.id, changed_by=changed_by,
        change_type="deactivated",
        change_detail=f"'{book.title}' marked as inactive",
    ))
    db.commit()
    return {"message": "Book deactivated successfully"}


@api.get("/api/books/{book_id}/history", response_model=list[schemas.BookHistoryOut])
def get_book_history(book_id: int, db: Session = Depends(get_db)):
    return db.query(models.BookHistory).filter(
        models.BookHistory.book_id == book_id
    ).order_by(models.BookHistory.changed_at.desc()).all()


# ─────────────────────────────────────────────────────────────────────────────
# Reviews
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/books/{book_id}/reviews", response_model=schemas.ReviewOut)
def add_review(book_id: int, req: schemas.ReviewCreate, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    if req.user_id != current.id:
        raise HTTPException(status_code=403, detail="You can only review as yourself.")
    if req.rating < 1 or req.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

    user = db.query(models.User).filter(models.User.id == req.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    has_issued = db.query(models.BookCopy).filter(
        models.BookCopy.book_id == book_id,
        models.BookCopy.issued_to_roll == user.roll_number,
        models.BookCopy.status == CopyStatus.issued
    ).first()

    has_returned = db.query(models.BookHistory).filter(
        models.BookHistory.book_id == book_id,
        models.BookHistory.change_type == "returned",
        models.BookHistory.change_detail.ilike(f"%{user.roll_number}%")
    ).first()

    if not has_issued and not has_returned:
        raise HTTPException(status_code=403, detail="You can only review books you have borrowed")

    existing = db.query(models.BookReview).filter(
        models.BookReview.book_id == book_id,
        models.BookReview.user_id == req.user_id
    ).first()
    if existing:
        existing.rating = req.rating
        existing.notes = req.notes
        db.commit()
        db.refresh(existing)
        return existing

    review = models.BookReview(
        book_id=book_id, user_id=req.user_id,
        rating=req.rating, notes=req.notes,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


@api.get("/api/books/{book_id}/reviews", response_model=list[schemas.ReviewOut])
def get_reviews(book_id: int, db: Session = Depends(get_db)):
    return db.query(models.BookReview).filter(
        models.BookReview.book_id == book_id
    ).order_by(models.BookReview.created_at.desc()).all()


@api.get("/api/books/{book_id}/my-review")
def get_my_review(book_id: int, user_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    auth.ensure_self_or_staff(current, user_id)
    review = db.query(models.BookReview).filter(
        models.BookReview.book_id == book_id,
        models.BookReview.user_id == user_id
    ).first()
    if not review:
        return None
    return {"id": review.id, "rating": review.rating, "notes": review.notes}


# ─────────────────────────────────────────────────────────────────────────────
# Student data
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/student/issued/{user_id}")
def get_student_issued(user_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    auth.ensure_self_or_staff(current, user_id)
    expire_stale_reservations(db)

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    issued = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == user.roll_number,
        models.BookCopy.status == CopyStatus.issued
    ).all()

    reserved = db.query(models.BookCopy).filter(
        models.BookCopy.reserved_by_roll == user.roll_number,
        models.BookCopy.status == CopyStatus.reserved
    ).all()

    now = datetime.utcnow()
    book_limit = get_student_book_limit(user.roll_number, db)
    total_active = len(issued) + len(reserved)
    due_soon = [c for c in issued if c.due_date and 0 <= (c.due_date - now).days <= DUE_SOON_ALERT_DAYS]

    fine_records = db.query(models.FineRecord).filter(
        models.FineRecord.roll_number == user.roll_number,
        models.FineRecord.is_cleared == False
    ).all()
    total_fines_remaining = sum(f.remaining for f in fine_records)

    live_fines = sum(calculate_fine(c.due_date, db) for c in issued if c.due_date)
    total_pending = total_fines_remaining + live_fines

    def renew_status(copy):
        if not copy.due_date:
            return "not_eligible"
        now2 = datetime.utcnow()
        due2 = copy.due_date
        if hasattr(due2, "tzinfo") and due2.tzinfo is not None:
            due2 = due2.replace(tzinfo=None)

        if due2 < now2:
            return "overdue"

        days_left = (due2 - now2).days

        if copy.renewal_count >= MAX_FREE_RENEWALS:
            return "max_reached"

        waiting = db.query(models.BookNotification).filter(
            models.BookNotification.book_id == copy.book_id,
            models.BookNotification.status == NotificationStatus.waiting
        ).count()
        if waiting > 0:
            return "blocked_by_queue"

        if days_left <= RENEWAL_EARLY_DAYS:
            return "can_renew"

        return "too_early"

    def fine_amount(copy):
        return calculate_fine(copy.due_date, db) if copy.due_date else 0

    return {
        "issued": [
            {
                "copy_code": c.copy_code,
                "book_id": c.book_id,
                "book_title": c.book.title,
                "book_author": c.book.author,
                "cover_image": c.book.cover_image,
                "issued_at": c.issued_at,
                "due_date": c.due_date,
                "renewal_count": c.renewal_count,
                "is_overdue": c.due_date and c.due_date < now,
                "is_due_soon": c.due_date and 0 <= (c.due_date - now).days <= DUE_SOON_ALERT_DAYS,
                "renew_status": renew_status(c),
                "fine_amount": fine_amount(c),
            }
            for c in issued
        ],
        "reserved": [
            {
                "copy_code": c.copy_code,
                "book_id": c.book_id,
                "book_title": c.book.title,
                "book_author": c.book.author,
                "cover_image": c.book.cover_image,
                "reservation_expires_at": c.reservation_expires_at,
            }
            for c in reserved
        ],
        "fine_records": [
            {
                "id": f.id,
                "total_fine": f.total_fine,
                "amount_paid": f.amount_paid,
                "remaining": f.remaining,
                "copy_code": f.copy_code,
                "book_title": f.book_title,
            }
            for f in fine_records
        ],
        "stats": {
            "total_issued": len(issued),
            "total_reserved": len(reserved),
            "total_active": total_active,
            "book_limit": book_limit,
            "slots_remaining": max(0, book_limit - total_active),
            "due_soon": len(due_soon),
            "pending_fines": round(total_pending, 2),
        }
    }


# ─────────────────────────────────────────────────────────────────────────────
# Student book status
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/books/{book_id}/student-status")
def get_book_student_status(book_id: int, user_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    auth.ensure_self_or_staff(current, user_id)
    expire_stale_reservations(db)
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    expire_stale_notifications(book_id, db)

    issued_copy = db.query(models.BookCopy).filter(
        models.BookCopy.book_id == book_id,
        models.BookCopy.issued_to_roll == user.roll_number,
        models.BookCopy.status == CopyStatus.issued
    ).first()
    if issued_copy:
        return {
            "status": "issued",
            "message": "You currently have this book",
            "due_date": issued_copy.due_date,
            "copy_code": issued_copy.copy_code,
            "renewal_count": issued_copy.renewal_count,
        }

    reserved_copy = db.query(models.BookCopy).filter(
        models.BookCopy.book_id == book_id,
        models.BookCopy.reserved_by_roll == user.roll_number,
        models.BookCopy.status == CopyStatus.reserved
    ).first()
    if reserved_copy:
        return {
            "status": "reserved",
            "message": "You have reserved this book. Visit the library to collect it.",
            "copy_code": reserved_copy.copy_code,
            "expires_at": reserved_copy.reservation_expires_at,
        }

    notified = db.query(models.BookNotification).filter(
        models.BookNotification.book_id == book_id,
        models.BookNotification.user_id == user_id,
        models.BookNotification.status == NotificationStatus.notified
    ).first()
    if notified:
        return {"status": "notified", "message": "Book is available for you!", "expires_at": notified.expires_at}

    waiting = db.query(models.BookNotification).filter(
        models.BookNotification.book_id == book_id,
        models.BookNotification.user_id == user_id,
        models.BookNotification.status == NotificationStatus.waiting
    ).first()
    if waiting:
        return {"status": "queued", "message": f"You are #{waiting.queue_position} in the queue", "queue_position": waiting.queue_position}

    book_limit = get_student_book_limit(user.roll_number, db)
    issued_count = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == user.roll_number,
        models.BookCopy.status == CopyStatus.issued
    ).count()
    reserved_count = db.query(models.BookCopy).filter(
        models.BookCopy.reserved_by_roll == user.roll_number,
        models.BookCopy.status == CopyStatus.reserved
    ).count()
    if issued_count + reserved_count >= book_limit:
        return {"status": "limit_reached", "message": f"You have reached your book limit ({book_limit})"}

    if book.available_copies > 0:
        return {
            "status": "available",
            "message": f"{book.available_copies} cop{'ies' if book.available_copies > 1 else 'y'} available",
            "available_copies": book.available_copies,
        }

    waiting_count = db.query(models.BookNotification).filter(
        models.BookNotification.book_id == book_id,
        models.BookNotification.status == NotificationStatus.waiting
    ).count()
    return {"status": "unavailable", "message": "All copies are issued", "queue_length": waiting_count}


# ─────────────────────────────────────────────────────────────────────────────
# Reserve
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/books/reserve")
def reserve_book(req: schemas.ReserveRequest, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    if not auth.is_staff(current) and req.roll_number != current.roll_number:
        raise HTTPException(status_code=403, detail="You can only reserve books for your own account.")
    req.user_id = current.id
    expire_stale_reservations(db)
    book = db.query(models.Book).filter(models.Book.id == req.book_id).with_for_update().populate_existing().first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.book_type == BookType.reference:
        raise HTTPException(status_code=400, detail="Reference books cannot be reserved")
    if book.available_copies <= 0:
        raise HTTPException(status_code=400, detail="No copies available")

    requester = db.query(models.User).filter(models.User.roll_number == req.roll_number).first()
    if requester and requester.account_status != AccountStatus.active:
        raise HTTPException(status_code=400, detail=f"This account is marked as {requester.account_status.value} and cannot reserve books.")

    # Block if student has any overdue book
    now = datetime.utcnow()
    overdue = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == req.roll_number,
        models.BookCopy.status == CopyStatus.issued,
        models.BookCopy.due_date < now
    ).first()
    if overdue:
        fine = calculate_fine(overdue.due_date, db)
        raise HTTPException(
            status_code=400,
            detail=f"You have an overdue book ({overdue.copy_code}). Please return it and pay the fine of Rs. {fine} before reserving."
        )

    # Block if student has any unpaid fine record
    unpaid = db.query(models.FineRecord).filter(
        models.FineRecord.roll_number == req.roll_number,
        models.FineRecord.is_cleared == False
    ).first()
    if unpaid:
        raise HTTPException(
            status_code=400,
            detail=f"You have pending fines. Please clear them at the library counter before reserving."
        )

    book_limit = get_student_book_limit(req.roll_number, db)
    issued_count = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == req.roll_number,
        models.BookCopy.status == CopyStatus.issued
    ).count()
    reserved_count = db.query(models.BookCopy).filter(
        models.BookCopy.reserved_by_roll == req.roll_number,
        models.BookCopy.status == CopyStatus.reserved
    ).count()
    if issued_count + reserved_count >= book_limit:
        raise HTTPException(status_code=400, detail=f"You have reached your book limit ({book_limit})")

    already = db.query(models.BookCopy).filter(
        models.BookCopy.book_id == req.book_id,
        models.BookCopy.reserved_by_roll == req.roll_number,
        models.BookCopy.status == CopyStatus.reserved
    ).first()
    if already:
        raise HTTPException(status_code=400, detail="You have already reserved this book")

    copy = db.query(models.BookCopy).filter(
        models.BookCopy.book_id == req.book_id,
        models.BookCopy.status == CopyStatus.available
    ).with_for_update().first()
    if not copy:
        raise HTTPException(status_code=400, detail="No available copies found")

    now2 = datetime.utcnow()
    copy.status = CopyStatus.reserved
    copy.reserved_by_roll = req.roll_number
    copy.reserved_at = now2
    copy.reservation_expires_at = now2 + timedelta(hours=RESERVATION_WINDOW_HOURS)
    book.available_copies -= 1
    db.commit()

    db.add(models.BookHistory(
        book_id=book.id, changed_by=req.user_id, change_type="reserved",
        change_detail=f"Copy {copy.copy_code} reserved by {req.roll_number}. Expires: {copy.reservation_expires_at.strftime('%d %b %Y %H:%M')}",
    ))
    db.commit()

    return {
        "message": "Book reserved successfully. Please visit the library within 24 hours to collect your copy.",
        "copy_code": copy.copy_code,
        "expires_at": copy.reservation_expires_at,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Issue
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/books/issue")
def issue_book(req: schemas.IssueRequest, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.librarian))):
    req.librarian_id = current.id
    copy = lock_book_and_copy(db, req.copy_code)
    if not copy:
        raise HTTPException(status_code=404, detail="Copy not found")
    if copy.status not in [CopyStatus.available, CopyStatus.reserved]:
        raise HTTPException(status_code=400, detail=f"Copy is {copy.status}, cannot issue")

    student = db.query(models.User).filter(models.User.roll_number == req.roll_number).first()
    if not student or student.role != RoleEnum.student:
        raise HTTPException(status_code=404, detail=f"No student account with roll number {req.roll_number}.")
    if student.is_blocked:
        raise HTTPException(status_code=400, detail=f"{req.roll_number} is blocked due to pending fines or unresolved lost/damaged book. Cannot issue.")
    if student.account_status != AccountStatus.active:
        raise HTTPException(status_code=400, detail=f"{req.roll_number} is marked as {student.account_status.value} and cannot be issued books.")
    if copy.status == CopyStatus.reserved and copy.reserved_by_roll != req.roll_number:
        raise HTTPException(status_code=400, detail=f"Copy {copy.copy_code} is reserved for another student.")

    held = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == req.roll_number,
        models.BookCopy.status == CopyStatus.issued,
    ).count()
    reserved_elsewhere = db.query(models.BookCopy).filter(
        models.BookCopy.reserved_by_roll == req.roll_number,
        models.BookCopy.status == CopyStatus.reserved,
        models.BookCopy.id != copy.id,
    ).count()
    book_limit = get_student_book_limit(req.roll_number, db)
    if held + reserved_elsewhere >= book_limit:
        raise HTTPException(status_code=400, detail=f"{req.roll_number} has reached the book limit ({book_limit}).")

    was_reserved = copy.status == CopyStatus.reserved
    now = datetime.utcnow()
    due = now + timedelta(days=BOOK_ISSUE_DAYS)

    copy.status = CopyStatus.issued
    copy.issued_to_roll = req.roll_number
    copy.issued_at = now
    copy.due_date = due
    copy.reserved_by_roll = None
    copy.reserved_at = None
    copy.reservation_expires_at = None
    copy.renewal_count = 0

    if not was_reserved:
        copy.book.available_copies -= 1

    db.commit()
    db.add(models.BookHistory(
        book_id=copy.book_id, changed_by=req.librarian_id, change_type="issued",
        change_detail=f"Copy {copy.copy_code} issued to {req.roll_number}. Due: {due.strftime('%d %b %Y')}",
    ))
    db.commit()
    return {"message": f"Book issued to {req.roll_number}", "copy_code": copy.copy_code, "due_date": due}


# ─────────────────────────────────────────────────────────────────────────────
# Renew
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/books/renew")
def renew_book(req: schemas.RenewRequest, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    if current.role == RoleEnum.student:
        if req.user_id != current.id:
            raise HTTPException(status_code=403, detail="You can only renew your own books.")
    elif current.role != RoleEnum.librarian:
        raise HTTPException(status_code=403, detail="You do not have permission for this action.")
    copy = lock_book_and_copy(db, req.copy_code)
    if not copy:
        raise HTTPException(status_code=404, detail="Copy not found")
    if copy.status != CopyStatus.issued:
        raise HTTPException(status_code=400, detail="This book is not currently issued")

    user = db.query(models.User).filter(models.User.id == req.user_id).first()
    if not user or copy.issued_to_roll != user.roll_number:
        raise HTTPException(status_code=403, detail="You do not have this book")

    now = datetime.utcnow()
    if not copy.due_date:
        raise HTTPException(status_code=400, detail="No due date set")

    due = copy.due_date
    if hasattr(due, "tzinfo") and due.tzinfo is not None:
        due = due.replace(tzinfo=None)

    # Block if overdue
    if due < now:
        days_overdue = (now - due).days
        fine = max(1, days_overdue) * get_fine_per_day(db)
        raise HTTPException(
            status_code=400,
            detail=f"Cannot renew — book is {days_overdue} day(s) overdue. Fine: Rs. {fine}. Please return the book."
        )

    # Block if another student is waiting in queue for this book
    waiting_count = db.query(models.BookNotification).filter(
        models.BookNotification.book_id == copy.book_id,
        models.BookNotification.status == NotificationStatus.waiting
    ).count()
    if waiting_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot renew — {waiting_count} student(s) are waiting for this book. Please return it by the due date."
        )

    # Can only renew within RENEWAL_EARLY_DAYS of due date
    days_left = (due - now).days
    if days_left > RENEWAL_EARLY_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Renewal opens {RENEWAL_EARLY_DAYS} days before due date. {days_left} days remaining — renewal available in {days_left - RENEWAL_EARLY_DAYS} day(s)."
        )

    # Check free renewal limit
    if copy.renewal_count >= MAX_FREE_RENEWALS:
        raise HTTPException(
            status_code=400,
            detail=f"You have used all {MAX_FREE_RENEWALS} free renewals. Please return the book."
        )

    new_due = due + timedelta(days=RENEWAL_WINDOW_DAYS)
    copy.due_date = new_due
    copy.renewal_count += 1
    db.commit()

    db.add(models.BookHistory(
        book_id=copy.book_id, changed_by=req.user_id, change_type="renewed",
        change_detail=f"Copy {copy.copy_code} renewed by {user.roll_number}. New due: {new_due.strftime('%d %b %Y')}. Renewal #{copy.renewal_count}/{MAX_FREE_RENEWALS}.",
    ))
    db.commit()

    renewals_left = MAX_FREE_RENEWALS - copy.renewal_count
    return {
        "message": f"Book renewed successfully. New due date: {new_due.strftime('%d %b %Y')}",
        "new_due_date": new_due,
        "renewal_count": copy.renewal_count,
        "renewals_left": renewals_left,
        "max_renewals": MAX_FREE_RENEWALS,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Return
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/books/return")
def return_book(req: schemas.ReturnRequest, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.librarian))):
    req.librarian_id = current.id
    copy = lock_book_and_copy(db, req.copy_code)
    if not copy:
        raise HTTPException(status_code=404, detail="Copy not found")
    if copy.status != CopyStatus.issued:
        raise HTTPException(status_code=400, detail="This copy is not currently issued")

    roll_number = copy.issued_to_roll
    overdue_fine = calculate_fine(copy.due_date, db) if copy.due_date else 0
    now = datetime.utcnow()

    if req.condition == "good":
        copy.status = CopyStatus.available
        copy.book.available_copies += 1
        copy.condition_note = req.condition_note
        copy.returned_at = now
        copy.issued_to_roll = None
        copy.issued_to_name = None
        db.commit()

        if overdue_fine > 0:
            db.add(models.FineRecord(
                roll_number=roll_number,
                total_fine=overdue_fine,
                amount_paid=0,
                remaining=overdue_fine,
                copy_code=copy.copy_code,
                book_title=copy.book.title,
                is_cleared=False,
                recorded_by=req.librarian_id,
            ))

        db.add(models.BookHistory(
            book_id=copy.book_id, changed_by=req.librarian_id,
            change_type="returned",
            change_detail=f"Copy {copy.copy_code} returned by {roll_number}. Condition: good."
            + (f" Overdue fine: Rs. {overdue_fine}." if overdue_fine > 0 else ""),
        ))
        db.commit()

        notify_next_in_queue(copy.book_id, copy.book.available_copies, db)

        return {
            "message": f"Book returned by {roll_number}",
            "condition": "good",
            "fine": overdue_fine,
            "needs_resolution": False,
        }

    elif req.condition in ["lost", "damaged"]:
        copy.status = CopyStatus.lost if req.condition == "lost" else CopyStatus.damaged
        copy.condition_note = req.condition_note
        copy.returned_at = now
        db.commit()

        replacement_cost = copy.book.replacement_cost

        db.add(models.BookHistory(
            book_id=copy.book_id, changed_by=req.librarian_id,
            change_type="returned_damaged" if req.condition == "damaged" else "reported_lost",
            change_detail=f"Copy {copy.copy_code} returned by {roll_number}. Condition: {req.condition}. Replacement cost: Rs. {replacement_cost}.",
        ))
        db.commit()

        db.add(models.FineRecord(
            roll_number=roll_number,
            total_fine=replacement_cost,
            amount_paid=0,
            remaining=replacement_cost,
            copy_code=copy.copy_code,
            book_title=copy.book.title,
            is_cleared=False,
            recorded_by=req.librarian_id,
        ))
        db.commit()

        student = db.query(models.User).filter(models.User.roll_number == roll_number).first()
        if student:
            student.is_blocked = True
            db.commit()

        return {
            "message": f"Book marked as {req.condition}. Student {roll_number} has been blocked pending resolution.",
            "condition": req.condition,
            "fine": overdue_fine,
            "replacement_cost": replacement_cost,
            "needs_resolution": True,
            "resolution_options": [
                {
                    "option": "replace",
                    "label": f"Replace with same edition ({copy.book.title}, Ed. {copy.book.edition})",
                    "description": "Student brings a new copy of the same edition to the library",
                },
                {
                    "option": "pay",
                    "label": f"Pay replacement cost: Rs. {replacement_cost}",
                    "description": "Student pays the replacement cost",
                },
            ],
            "roll_number": roll_number,
            "copy_code": copy.copy_code,
        }

    return {"message": f"Book returned by {roll_number}", "condition": req.condition, "fine": overdue_fine, "needs_resolution": False}


@api.post("/api/books/resolve-damage-loss")
def resolve_damage_loss(
    copy_code: str,
    roll_number: str,
    resolution: str,   # "replace" or "pay"
    librarian_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_roles(RoleEnum.librarian)),
):
    librarian_id = current.id
    copy = db.query(models.BookCopy).filter(models.BookCopy.copy_code == copy_code).first()
    if not copy:
        raise HTTPException(status_code=404, detail="Copy not found")
    if copy.status not in [CopyStatus.lost, CopyStatus.damaged]:
        raise HTTPException(status_code=400, detail="Copy is not in lost or damaged state")

    student = db.query(models.User).filter(models.User.roll_number == roll_number).first()

    fine = db.query(models.FineRecord).filter(
        models.FineRecord.copy_code == copy_code,
        models.FineRecord.roll_number == roll_number,
        models.FineRecord.is_cleared == False
    ).first()

    if resolution == "pay":
        db.add(models.BookHistory(
            book_id=copy.book_id, changed_by=librarian_id,
            change_type="resolution_pay",
            change_detail=f"{roll_number} will pay replacement cost Rs. {copy.book.replacement_cost} for copy {copy_code}.",
        ))
        db.commit()
        return {
            "message": f"Payment resolution recorded. Collect Rs. {copy.book.replacement_cost} from {roll_number} via the Collect Fines section. Student will be unblocked once fine is cleared.",
            "next_step": "collect_payment",
        }

    elif resolution == "replace":
        if fine:
            fine.is_cleared = True
            fine.amount_paid = fine.total_fine
            fine.remaining = 0

        copy.status = CopyStatus.lost
        copy.issued_to_roll = None

        if student:
            student.is_blocked = False

        db.add(models.BookHistory(
            book_id=copy.book_id, changed_by=librarian_id,
            change_type="resolution_replace",
            change_detail=f"{roll_number} replaced copy {copy_code} with a new copy. Student unblocked.",
        ))
        db.commit()

        return {
            "message": f"Replacement accepted. Student {roll_number} has been unblocked. Add the new physical copy to the system manually.",
            "next_step": "add_new_copy",
        }

    else:
        raise HTTPException(status_code=400, detail="Resolution must be 'replace' or 'pay'")


# ─────────────────────────────────────────────────────────────────────────────
# Librarian views
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/librarian/reservations", dependencies=[Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.hod, RoleEnum.admin))])
def get_reservations(db: Session = Depends(get_db)):
    expire_stale_reservations(db)
    copies = db.query(models.BookCopy).filter(models.BookCopy.status == CopyStatus.reserved).all()
    now = datetime.utcnow()
    return [
        {
            "copy_code": c.copy_code,
            "book_id": c.book_id,
            "book_title": c.book.title,
            "reserved_by_roll": c.reserved_by_roll,
            "reserved_at": c.reserved_at,
            "expires_at": c.reservation_expires_at,
            "is_expiring_soon": c.reservation_expires_at and (c.reservation_expires_at - now).total_seconds() < 3600,
        }
        for c in copies
    ]


@api.get("/api/librarian/issued", dependencies=[Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.hod, RoleEnum.admin))])
def get_issued(db: Session = Depends(get_db)):
    copies = db.query(models.BookCopy).filter(models.BookCopy.status == CopyStatus.issued).all()
    now = datetime.utcnow()
    return [
        {
            "copy_code": c.copy_code,
            "book_id": c.book_id,
            "book_title": c.book.title,
            "issued_to_roll": c.issued_to_roll,
            "issued_at": c.issued_at,
            "due_date": c.due_date,
            "renewal_count": c.renewal_count,
            "is_overdue": c.due_date and c.due_date < now,
            "fine": calculate_fine(c.due_date, db) if c.due_date else 0,
        }
        for c in copies
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Fines
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/fines/student/{roll_number}")
def get_student_fines(roll_number: str, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    auth.ensure_roll_self_or_staff(current, roll_number)
    now = datetime.utcnow()

    fine_records = db.query(models.FineRecord).filter(
        models.FineRecord.roll_number == roll_number,
        models.FineRecord.is_cleared == False
    ).order_by(models.FineRecord.created_at.desc()).all()

    overdue_copies = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == roll_number,
        models.BookCopy.status == CopyStatus.issued,
        models.BookCopy.due_date < now
    ).all()

    live_fines = [
        {
            "id": f"live-{c.copy_code}",
            "roll_number": roll_number,
            "total_fine": calculate_fine(c.due_date, db),
            "amount_paid": 0,
            "remaining": calculate_fine(c.due_date, db),
            "copy_code": c.copy_code,
            "book_title": c.book.title,
            "is_cleared": False,
            "is_live": True,
            "created_at": c.issued_at,
            "updated_at": c.issued_at,
        }
        for c in overdue_copies
    ]

    result = [
        {
            "id": f.id,
            "roll_number": f.roll_number,
            "total_fine": f.total_fine,
            "amount_paid": f.amount_paid,
            "remaining": f.remaining,
            "copy_code": f.copy_code,
            "book_title": f.book_title,
            "is_cleared": f.is_cleared,
            "is_live": False,
            "created_at": f.created_at,
            "updated_at": f.updated_at,
        }
        for f in fine_records
    ] + live_fines

    return result


@api.post("/api/fines/collect")
def collect_fine(req: schemas.FinePayment, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.librarian))):
    req.recorded_by = current.id
    fine = db.query(models.FineRecord).filter(models.FineRecord.id == req.fine_id).first()
    if not fine:
        raise HTTPException(status_code=404, detail="Fine record not found")
    if fine.is_cleared:
        raise HTTPException(status_code=400, detail="Fine already cleared")

    # Only full payment allowed — must match remaining exactly
    if req.amount_paid != fine.remaining:
        raise HTTPException(
            status_code=400,
            detail=f"Partial payment not allowed. The full remaining amount of Rs. {fine.remaining} must be paid."
        )

    fine.amount_paid += req.amount_paid
    fine.remaining = 0
    fine.is_cleared = True
    fine.recorded_by = req.recorded_by

    db.commit()
    db.refresh(fine)

    # Unblock student if all their fines are now cleared
    student_unblocked = False
    remaining_fines = db.query(models.FineRecord).filter(
        models.FineRecord.roll_number == fine.roll_number,
        models.FineRecord.is_cleared == False
    ).count()
    if remaining_fines == 0:
        student = db.query(models.User).filter(
            models.User.roll_number == fine.roll_number
        ).first()
        if student and student.is_blocked:
            student.is_blocked = False
            db.commit()
            student_unblocked = True

    return {
        "message": f"Full payment of Rs. {req.amount_paid} collected. Fine cleared.",
        "remaining": 0,
        "is_cleared": True,
        "student_unblocked": student_unblocked,
    }


@api.get("/api/fines/pending", dependencies=[Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.hod, RoleEnum.admin))])
def get_all_pending_fines(db: Session = Depends(get_db)):
    fines = db.query(models.FineRecord).filter(
        models.FineRecord.is_cleared == False
    ).order_by(models.FineRecord.created_at.desc()).all()
    return [
        {
            "id": f.id,
            "roll_number": f.roll_number,
            "total_fine": f.total_fine,
            "amount_paid": f.amount_paid,
            "remaining": f.remaining,
            "copy_code": f.copy_code,
            "book_title": f.book_title,
            "is_cleared": f.is_cleared,
            "created_at": f.created_at,
        }
        for f in fines
    ]

@api.get("/api/noc/check/{roll_number}", dependencies=[Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.hod, RoleEnum.admin))])
def check_noc_eligibility(roll_number: str, db: Session = Depends(get_db)):
    student = db.query(models.User).filter(
        models.User.roll_number == roll_number,
        models.User.role == RoleEnum.student
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    now = datetime.utcnow()

    unpaid_fines = db.query(models.FineRecord).filter(
        models.FineRecord.roll_number == roll_number,
        models.FineRecord.is_cleared == False
    ).all()

    overdue_books = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == roll_number,
        models.BookCopy.status == CopyStatus.issued,
        models.BookCopy.due_date < now
    ).all()

    issued_books = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == roll_number,
        models.BookCopy.status == CopyStatus.issued
    ).count()

    blocking_reasons = []
    if student.is_blocked:
        blocking_reasons.append("Account is blocked (unresolved lost/damaged book)")
    if unpaid_fines:
        total_unpaid = sum(f.remaining for f in unpaid_fines)
        blocking_reasons.append(f"Rs. {total_unpaid} in unpaid fines")
    if overdue_books:
        blocking_reasons.append(f"{len(overdue_books)} overdue book(s) not yet returned")
    if issued_books > 0:
        blocking_reasons.append(f"{issued_books} book(s) still issued — must be returned")

    eligible = len(blocking_reasons) == 0

    return {
        "roll_number": roll_number,
        "eligible": eligible,
        "blocking_reasons": blocking_reasons,
        "is_blocked": student.is_blocked,
        "unpaid_fines_count": len(unpaid_fines),
        "total_unpaid": sum(f.remaining for f in unpaid_fines),
        "overdue_count": len(overdue_books),
        "currently_issued": issued_books,
    }


@api.get("/api/noc/generate/{roll_number}")
def generate_noc(roll_number: str, librarian_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.librarian))):
    librarian_id = current.id
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER

    student = db.query(models.User).filter(
        models.User.roll_number == roll_number,
        models.User.role == RoleEnum.student
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Re-check eligibility server-side — never trust the frontend alone
    now = datetime.utcnow()
    unpaid_fines = db.query(models.FineRecord).filter(
        models.FineRecord.roll_number == roll_number,
        models.FineRecord.is_cleared == False
    ).count()
    overdue_books = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == roll_number,
        models.BookCopy.status == CopyStatus.issued,
        models.BookCopy.due_date < now
    ).count()
    issued_books = db.query(models.BookCopy).filter(
        models.BookCopy.issued_to_roll == roll_number,
        models.BookCopy.status == CopyStatus.issued
    ).count()

    if student.is_blocked or unpaid_fines > 0 or overdue_books > 0 or issued_books > 0:
        raise HTTPException(
            status_code=400,
            detail="Student is not eligible for NOC. Clear all dues, fines and returns first."
        )

    librarian = db.query(models.User).filter(models.User.id == librarian_id).first()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=1 * inch, bottomMargin=1 * inch,
        leftMargin=1 * inch, rightMargin=1 * inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "NOCTitle", parent=styles["Title"],
        fontSize=20, spaceAfter=6, alignment=TA_CENTER, textColor=colors.HexColor("#1e3a5f"),
    )
    subtitle_style = ParagraphStyle(
        "NOCSubtitle", parent=styles["Normal"],
        fontSize=11, alignment=TA_CENTER, textColor=colors.HexColor("#555555"), spaceAfter=24,
    )
    body_style = ParagraphStyle(
        "NOCBody", parent=styles["Normal"],
        fontSize=12, leading=20, spaceAfter=14, alignment=4,  # justify
    )
    label_style = ParagraphStyle(
        "NOCLabel", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#666666"),
    )

    story = []

    story.append(Paragraph("LIBRARY NO OBJECTION CERTIFICATE", title_style))
    story.append(Paragraph("Library Management System", subtitle_style))
    story.append(Spacer(1, 10))

    issue_date = now.strftime("%d %B %Y")

    details_data = [
        ["Certificate No.:", f"NOC-{roll_number}-{now.strftime('%Y%m%d%H%M')}"],
        ["Date Issued:", issue_date],
        ["Student Roll No.:", roll_number],
        ["Student Email:", student.email],
    ]
    details_table = Table(details_data, colWidths=[2 * inch, 3.5 * inch])
    details_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#666666")),
        ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#111111")),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(details_table)
    story.append(Spacer(1, 24))

    body_text = (
        f"This is to certify that the student bearing roll number "
        f"<b>{roll_number}</b> has cleared all dues with the College Library "
        f"as of the date mentioned above. The student has no outstanding books, "
        f"no pending fines, and no unresolved cases of lost or damaged library material "
        f"on record with this library."
    )
    story.append(Paragraph(body_text, body_style))

    body_text_2 = (
        "This No Objection Certificate is issued upon the student's request and may be "
        "submitted to the concerned department or authority as proof of library clearance."
    )
    story.append(Paragraph(body_text_2, body_style))

    story.append(Spacer(1, 50))

    sign_data = [["", ""], ["_______________________", ""], ["Library In-Charge", ""]]
    sign_table = Table(sign_data, colWidths=[3 * inch, 3 * inch])
    sign_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
    ]))
    story.append(sign_table)

    story.append(Spacer(1, 30))
    footer_text = (
        f"Generated by: {librarian.email if librarian else 'Library Staff'} &nbsp;|&nbsp; "
        f"This is a system-generated document and does not require a physical signature for verification purposes."
    )
    story.append(Paragraph(footer_text, label_style))

    doc.build(story)
    buffer.seek(0)

    

    filename = f"NOC_{roll_number}_{now.strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ─────────────────────────────────────────────────────────────────────────────
# Maintenance
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/maintenance/expire-reservations")
def force_expire_reservations(db: Session = Depends(get_db)):
    expire_stale_reservations(db)
    return {"message": "Reservation expiry check complete"}


@api.get("/api/debug/reservations", dependencies=[Depends(auth.require_roles(RoleEnum.admin))])
def debug_reservations(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    copies = db.query(models.BookCopy).filter(models.BookCopy.status == CopyStatus.reserved).all()
    return [
        {
            "copy_code": c.copy_code,
            "reserved_by_roll": c.reserved_by_roll,
            "reservation_expires_at": c.reservation_expires_at,
            "now_utc": now,
            "is_expired": c.reservation_expires_at < now if c.reservation_expires_at else None,
        }
        for c in copies
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Notifications
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/notifications/request")
def request_notification(req: schemas.NotificationRequest, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    if req.user_id != current.id:
        raise HTTPException(status_code=403, detail="You can only join queues for your own account.")
    book = db.query(models.Book).filter(models.Book.id == req.book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    expire_stale_notifications(req.book_id, db)
    if book.available_copies > 0:
        raise HTTPException(status_code=400, detail="Book is available — reserve it directly")
    existing = db.query(models.BookNotification).filter(
        models.BookNotification.book_id == req.book_id,
        models.BookNotification.user_id == req.user_id,
        models.BookNotification.status.in_([NotificationStatus.waiting, NotificationStatus.notified])
    ).first()
    if existing:
        if existing.status == NotificationStatus.notified:
            raise HTTPException(status_code=400, detail="You have already been notified")
        raise HTTPException(status_code=400, detail=f"Already #{existing.queue_position} in queue")
    queue_count = db.query(models.BookNotification).filter(
        models.BookNotification.book_id == req.book_id,
        models.BookNotification.status == NotificationStatus.waiting
    ).count()
    notification = models.BookNotification(
        book_id=req.book_id, user_id=req.user_id,
        queue_position=queue_count + 1, status=NotificationStatus.waiting,
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return {"message": f"Added to queue at position #{notification.queue_position}.", "queue_position": notification.queue_position}


@api.get("/api/notifications/user/{user_id}", response_model=list[schemas.NotificationOut])
def get_user_notifications(user_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    auth.ensure_self_or_staff(current, user_id)
    user_notifs = db.query(models.BookNotification).filter(
        models.BookNotification.user_id == user_id,
        models.BookNotification.status == NotificationStatus.notified
    ).all()
    now = datetime.utcnow()
    for n in user_notifs:
        if n.expires_at and n.expires_at < now:
            n.status = NotificationStatus.expired
            queue_count = db.query(models.BookNotification).filter(
                models.BookNotification.book_id == n.book_id,
                models.BookNotification.status == NotificationStatus.waiting
            ).count()
            db.add(models.BookNotification(
                book_id=n.book_id, user_id=n.user_id,
                queue_position=queue_count + 1, status=NotificationStatus.waiting,
            ))
    db.commit()
    return db.query(models.BookNotification).filter(
        models.BookNotification.user_id == user_id,
        models.BookNotification.status.in_([NotificationStatus.waiting, NotificationStatus.notified])
    ).order_by(models.BookNotification.requested_at.desc()).all()


@api.delete("/api/notifications/{notification_id}")
def cancel_notification(notification_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    n = db.query(models.BookNotification).filter(models.BookNotification.id == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Not found")
    auth.ensure_self_or_staff(current, n.user_id)
    db.delete(n)
    db.commit()
    return {"message": "Removed from queue"}


# ─────────────────────────────────────────────────────────────────────────────
# Override requests
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/overrides", response_model=schemas.OverrideRequestOut)
def create_override(req: schemas.OverrideRequestCreate, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.librarian))):
    req.requested_by = current.id
    override = models.OverrideRequest(
        requested_by=req.requested_by, reason=req.reason,
        affected_record=req.affected_record, status=OverrideStatus.pending,
    )
    db.add(override)
    db.commit()
    db.refresh(override)
    return override


@api.get("/api/overrides/pending", dependencies=[Depends(auth.require_roles(RoleEnum.hod, RoleEnum.admin))], response_model=list[schemas.OverrideRequestOut])
def get_pending_overrides(db: Session = Depends(get_db)):
    return db.query(models.OverrideRequest).filter(
        models.OverrideRequest.status == OverrideStatus.pending
    ).order_by(models.OverrideRequest.created_at).all()


@api.get("/api/overrides/librarian/{librarian_id}", response_model=list[schemas.OverrideRequestOut])
def get_librarian_overrides(librarian_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    if current.id != librarian_id and current.role.value not in ("hod", "admin"):
        raise HTTPException(status_code=403, detail="You can only view your own overrides.")
    return db.query(models.OverrideRequest).filter(
        models.OverrideRequest.requested_by == librarian_id
    ).order_by(models.OverrideRequest.created_at.desc()).all()


@api.post("/api/overrides/review")
def review_override(action: schemas.OverrideAction, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.hod))):
    action.reviewed_by = current.id
    override = db.query(models.OverrideRequest).filter(models.OverrideRequest.id == action.override_id).first()
    if not override:
        raise HTTPException(status_code=404, detail="Override request not found")
    if not action.comment:
        raise HTTPException(status_code=400, detail="Comment is required")
    if action.action == "approve":
        override.status = OverrideStatus.approved
    elif action.action == "reject":
        override.status = OverrideStatus.rejected
    else:
        raise HTTPException(status_code=400, detail="Action must be approve or reject")
    override.hod_comment = action.comment
    override.reviewed_by = action.reviewed_by
    override.reviewed_at = datetime.utcnow()
    db.commit()
    return {"message": f"Override {action.action}d"}


# ─────────────────────────────────────────────────────────────────────────────
# Analytics
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/analytics/summary", dependencies=[Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.hod, RoleEnum.admin))])
def get_analytics(db: Session = Depends(get_db)):
    total_books = db.query(models.Book).filter(models.Book.is_active == True).count()
    total_copies = db.query(func.sum(models.Book.total_copies)).filter(models.Book.is_active == True).scalar() or 0
    issued_copies = db.query(models.BookCopy).filter(models.BookCopy.status == CopyStatus.issued).count()
    reserved_copies = db.query(models.BookCopy).filter(models.BookCopy.status == CopyStatus.reserved).count()
    overdue_copies = db.query(models.BookCopy).filter(
        models.BookCopy.status == CopyStatus.issued,
        models.BookCopy.due_date < datetime.utcnow()
    ).count()
    pending_overrides = db.query(models.OverrideRequest).filter(
        models.OverrideRequest.status == OverrideStatus.pending
    ).count()
    most_borrowed = db.query(
        models.Book.title, models.Book.author,
        func.count(models.BookHistory.id).label("borrow_count")
    ).join(models.BookHistory, models.Book.id == models.BookHistory.book_id).filter(
        models.BookHistory.change_type == "issued"
    ).group_by(models.Book.id).order_by(func.count(models.BookHistory.id).desc()).limit(5).all()

    return {
        "total_books": total_books,
        "total_copies": int(total_copies),
        "issued_copies": issued_copies,
        "reserved_copies": reserved_copies,
        "overdue_copies": overdue_copies,
        "pending_overrides": pending_overrides,
        "most_borrowed": [{"title": r[0], "author": r[1], "borrow_count": r[2]} for r in most_borrowed],
    }

# ─────────────────────────────────────────────────────────────────────────────
# Reading History
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/student/history/{user_id}")
def get_reading_history(user_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    auth.ensure_self_or_staff(current, user_id)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Get all history entries where this student's roll number appears in return/issued records
    issued_history = db.query(models.BookHistory).filter(
        models.BookHistory.change_type == "issued",
        models.BookHistory.change_detail.ilike(f"%{user.roll_number}%")
    ).order_by(models.BookHistory.changed_at.desc()).all()

    returned_history = db.query(models.BookHistory).filter(
        models.BookHistory.change_type.in_(["returned", "returned_damaged", "reported_lost"]),
        models.BookHistory.change_detail.ilike(f"%{user.roll_number}%")
    ).order_by(models.BookHistory.changed_at.desc()).all()

    renewed_history = db.query(models.BookHistory).filter(
        models.BookHistory.change_type == "renewed",
        models.BookHistory.change_detail.ilike(f"%{user.roll_number}%")
    ).order_by(models.BookHistory.changed_at.desc()).all()

    # Build a merged timeline grouped by book
    book_ids = set(h.book_id for h in issued_history + returned_history + renewed_history)
    books = {b.id: b for b in db.query(models.Book).filter(models.Book.id.in_(book_ids)).all()}

    # Group events by book
    timeline = {}
    for h in issued_history + returned_history + renewed_history:
        if h.book_id not in timeline:
            book = books.get(h.book_id)
            timeline[h.book_id] = {
                "book_id": h.book_id,
                "book_title": book.title if book else "Unknown",
                "book_author": book.author if book else "Unknown",
                "cover_image": book.cover_image if book else None,
                "events": [],
            }
        timeline[h.book_id]["events"].append({
            "type": h.change_type,
            "detail": h.change_detail,
            "date": h.changed_at,
        })

    # Sort events within each book and sort books by most recent event
    result = []
    for entry in timeline.values():
        entry["events"].sort(key=lambda e: e["date"], reverse=True)
        entry["last_activity"] = entry["events"][0]["date"] if entry["events"] else None
        entry["times_borrowed"] = sum(1 for e in entry["events"] if e["type"] == "issued")
        entry["times_renewed"] = sum(1 for e in entry["events"] if e["type"] == "renewed")
        result.append(entry)

    result.sort(key=lambda x: x["last_activity"] or datetime.min, reverse=True)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Wishlist
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/wishlist/{user_id}")
def get_wishlist(user_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    auth.ensure_self_or_staff(current, user_id)
    items = db.query(models.Wishlist).filter(
        models.Wishlist.user_id == user_id
    ).order_by(models.Wishlist.added_at.desc()).all()
    return [
        {
            "id": w.id,
            "book_id": w.book_id,
            "added_at": w.added_at,
            "book_title": w.book.title,
            "book_author": w.book.author,
            "cover_image": w.book.cover_image,
            "available_copies": w.book.available_copies,
            "book_type": w.book.book_type,
        }
        for w in items
    ]


@api.post("/api/wishlist")
def add_to_wishlist(user_id: int, book_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    if user_id != current.id:
        raise HTTPException(status_code=403, detail="You can only edit your own wishlist.")
    existing = db.query(models.Wishlist).filter(
        models.Wishlist.user_id == user_id,
        models.Wishlist.book_id == book_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Book already in wishlist")

    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    item = models.Wishlist(user_id=user_id, book_id=book_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"message": f"'{book.title}' added to your wishlist", "id": item.id}


@api.delete("/api/wishlist/{wishlist_id}")
def remove_from_wishlist(wishlist_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    item = db.query(models.Wishlist).filter(models.Wishlist.id == wishlist_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Wishlist item not found")
    auth.ensure_self_or_staff(current, item.user_id)
    db.delete(item)
    db.commit()
    return {"message": "Removed from wishlist"}


@api.get("/api/wishlist/{user_id}/check/{book_id}")
def check_wishlist(user_id: int, book_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    auth.ensure_self_or_staff(current, user_id)
    item = db.query(models.Wishlist).filter(
        models.Wishlist.user_id == user_id,
        models.Wishlist.book_id == book_id
    ).first()
    return {"in_wishlist": item is not None, "wishlist_id": item.id if item else None}


# ─────────────────────────────────────────────────────────────────────────────
# Book Requests (student new book + librarian more copies)
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/book-requests", response_model=schemas.BookRequestOut)
def create_book_request(req: schemas.BookRequestCreate, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    req.requested_by = current.id
    request = models.BookRequest(
        requested_by=req.requested_by,
        title=req.title,
        author=req.author,
        isbn=req.isbn,
        reason=req.reason,
        request_type=req.request_type,
        book_id=req.book_id,
        status="pending",
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


@api.get("/api/book-requests", dependencies=[Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.hod, RoleEnum.admin))], response_model=list[schemas.BookRequestOut])
def get_book_requests(
    status: str = None,
    request_type: str = None,
    db: Session = Depends(get_db)
):
    q = db.query(models.BookRequest)
    if status:
        q = q.filter(models.BookRequest.status == status)
    if request_type:
        q = q.filter(models.BookRequest.request_type == request_type)
    return q.order_by(models.BookRequest.created_at.desc()).all()


@api.get("/api/book-requests/user/{user_id}", response_model=list[schemas.BookRequestOut])
def get_user_book_requests(user_id: int, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    auth.ensure_self_or_staff(current, user_id)
    return db.query(models.BookRequest).filter(
        models.BookRequest.requested_by == user_id
    ).order_by(models.BookRequest.created_at.desc()).all()


@api.post("/api/book-requests/review")
def review_book_request(req: schemas.BookRequestReview, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.hod))):
    req.reviewed_by = current.id
    request = db.query(models.BookRequest).filter(models.BookRequest.id == req.request_id).first()
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    if request.status != "pending":
        raise HTTPException(status_code=400, detail="Request already reviewed")
    if req.action not in ["approved", "rejected"]:
        raise HTTPException(status_code=400, detail="Action must be approved or rejected")

    request.status = req.action
    request.hod_comment = req.comment
    request.reviewed_by = req.reviewed_by
    request.reviewed_at = datetime.utcnow()
    db.commit()
    return {"message": f"Request {req.action}"}


# ─────────────────────────────────────────────────────────────────────────────
# Announcements
# ─────────────────────────────────────────────────────────────────────────────

@api.post("/api/announcements", response_model=schemas.AnnouncementOut)
def create_announcement(req: schemas.AnnouncementCreate, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.admin))):
    req.created_by = current.id
    ann = models.Announcement(
        title=req.title,
        body=req.body,
        created_by=req.created_by,
        is_active=True,
        expires_at=req.expires_at,
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return ann


@api.get("/api/announcements", response_model=list[schemas.AnnouncementOut])
def get_announcements(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    return db.query(models.Announcement).filter(
        models.Announcement.is_active == True,
        or_(
            models.Announcement.expires_at.is_(None),
            models.Announcement.expires_at > now
        )
    ).order_by(models.Announcement.created_at.desc()).all()


@api.delete("/api/announcements/{ann_id}", dependencies=[Depends(auth.require_roles(RoleEnum.admin))])
def deactivate_announcement(ann_id: int, db: Session = Depends(get_db)):
    ann = db.query(models.Announcement).filter(models.Announcement.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")
    ann.is_active = False
    db.commit()
    return {"message": "Announcement removed"}


@api.post("/api/broadcasts", response_model=schemas.BroadcastOut)
def create_broadcast(req: schemas.BroadcastCreate, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.admin))):
    req.created_by = current.id
    if not req.title.strip() or not req.body.strip():
        raise HTTPException(status_code=400, detail="Title and body are required")
    if not req.target_roles:
        raise HTTPException(status_code=400, detail="At least one target role is required")

    broadcast = models.BroadcastMessage(
        title=req.title.strip(),
        body=req.body.strip(),
        target_roles=normalize_role_list(req.target_roles),
        created_by=req.created_by,
        is_active=True,
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db.add(broadcast)
    db.commit()
    db.refresh(broadcast)
    return broadcast


@api.get("/api/broadcasts", response_model=list[schemas.BroadcastOut])
def get_active_broadcasts(role: str = None, db: Session = Depends(get_db), current: models.User = Depends(auth.get_current_user)):
    # Always filter by the caller's own role; ignore any client-supplied value.
    role = current.role.value
    now = datetime.utcnow()
    query = db.query(models.BroadcastMessage).filter(
        models.BroadcastMessage.is_active == True,
        models.BroadcastMessage.expires_at > now
    )
    if role:
        query = query.filter(
            or_(
                models.BroadcastMessage.target_roles == role,
                models.BroadcastMessage.target_roles.like(f"{role},%"),
                models.BroadcastMessage.target_roles.like(f"%,{role},%"),
                models.BroadcastMessage.target_roles.like(f"%,{role}")
            )
        )
    return query.order_by(models.BroadcastMessage.created_at.desc()).all()


@api.get("/api/broadcasts/all", dependencies=[Depends(auth.require_roles(RoleEnum.admin))], response_model=list[schemas.BroadcastOut])
def get_all_broadcasts(db: Session = Depends(get_db)):
    return db.query(models.BroadcastMessage).order_by(
        models.BroadcastMessage.created_at.desc()
    ).all()


@api.delete("/api/broadcasts/{broadcast_id}", dependencies=[Depends(auth.require_roles(RoleEnum.admin))])
def deactivate_broadcast(broadcast_id: int, db: Session = Depends(get_db)):
    broadcast = db.query(models.BroadcastMessage).filter(
        models.BroadcastMessage.id == broadcast_id
    ).first()
    if not broadcast:
        raise HTTPException(status_code=404, detail="Broadcast not found")
    broadcast.is_active = False
    db.commit()
    return {"message": "Broadcast removed"}


@api.post("/api/carousels", response_model=schemas.CarouselOut)
def create_carousel(req: schemas.CarouselCreate, db: Session = Depends(get_db), current: models.User = Depends(auth.require_roles(RoleEnum.admin))):
    req.created_by = current.id
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message is required")
    if len(req.message.strip()) > 200:
        raise HTTPException(status_code=400, detail="Message must be 200 characters or less")

    carousel = models.CarouselMessage(
        message=req.message.strip(),
        created_by=req.created_by,
        is_active=True,
        expires_at=datetime.utcnow() + timedelta(hours=24),
    )
    db.add(carousel)
    db.commit()
    db.refresh(carousel)
    return carousel


@api.get("/api/carousels", response_model=list[schemas.CarouselOut])
def get_active_carousels(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    return db.query(models.CarouselMessage).filter(
        models.CarouselMessage.is_active == True,
        models.CarouselMessage.expires_at > now
    ).order_by(models.CarouselMessage.created_at.desc()).all()


@api.get("/api/carousels/all", dependencies=[Depends(auth.require_roles(RoleEnum.admin))], response_model=list[schemas.CarouselOut])
def get_all_carousels(db: Session = Depends(get_db)):
    return db.query(models.CarouselMessage).order_by(
        models.CarouselMessage.created_at.desc()
    ).all()


@api.delete("/api/carousels/{carousel_id}", dependencies=[Depends(auth.require_roles(RoleEnum.admin))])
def deactivate_carousel(carousel_id: int, db: Session = Depends(get_db)):
    carousel = db.query(models.CarouselMessage).filter(
        models.CarouselMessage.id == carousel_id
    ).first()
    if not carousel:
        raise HTTPException(status_code=404, detail="Carousel message not found")
    carousel.is_active = False
    db.commit()
    return {"message": "Carousel message removed"}


# ─────────────────────────────────────────────────────────────────────────────
# Department analytics
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/analytics/department", dependencies=[Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.hod, RoleEnum.admin))])
def get_department_analytics(db: Session = Depends(get_db)):
    COURSE_MAP_LOCAL = {
        "CS": "Computer Science", "AI": "AI/ML", "EC": "ECE",
        "EE": "EEE", "ME": "Mechanical Engineering",
        "CV": "Civil Engineering", "BT": "Biotechnology",
    }

    now = datetime.utcnow()
    result = {}

    for prefix, name in COURSE_MAP_LOCAL.items():
        # Count students in this course by roll number pattern
        students = db.query(models.User).filter(
            models.User.role == RoleEnum.student,
            models.User.roll_number.ilike(f"%{prefix}%")
        ).all()

        student_rolls = [s.roll_number for s in students]

        # Currently issued
        issued = db.query(models.BookCopy).filter(
            models.BookCopy.issued_to_roll.in_(student_rolls),
            models.BookCopy.status == CopyStatus.issued
        ).count() if student_rolls else 0

        # Overdue
        overdue = db.query(models.BookCopy).filter(
            models.BookCopy.issued_to_roll.in_(student_rolls),
            models.BookCopy.status == CopyStatus.issued,
            models.BookCopy.due_date < now
        ).count() if student_rolls else 0

        # Total borrows ever (from history)
        total_borrows = db.query(models.BookHistory).filter(
            models.BookHistory.change_type == "issued",
        ).count()  # approximate — filter by roll in Python if needed

        # Fines
        pending_fines = db.query(models.FineRecord).filter(
            models.FineRecord.roll_number.in_(student_rolls),
            models.FineRecord.is_cleared == False
        ).with_entities(func.sum(models.FineRecord.remaining)).scalar() or 0 if student_rolls else 0

        result[prefix] = {
            "course": name,
            "prefix": prefix,
            "student_count": len(students),
            "currently_issued": issued,
            "overdue": overdue,
            "pending_fines": round(float(pending_fines), 2),
        }

    # Most borrowed subjects from book history
    subject_borrows = db.query(
        models.Book.subject,
        func.count(models.BookHistory.id).label("count")
    ).join(models.BookHistory, models.Book.id == models.BookHistory.book_id).filter(
        models.BookHistory.change_type == "issued"
    ).group_by(models.Book.subject).order_by(
        func.count(models.BookHistory.id).desc()
    ).limit(10).all()

    return {
        "by_course": list(result.values()),
        "by_subject": [{"subject": r.subject, "count": r.count} for r in subject_borrows],
    }

# ─────────────────────────────────────────────────────────────────────────────
# HOD Reports
# ─────────────────────────────────────────────────────────────────────────────

@api.get("/api/reports/hod", dependencies=[Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.hod, RoleEnum.admin))])
def hod_report(
    type: str = "issued",
    date_from: str = None,
    date_to: str = None,
    course: str = None,
    db: Session = Depends(get_db)
):
    df = parse_date(date_from)
    dt = parse_date(date_to)

    if type == "issued":
        q = db.query(models.BookCopy).filter(models.BookCopy.status == CopyStatus.issued)
        if df:
            q = q.filter(models.BookCopy.issued_at >= df)
        if dt:
            q = q.filter(models.BookCopy.issued_at <= dt)
        copies = q.all()
        if course and course != "all":
            copies = [c for c in copies if c.book.courses and course in c.book.courses.split(",")]
        rows = [{
            "Roll No": c.issued_to_roll,
            "Book Title": c.book.title,
            "Copy Code": c.copy_code,
            "Issued On": c.issued_at.strftime("%d %b %Y") if c.issued_at else "—",
            "Due Date": c.due_date.strftime("%d %b %Y") if c.due_date else "—",
            "Renewals": c.renewal_count,
            "Courses": c.book.courses or "—",
        } for c in copies]
        summary = {
            "Total Issued": len(rows),
            "Unique Students": len(set(c.issued_to_roll for c in copies)),
            "Overdue": sum(1 for c in copies if c.due_date and c.due_date < datetime.utcnow()),
        }

    elif type == "overdue":
        now = datetime.utcnow()
        rate = get_fine_per_day(db)
        q = db.query(models.BookCopy).filter(
            models.BookCopy.status == CopyStatus.issued,
            models.BookCopy.due_date < now
        )
        copies = q.all()
        if course and course != "all":
            copies = [c for c in copies if c.book.courses and course in c.book.courses.split(",")]
        rows = [{
            "Roll No": c.issued_to_roll,
            "Book Title": c.book.title,
            "Copy Code": c.copy_code,
            "Due Date": c.due_date.strftime("%d %b %Y") if c.due_date else "—",
            "Days Overdue": max(0, (now - c.due_date).days) if c.due_date else 0,
            "Fine (Rs.)": max(0, (now - c.due_date).days) * rate if c.due_date else 0,
        } for c in copies]
        total_fine = sum(r["Fine (Rs.)"] for r in rows)
        summary = {
            "Total Overdue": len(rows),
            "Unique Students": len(set(c.issued_to_roll for c in copies)),
            "Total Fine (Rs.)": total_fine,
        }

    elif type == "fines":
        q = db.query(models.FineRecord)
        if df:
            q = q.filter(models.FineRecord.created_at >= df)
        if dt:
            q = q.filter(models.FineRecord.created_at <= dt)
        fines = q.order_by(models.FineRecord.created_at.desc()).all()
        rows = [{
            "Roll No": f.roll_number,
            "Book Title": f.book_title or "—",
            "Copy Code": f.copy_code or "—",
            "Total Fine (Rs.)": f.total_fine,
            "Paid (Rs.)": f.amount_paid,
            "Remaining (Rs.)": f.remaining,
            "Status": "Cleared" if f.is_cleared else "Pending",
            "Date": f.created_at.strftime("%d %b %Y") if f.created_at else "—",
        } for f in fines]
        summary = {
            "Total Records": len(fines),
            "Total Fines (Rs.)": sum(f.total_fine for f in fines),
            "Collected (Rs.)": sum(f.amount_paid for f in fines),
            "Pending (Rs.)": sum(f.remaining for f in fines),
            "Cleared": sum(1 for f in fines if f.is_cleared),
        }

    elif type == "returned":
        q = db.query(models.BookHistory).filter(
            models.BookHistory.change_type.in_(["returned", "returned_damaged", "reported_lost"])
        )
        if df:
            q = q.filter(models.BookHistory.changed_at >= df)
        if dt:
            q = q.filter(models.BookHistory.changed_at <= dt)
        records = q.order_by(models.BookHistory.changed_at.desc()).all()
        rows = [{
            "Book Title": r.book.title if r.book else "—",
            "Action": r.change_type.replace("_", " ").title(),
            "Detail": (r.change_detail or "")[:80],
            "Date": r.changed_at.strftime("%d %b %Y %H:%M") if r.changed_at else "—",
        } for r in records]
        summary = {
            "Total Returns": len([r for r in records if r.change_type == "returned"]),
            "Damaged Returns": len([r for r in records if r.change_type == "returned_damaged"]),
            "Lost Reports": len([r for r in records if r.change_type == "reported_lost"]),
        }

    elif type == "reserved":
        q = db.query(models.BookCopy).filter(models.BookCopy.status == CopyStatus.reserved)
        copies = q.all()
        if course and course != "all":
            copies = [c for c in copies if c.book.courses and course in c.book.courses.split(",")]
        now = datetime.utcnow()
        rows = [{
            "Roll No": c.reserved_by_roll,
            "Book Title": c.book.title,
            "Copy Code": c.copy_code,
            "Reserved At": c.reserved_at.strftime("%d %b %Y %H:%M") if c.reserved_at else "—",
            "Expires At": c.reservation_expires_at.strftime("%d %b %Y %H:%M") if c.reservation_expires_at else "—",
            "Status": "Expiring Soon" if c.reservation_expires_at and (c.reservation_expires_at - now).total_seconds() < 3600 else "Active",
        } for c in copies]
        summary = {
            "Total Reserved": len(rows),
            "Expiring Soon": sum(1 for r in rows if r["Status"] == "Expiring Soon"),
        }

    elif type == "popular":
        results = db.query(
            models.Book.title,
            models.Book.author,
            models.Book.courses,
            func.count(models.BookHistory.id).label("issue_count")
        ).join(models.BookHistory, models.Book.id == models.BookHistory.book_id).filter(
            models.BookHistory.change_type == "issued"
        )
        if df:
            results = results.filter(models.BookHistory.changed_at >= df)
        if dt:
            results = results.filter(models.BookHistory.changed_at <= dt)
        if course and course != "all":
            results = results.filter(
                or_(
                    models.Book.courses.ilike(f"{course},%"),
                    models.Book.courses.ilike(f"%,{course},%"),
                    models.Book.courses.ilike(f"%,{course}"),
                    models.Book.courses == course,
                )
            )
        results = results.group_by(models.Book.id).order_by(func.count(models.BookHistory.id).desc()).limit(50).all()
        rows = [{
            "Book Title": r.title,
            "Author": r.author,
            "Courses": r.courses or "—",
            "Times Issued": r.issue_count,
        } for r in results]
        summary = {
            "Books in Report": len(rows),
            "Total Issues": sum(r["Times Issued"] for r in rows),
        }

    elif type == "students":
        users = db.query(models.User).filter(
            models.User.role == RoleEnum.student,
            models.User.is_approved == True
        ).all()
        if course and course != "all":
            users = [u for u in users if course.upper() in u.roll_number.upper()]
        rows_list = []
        for u in users:
            issued_count = db.query(models.BookCopy).filter(
                models.BookCopy.issued_to_roll == u.roll_number,
                models.BookCopy.status == CopyStatus.issued
            ).count()
            total_issued = db.query(models.BookHistory).filter(
                models.BookHistory.change_type == "issued",
                models.BookHistory.change_detail.ilike(f"%{u.roll_number}%")
            ).count()
            pending_fines = db.query(models.FineRecord).filter(
                models.FineRecord.roll_number == u.roll_number,
                models.FineRecord.is_cleared == False
            ).with_entities(func.sum(models.FineRecord.remaining)).scalar() or 0
            rows_list.append({
                "Roll No": u.roll_number,
                "Email": u.email,
                "Blocked": "Yes" if u.is_blocked else "No",
                "Currently Issued": issued_count,
                "Total Ever Issued": total_issued,
                "Pending Fines (Rs.)": round(pending_fines, 2),
            })
        rows = rows_list
        summary = {
            "Total Students": len(rows),
            "Currently Borrowing": sum(r["Currently Issued"] for r in rows),
            "With Pending Fines": sum(1 for r in rows if r["Pending Fines (Rs.)"] > 0),
            "Blocked": sum(1 for r in rows if r["Blocked"] == "Yes"),
        }

    else:
        raise HTTPException(status_code=400, detail="Unknown report type")

    return {"rows": rows, "total_rows": len(rows), "summary": summary}


@api.get("/api/reports/hod/export", dependencies=[Depends(auth.require_roles(RoleEnum.librarian, RoleEnum.hod, RoleEnum.admin))])
def hod_report_export(
    type: str = "issued",
    date_from: str = None,
    date_to: str = None,
    course: str = None,
    db: Session = Depends(get_db)
):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    report = hod_report(type=type, date_from=date_from, date_to=date_to, course=course, db=db)
    rows = report["rows"]

    wb = openpyxl.Workbook()
    ws = wb.active

    REPORT_LABELS = {
        "issued": "Books Issued", "overdue": "Overdue Books",
        "fines": "Fines Report", "returned": "Returns History",
        "reserved": "Active Reservations", "popular": "Most Borrowed Books",
        "students": "Student Activity",
    }
    ws.title = REPORT_LABELS.get(type, "Report")

    header_fill = PatternFill("solid", fgColor="1e3a5f")
    header_font = Font(bold=True, color="FFFFFF", size=11)

    if rows:
        headers = list(rows[0].keys())
        for ci, h in enumerate(headers, 1):
            cell = ws.cell(row=1, column=ci, value=h)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        for ri, row in enumerate(rows, 2):
            for ci, val in enumerate(row.values(), 1):
                ws.cell(row=ri, column=ci, value=val)
                if ri % 2 == 0:
                    ws.cell(row=ri, column=ci).fill = PatternFill("solid", fgColor="f0f4f8")

        for ci, col in enumerate(ws.columns, 1):
            max_len = max((len(str(c.value)) if c.value else 0) for c in col)
            ws.column_dimensions[get_column_letter(ci)].width = min(max_len + 4, 50)

        ws.row_dimensions[1].height = 22

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"{type}_report_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# Mount the protected routes (must come after every @api decorator above).
app.include_router(api)
