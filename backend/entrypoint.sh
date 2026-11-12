#!/bin/sh
set -e

echo "Waiting for the database to accept connections..."
python <<'PY'
import os
import sys
import time
from urllib.parse import urlparse

import psycopg2

url = os.environ.get("DATABASE_URL", "")
parsed = urlparse(url)

for attempt in range(30):
    try:
        conn = psycopg2.connect(
            dbname=parsed.path.lstrip("/"),
            user=parsed.username,
            password=parsed.password,
            host=parsed.hostname,
            port=parsed.port or 5432,
        )
        conn.close()
        print("Database is ready.")
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001
        print(f"Database not ready yet ({exc}); retrying in 2s...")
        time.sleep(2)

print("Database never became ready after 30 attempts.")
sys.exit(1)
PY

echo "Ensuring tables exist and seeding the default admin account..."
if python create_admin.py; then
    echo "Admin seed step: OK"
else
    echo "=================================================================="
    echo "WARNING: admin seed step FAILED (see error above)."
    echo "The app will still start, but tables/admin account may be missing"
    echo "or out of date. To retry it manually once the app is running:"
    echo ""
    echo "    docker exec -it library-backend python create_admin.py"
    echo "=================================================================="
fi

echo "Upgrading any legacy plaintext passwords to hashes (if needed)..."
if python migrate_password_hashes.py; then
    echo "Password hash migration: OK"
else
    echo "WARNING: password hash migration failed. Legacy passwords stay plaintext until it succeeds."
    echo "Retry with: docker exec -it library-backend python migrate_password_hashes.py"
fi

echo "Applying account_status migration (if needed)..."
if python migrate_account_status.py; then
    echo "Account status migration: OK"
else
    echo "=================================================================="
    echo "WARNING: account_status migration FAILED (see error above)."
    echo "The app will still start, but deactivating student accounts will"
    echo "not work until this is fixed. To retry it manually:"
    echo ""
    echo "    docker exec -it library-backend python migrate_account_status.py"
    echo "=================================================================="
fi

echo "Applying graduation_year / system_alerts migration (if needed)..."
if python migrate_graduation_year.py; then
    echo "Graduation year migration: OK"
else
    echo "=================================================================="
    echo "WARNING: graduation_year migration FAILED (see error above)."
    echo "The app will still start, but the graduation-year prompt and"
    echo "admin system alerts will not work until this is fixed. To retry"
    echo "it manually:"
    echo ""
    echo "    docker exec -it library-backend python migrate_graduation_year.py"
    echo "=================================================================="
fi

echo "Setting up the chatbot's read-only database role and views..."
if python setup_chatbot_db.py; then
    echo "Chatbot database setup: OK"
else
    echo "=================================================================="
    echo "WARNING: chatbot database setup FAILED (see error above)."
    echo "The main library app will still start, but the chatbot feature"
    echo "will NOT work until this is fixed — it will fail with a"
    echo "connection/password error when asked a question."
    echo ""
    echo "To retry it manually once the app is running:"
    echo ""
    echo "    docker exec -it library-backend python setup_chatbot_db.py"
    echo "    docker compose restart backend"
    echo "=================================================================="
fi

echo "Starting the API server..."
exec uvicorn main:app --host 0.0.0.0 --port 8000