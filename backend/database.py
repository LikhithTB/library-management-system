from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from config import DATABASE_URL
import os

# Force the psycopg2 driver explicitly. Newer SQLAlchemy releases have
# changed which driver a bare "postgresql://" URL resolves to by default
# (some versions now prefer psycopg v3, which isn't installed here — only
# psycopg2-binary is). Pinning the dialect in the URL itself makes this
# immune to that kind of default-behavior change on future rebuilds,
# regardless of which SQLAlchemy version pip happens to resolve.
_engine_url = DATABASE_URL
if _engine_url.startswith("postgresql://"):
    _engine_url = _engine_url.replace("postgresql://", "postgresql+psycopg2://", 1)

_parsed_url = make_url(_engine_url)
if _parsed_url.host and (
    _parsed_url.host.endswith(".supabase.co")
    or _parsed_url.host.endswith(".pooler.supabase.com")
):
    _query = dict(_parsed_url.query)
    _query["sslmode"] = "require"
    _engine_url = _parsed_url.set(query=_query)

# Vercel may start many short-lived function instances. Keep each instance's
# local SQLAlchemy pool small so the combined connection count stays within
# Supabase's limits. Local/container deployments retain SQLAlchemy defaults.
_engine_options = {"pool_pre_ping": True}
if os.environ.get("VERCEL"):
    _engine_options.update(pool_size=1, max_overflow=0, pool_recycle=300)

engine = create_engine(_engine_url, **_engine_options)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
