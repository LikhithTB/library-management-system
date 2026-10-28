"""
One-time (idempotent) setup for the chatbot's database access:

  1. Create a dedicated "chatbot_ro" Postgres role with a password from
     the CHATBOT_DB_PASSWORD environment variable (falls back to a dev
     default so local runs without Docker still work).
  2. Give it CONNECT on this database, USAGE on the public schema, and a
     short statement_timeout so a slow/expensive query can't hang.
  3. Apply chatbot_setup.sql, which creates the curated read-only views
     the role is allowed to SELECT from (and grants SELECT on exactly
     those views — nothing on the raw tables).

Run automatically by entrypoint.sh on every container start. Safe to
run repeatedly: every step here is idempotent.
"""
import os
from pathlib import Path
from urllib.parse import urlparse

import psycopg2

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:0567@localhost:5432/library_db"
)
CHATBOT_DB_PASSWORD = os.environ.get("CHATBOT_DB_PASSWORD", "chatbot_dev_only")

SQL_FILE = Path(__file__).parent / "chatbot_setup.sql"


def main():
    parsed = urlparse(DATABASE_URL)
    dbname = parsed.path.lstrip("/")

    conn = psycopg2.connect(
        dbname=dbname,
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port or 5432,
    )
    conn.autocommit = True
    cur = conn.cursor()

    # 1. Create (or update the password on) the read-only role.
    #    The password is passed as a bound parameter, never string-formatted
    #    into the query, even though it comes from our own trusted env var.
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = 'chatbot_ro'")
    if cur.fetchone():
        cur.execute("ALTER ROLE chatbot_ro WITH PASSWORD %s", (CHATBOT_DB_PASSWORD,))
        print("chatbot_ro role already existed; password refreshed.")
    else:
        cur.execute("CREATE ROLE chatbot_ro WITH LOGIN PASSWORD %s", (CHATBOT_DB_PASSWORD,))
        print("chatbot_ro role created.")

    # Role/db names below are fixed internal constants (never user input),
    # so plain string formatting here is fine — nothing external reaches it.
    cur.execute("ALTER ROLE chatbot_ro SET statement_timeout = '3s'")
    cur.execute(f'GRANT CONNECT ON DATABASE "{dbname}" TO chatbot_ro')
    cur.execute("GRANT USAGE ON SCHEMA public TO chatbot_ro")

    # 2. Create/refresh the helper function + curated views + view grants.
    sql_script = SQL_FILE.read_text()
    cur.execute(sql_script)

    print("Chatbot read-only views and grants are up to date.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()