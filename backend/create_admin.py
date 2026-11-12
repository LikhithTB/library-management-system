"""Seeds the first admin account if none exists.

The initial password comes from ADMIN_INITIAL_PASSWORD. If that variable is
not set, a random password is generated and printed once to the log. It is
always stored hashed. Change it after the first login with reset_password.py.
"""
import os
import secrets
import sys

from database import SessionLocal, Base, engine
import auth
import models

ADMIN_ROLL = "ADMIN001"
ADMIN_EMAIL = "admin@library.com"

Base.metadata.create_all(bind=engine)

db = SessionLocal()
try:
    existing = db.query(models.User).filter(models.User.role == models.RoleEnum.admin).first()
    if existing:
        print("Admin account already exists.")
    else:
        password = os.environ.get("ADMIN_INITIAL_PASSWORD", "").strip()
        generated = not password
        if generated:
            password = secrets.token_urlsafe(16)
        if len(password) < 8:
            print("ADMIN_INITIAL_PASSWORD must be at least 8 characters.")
            sys.exit(1)

        admin = models.User(
            roll_number=ADMIN_ROLL,
            email=ADMIN_EMAIL,
            hashed_password=auth.hash_password(password),
            role=models.RoleEnum.admin,
            is_blocked=False,
            is_approved=True,
            approval_status=models.ApprovalStatus.approved,
            role_locked=True,
        )
        db.add(admin)
        db.commit()
        print("Admin created.")
        print(f"Roll Number: {ADMIN_ROLL}")
        if generated:
            print(f"Generated password (shown only once): {password}")
            print("Sign in and change it, or run: docker exec -it library-backend python reset_password.py ADMIN001")
        else:
            print("Password taken from ADMIN_INITIAL_PASSWORD.")
finally:
    db.close()
