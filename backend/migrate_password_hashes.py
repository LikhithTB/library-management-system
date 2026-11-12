"""One-time (idempotent) upgrade: hashes every legacy plaintext password.

Accounts that have never logged in since the upgrade still hold their password
in plaintext. Running this converts them to scrypt hashes without knowing the
passwords. Safe to re-run; already-hashed rows are skipped.

    python migrate_password_hashes.py
"""
from database import SessionLocal
import auth
import models


def main():
    db = SessionLocal()
    try:
        users = db.query(models.User).all()
        converted = 0
        for user in users:
            if not auth.is_hashed(user.hashed_password or ""):
                user.hashed_password = auth.hash_password(user.hashed_password or "")
                converted += 1
        db.commit()
        print(f"Password migration complete. Converted {converted} of {len(users)} account(s).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
