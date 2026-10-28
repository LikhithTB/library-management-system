from sqlalchemy import Column, Integer, String, Boolean, Enum as SAEnum, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime
import enum

class RoleEnum(str, enum.Enum):
    student = "student"
    librarian = "librarian"
    hod = "hod"
    staff = "staff"
    admin = "admin"

class ApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"

class MediaType(str, enum.Enum):
    book = "book"
    magazine = "magazine"

class BookType(str, enum.Enum):
    borrowable = "borrowable"
    reference = "reference"

class CopyStatus(str, enum.Enum):
    available = "available"
    reserved = "reserved"
    issued = "issued"
    returned = "returned"
    lost = "lost"
    damaged = "damaged"

class NotificationStatus(str, enum.Enum):
    waiting = "waiting"
    notified = "notified"
    expired = "expired"
    fulfilled = "fulfilled"

class OverrideStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"

class AccountStatus(str, enum.Enum):
    active = "active"
    graduated = "graduated"
    dropped = "dropped"
    suspended = "suspended"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    roll_number = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(SAEnum(RoleEnum), nullable=False)
    is_blocked = Column(Boolean, default=False)
    role_locked = Column(Boolean, default=True)
    is_approved = Column(Boolean, default=False)
    approval_status = Column(SAEnum(ApprovalStatus), default=ApprovalStatus.pending)
    account_status = Column(SAEnum(AccountStatus), default=AccountStatus.active, nullable=False)
    # Set once by the student on their first login and never editable again
    # afterwards (see main.py's graduation-year endpoint). Drives the
    # automatic year-end account disable.
    graduation_year = Column(Integer, nullable=True)

    notifications = relationship("BookNotification", back_populates="user")
    override_requests = relationship("OverrideRequest", foreign_keys="OverrideRequest.requested_by", back_populates="requester")
    reviews = relationship("BookReview", back_populates="user")

class Book(Base):
    __tablename__ = "books"

    id = Column(Integer, primary_key=True, index=True)
    isbn = Column(String, index=True, nullable=False)
    title = Column(String, nullable=False)
    author = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    courses = Column(String, nullable=True)
    edition = Column(String, nullable=False)
    media_type = Column(SAEnum(MediaType), default=MediaType.book)
    book_code = Column(String, unique=True, index=True, nullable=False)
    book_type = Column(SAEnum(BookType), nullable=False)
    mrp = Column(Float, nullable=False)
    replacement_cost = Column(Float, nullable=False)
    total_copies = Column(Integer, default=1)
    available_copies = Column(Integer, default=1)
    elig_students = Column(Boolean, default=True)
    elig_teaching_staff = Column(Boolean, default=False)
    elig_non_teaching_staff = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    added_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    cover_image = Column(Text, nullable=True)

    copies = relationship("BookCopy", back_populates="book")
    history = relationship("BookHistory", back_populates="book")
    notifications = relationship("BookNotification", back_populates="book")
    reviews = relationship("BookReview", back_populates="book")

class BookCopy(Base):
    __tablename__ = "book_copies"

    id = Column(Integer, primary_key=True, index=True)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=False)
    copy_code = Column(String, unique=True, index=True, nullable=False)
    status = Column(SAEnum(CopyStatus), default=CopyStatus.available)
    condition_note = Column(String, nullable=True)
    reserved_by_roll = Column(String, nullable=True)
    reserved_at = Column(DateTime, nullable=True)
    reservation_expires_at = Column(DateTime, nullable=True)
    issued_to_roll = Column(String, nullable=True)
    issued_to_name = Column(String, nullable=True)
    issued_at = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=True)
    returned_at = Column(DateTime, nullable=True)
    renewal_count = Column(Integer, default=0)
    added_at = Column(DateTime, default=datetime.utcnow)

    book = relationship("Book", back_populates="copies")

class BookHistory(Base):
    __tablename__ = "book_history"

    id = Column(Integer, primary_key=True, index=True)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=False)
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    change_type = Column(String, nullable=False)
    change_detail = Column(Text, nullable=True)
    changed_at = Column(DateTime, default=datetime.utcnow)

    book = relationship("Book", back_populates="history")

class BookNotification(Base):
    __tablename__ = "book_notifications"

    id = Column(Integer, primary_key=True, index=True)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    queue_position = Column(Integer, nullable=False)
    status = Column(SAEnum(NotificationStatus), default=NotificationStatus.waiting)
    requested_at = Column(DateTime, default=datetime.utcnow)
    notified_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    fulfilled_at = Column(DateTime, nullable=True)

    book = relationship("Book", back_populates="notifications")
    user = relationship("User", back_populates="notifications")

class OverrideRequest(Base):
    __tablename__ = "override_requests"

    id = Column(Integer, primary_key=True, index=True)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    reason = Column(Text, nullable=False)
    affected_record = Column(String, nullable=False)
    status = Column(SAEnum(OverrideStatus), default=OverrideStatus.pending)
    hod_comment = Column(Text, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)

    requester = relationship("User", foreign_keys=[requested_by], back_populates="override_requests")

class CourseLimit(Base):
    __tablename__ = "course_limits"

    id = Column(Integer, primary_key=True, index=True)
    course_prefix = Column(String, unique=True, nullable=False)
    max_books = Column(Integer, default=3)
    set_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class BookReview(Base):
    __tablename__ = "book_reviews"

    id = Column(Integer, primary_key=True, index=True)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    rating = Column(Integer, nullable=False)       # 1-5
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    book = relationship("Book", back_populates="reviews")
    user = relationship("User", back_populates="reviews")

class FineRecord(Base):
    __tablename__ = "fine_records"

    id = Column(Integer, primary_key=True, index=True)
    roll_number = Column(String, index=True, nullable=False)
    total_fine = Column(Float, nullable=False)
    amount_paid = Column(Float, default=0)
    remaining = Column(Float, nullable=False)
    copy_code = Column(String, nullable=True)
    book_title = Column(String, nullable=True)
    is_cleared = Column(Boolean, default=False)
    recorded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class SystemSetting(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False, index=True)
    value = Column(String, nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Wishlist(Base):
    __tablename__ = "wishlists"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    book = relationship("Book")


class BookRequest(Base):
    __tablename__ = "book_requests"

    id = Column(Integer, primary_key=True, index=True)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    author = Column(String, nullable=True)
    isbn = Column(String, nullable=True)
    reason = Column(Text, nullable=True)
    request_type = Column(String, default="new")   # "new" = student, "copies" = librarian
    book_id = Column(Integer, ForeignKey("books.id"), nullable=True)  # for librarian copy requests
    status = Column(String, default="pending")      # pending / approved / rejected
    hod_comment = Column(Text, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)

    requester = relationship("User", foreign_keys=[requested_by])
    book = relationship("Book", foreign_keys=[book_id])


class Announcement(Base):
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)

    creator = relationship("User")


class BroadcastMessage(Base):
    __tablename__ = "broadcast_messages"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    target_roles = Column(String, nullable=False)  # comma-separated roles
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    creator = relationship("User")


class CarouselMessage(Base):
    __tablename__ = "carousel_messages"

    id = Column(Integer, primary_key=True, index=True)
    message = Column(Text, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    creator = relationship("User")


class SystemAlert(Base):
    """Admin-facing inbox for things the system needs a human to follow up
    on — e.g. a student's account was auto-disabled at graduation with
    outstanding dues that need manual collection."""
    __tablename__ = "system_alerts"

    id = Column(Integer, primary_key=True, index=True)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)