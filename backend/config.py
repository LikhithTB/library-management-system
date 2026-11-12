import os

APP_NAME = "Library Management System"
APP_VERSION = "1.0.0"

# No fallback: a real database password must come from the environment
# (.env / docker-compose). A hardcoded default here would ship in the image.
DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Copy .env.example to .env and fill it in.")


STUDENT_EMAIL_IDENTIFIER = ".stu"
ROLES_REQUIRING_HOD_APPROVAL = ["librarian", "staff"]
ROLES_REQUIRING_ADMIN_APPROVAL = ["hod"]

BOOK_ISSUE_DAYS = 14
MAX_FREE_RENEWALS = 2
RENEWAL_EARLY_DAYS = 3        # student can renew this many days before due date
RENEWAL_WINDOW_DAYS = 14      # days added to due date per renewal
MAX_BOOKS_PER_STUDENT = 3
FINE_PER_DAY = 5
DUE_SOON_ALERT_DAYS = 3

NOTIFICATION_WINDOW_HOURS = 24

COURSE_MAP = {
    "CS": "Computer Science",
    "AI": "AI/ML",
    "EC": "ECE",
    "EE": "EEE",
    "ME": "Mechanical Engineering",
    "CV": "Civil Engineering",
    "BT": "Biotechnology",
}