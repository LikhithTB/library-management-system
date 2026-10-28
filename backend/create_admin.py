
from database import SessionLocal, Base, engine
import models

Base.metadata.create_all(bind=engine)

db = SessionLocal()

existing = db.query(models.User).filter(models.User.role == models.RoleEnum.admin).first()
if existing:
    print("Admin account already exists.")
else:
    admin = models.User(
        roll_number="ADMIN001",
        email="admin@library.com",
        hashed_password="admin123",  
        role=models.RoleEnum.admin,
        is_blocked=False,
        is_approved=True,
        role_locked=True,
    )
    db.add(admin)
    db.commit()
    print("Admin created.")
    print("Roll Number: ADMIN001")
    print("Password: admin123")

db.close()