from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from models import RoleEnum, ApprovalStatus, AccountStatus, BookType, CopyStatus, MediaType, NotificationStatus, OverrideStatus
from datetime import datetime

class RegisterRequest(BaseModel):
    roll_number: str = Field(min_length=1, max_length=50)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Optional[RoleEnum] = None

class LoginRequest(BaseModel):
    roll_number: str = Field(max_length=50)
    password: str = Field(max_length=128)

class UserOut(BaseModel):
    id: int
    roll_number: str
    email: str
    role: RoleEnum
    is_blocked: bool
    is_approved: bool
    approval_status: ApprovalStatus
    account_status: AccountStatus
    graduation_year: Optional[int] = None

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserOut
    # True only for a student who has never set a graduation year yet —
    # the frontend should block on collecting it before showing anything else.
    needs_graduation_year: bool = False

class ApprovalAction(BaseModel):
    user_id: int
    action: str

class AccountStatusUpdate(BaseModel):
    user_id: int
    new_status: AccountStatus
    changed_by: int

class GraduationYearSubmit(BaseModel):
    user_id: int
    graduation_year: int

class SystemAlertOut(BaseModel):
    id: int
    message: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True

class BookCreate(BaseModel):
    isbn: str
    title: str
    author: str
    subject: str
    courses: Optional[str] = None
    edition: str
    media_type: MediaType
    mrp: float
    total_copies: int
    replacement_percent: int = 90
    elig_students: bool = True
    elig_teaching_staff: bool = False
    elig_non_teaching_staff: bool = False
    entry_date: str
    added_by: int
    cover_image: Optional[str] = None

class BookCopyOut(BaseModel):
    id: int
    book_id: int
    copy_code: str
    status: CopyStatus
    condition_note: Optional[str]
    reserved_by_roll: Optional[str]
    reserved_at: Optional[datetime]
    reservation_expires_at: Optional[datetime]
    issued_to_roll: Optional[str]
    issued_to_name: Optional[str]
    issued_at: Optional[datetime]
    due_date: Optional[datetime]
    returned_at: Optional[datetime]
    renewal_count: int = 0
    added_at: datetime

    class Config:
        from_attributes = True

class BookOut(BaseModel):
    id: int
    isbn: str
    title: str
    author: str
    subject: str
    courses: Optional[str]
    edition: str
    media_type: MediaType
    book_code: str
    book_type: BookType
    mrp: float
    replacement_cost: float
    total_copies: int
    available_copies: int
    elig_students: bool
    elig_teaching_staff: bool
    elig_non_teaching_staff: bool
    is_active: bool
    added_by: int
    created_at: datetime
    cover_image: Optional[str] = None
    copies: list[BookCopyOut] = []

    class Config:
        from_attributes = True

class BookHistoryOut(BaseModel):
    id: int
    book_id: int
    changed_by: int
    change_type: str
    change_detail: Optional[str]
    changed_at: datetime

    class Config:
        from_attributes = True

class NotificationRequest(BaseModel):
    book_id: int
    user_id: int

class NotificationOut(BaseModel):
    id: int
    book_id: int
    user_id: int
    queue_position: int
    status: NotificationStatus
    requested_at: datetime
    notified_at: Optional[datetime]
    expires_at: Optional[datetime]
    fulfilled_at: Optional[datetime]
    book: Optional[BookOut] = None

    class Config:
        from_attributes = True

class ReserveRequest(BaseModel):
    book_id: int
    user_id: int
    roll_number: str

class IssueRequest(BaseModel):
    copy_code: str
    roll_number: str
    librarian_id: int

class ReturnRequest(BaseModel):
    copy_code: str
    librarian_id: int
    condition: str = "good"
    condition_note: Optional[str] = None

class RenewRequest(BaseModel):
    copy_code: str
    user_id: int

class OverrideRequestCreate(BaseModel):
    requested_by: int
    reason: str
    affected_record: str

class OverrideAction(BaseModel):
    override_id: int
    action: str
    comment: str
    reviewed_by: int

class OverrideRequestOut(BaseModel):
    id: int
    requested_by: int
    reason: str
    affected_record: str
    status: OverrideStatus
    hod_comment: Optional[str]
    reviewed_by: Optional[int]
    created_at: datetime
    reviewed_at: Optional[datetime]
    requester: Optional[UserOut] = None

    class Config:
        from_attributes = True

class CourseLimitSet(BaseModel):
    course_prefix: str
    max_books: int
    set_by: int

class CourseLimitOut(BaseModel):
    id: int
    course_prefix: str
    max_books: int
    set_by: Optional[int]
    updated_at: datetime

    class Config:
        from_attributes = True

class ReviewCreate(BaseModel):
    book_id: int
    user_id: int
    rating: int      # 1-5
    notes: Optional[str] = None

class ReviewOut(BaseModel):
    id: int
    book_id: int
    rating: int
    notes: Optional[str]
    created_at: datetime
    # No user_id returned — anonymous

    class Config:
        from_attributes = True

class FinePayment(BaseModel):
    roll_number: str
    amount_paid: float
    fine_id: int
    recorded_by: int

class FineRecordOut(BaseModel):
    id: int
    roll_number: str
    total_fine: float
    amount_paid: float
    remaining: float
    copy_code: Optional[str]
    book_title: Optional[str]
    is_cleared: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class WishlistOut(BaseModel):
    id: int
    book_id: int
    added_at: datetime
    book: Optional[BookOut] = None

    class Config:
        from_attributes = True


class BookRequestCreate(BaseModel):
    requested_by: int
    title: str
    author: Optional[str] = None
    isbn: Optional[str] = None
    reason: Optional[str] = None
    request_type: str = "new"
    book_id: Optional[int] = None


class BookRequestOut(BaseModel):
    id: int
    requested_by: int
    title: str
    author: Optional[str]
    isbn: Optional[str]
    reason: Optional[str]
    request_type: str
    book_id: Optional[int]
    status: str
    hod_comment: Optional[str]
    reviewed_by: Optional[int]
    created_at: datetime
    reviewed_at: Optional[datetime]
    requester: Optional[UserOut] = None

    class Config:
        from_attributes = True


class BookRequestReview(BaseModel):
    request_id: int
    action: str        # approved / rejected
    comment: Optional[str] = None
    reviewed_by: int


class AnnouncementCreate(BaseModel):
    title: str
    body: str
    created_by: int
    expires_at: Optional[datetime] = None


class AnnouncementOut(BaseModel):
    id: int
    title: str
    body: str
    created_by: int
    is_active: bool
    created_at: datetime
    expires_at: Optional[datetime]

    class Config:
        from_attributes = True


class BroadcastCreate(BaseModel):
    title: str
    body: str
    target_roles: list[RoleEnum]
    created_by: int


class BroadcastOut(BaseModel):
    id: int
    title: str
    body: str
    target_roles: str
    created_by: int
    is_active: bool
    created_at: datetime
    expires_at: datetime

    class Config:
        from_attributes = True


class CarouselCreate(BaseModel):
    message: str
    created_by: int


class CarouselOut(BaseModel):
    id: int
    message: str
    created_by: int
    is_active: bool
    created_at: datetime
    expires_at: datetime

    class Config:
        from_attributes = True