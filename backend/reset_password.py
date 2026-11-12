"""Sets a new password for one account, typed at a hidden prompt.

    docker exec -it library-backend python reset_password.py ADMIN001

Used for admin recovery, because the app has no working self-service reset yet.
"""
import getpass
import sys

from database import SessionLocal
import auth
import models


def main():
    if len(sys.argv) != 2:
        print("Usage: python reset_password.py <roll_number>")
        sys.exit(2)
    roll = sys.argv[1]

    password = getpass.getpass("New password (min 8 characters): ")
    if len(password) < 8:
        print("Password must be at least 8 characters.")
        sys.exit(1)
    if getpass.getpass("Repeat new password: ") != password:
        print("Passwords do not match.")
        sys.exit(1)

    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.roll_number == roll).first()
        if not user:
            print(f"No account with roll number {roll}.")
            sys.exit(1)
        user.hashed_password = auth.hash_password(password)
        db.commit()
        print(f"Password updated for {roll}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
