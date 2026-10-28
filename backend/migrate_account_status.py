"""
Adds the account_status column (and its Postgres enum type) to the users
table if it isn't already there.

Brand-new databases get this column automatically from models.py via
Base.metadata.create_all() — this script only matters for a database that
already existed before this feature was added (e.g. your restored backup).

Safe to run repeatedly: every statement here is idempotent.
"""
import os
from urllib.parse import urlparse

import psycopg2

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:0567@localhost:5432/library_db"
)


def main():
    parsed = urlparse(DATABASE_URL)
    conn = psycopg2.connect(
        dbname=parsed.path.lstrip("/"),
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port or 5432,
    )
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("""
        DO $$ BEGIN
            CREATE TYPE accountstatus AS ENUM ('active', 'graduated', 'dropped', 'suspended');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    cur.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS account_status accountstatus NOT NULL DEFAULT 'active';
    """)

    print("account_status column is present and up to date.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()