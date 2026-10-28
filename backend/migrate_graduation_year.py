"""
Adds, to an existing database:
  - users.graduation_year (Integer, nullable)
  - the system_alerts table

Brand-new databases get both automatically from models.py via
Base.metadata.create_all() — this script only matters for a database that
already existed before this feature was added.

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
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS graduation_year INTEGER;
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS system_alerts (
            id SERIAL PRIMARY KEY,
            message TEXT NOT NULL,
            is_read BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)

    print("graduation_year column and system_alerts table are up to date.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()