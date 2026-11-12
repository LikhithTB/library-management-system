from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from config import DATABASE_URL

# Force the psycopg2 driver explicitly. Newer SQLAlchemy releases have
# changed which driver a bare "postgresql://" URL resolves to by default
# (some versions now prefer psycopg v3, which isn't installed here — only
# psycopg2-binary is). Pinning the dialect in the URL itself makes this
# immune to that kind of default-behavior change on future rebuilds,
# regardless of which SQLAlchemy version pip happens to resolve.
_engine_url = DATABASE_URL
if _engine_url.startswith("postgresql://"):
    _engine_url = _engine_url.replace("postgresql://", "postgresql+psycopg2://", 1)

# pool_pre_ping: test each pooled connection before use, so a database restart
# does not leave the app handing out dead connections (500 errors).
engine = create_engine(_engine_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()