# Vercel + Supabase deployment

This repository deploys as two Vercel projects connected to the same Git
repository. The frontend is the repository root; the FastAPI project uses
`backend` as its root directory. The frontend calls the backend directly using
`REACT_APP_API_URL`, and the backend allows the configured frontend origins.

## Supabase setup

1. Create a Supabase project and open **Connect**.
2. Copy the **Transaction pooler** URI for the Vercel runtime. Replace its
   password placeholder and URL-encode reserved characters in the password.
3. For one-time initialization scripts, use the **Session pooler** URI (or the
   direct URI when your network supports its IP version). These scripts perform
   schema and role setup and should not run as part of serverless requests.
4. Do not commit either URI or any of the secrets below.

## Vercel backend project

Create a Vercel project from the repository and set **Root Directory** to
`backend`. Select the FastAPI preset if it is not detected automatically. The
project entrypoint is `index.py` and Python 3.12 is selected by
`.python-version`.

Set these backend environment variables for Production and Preview:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase transaction-pooler URI |
| `AUTH_SECRET_KEY` | Unique random secret, at least 32 characters |
| `ADMIN_INITIAL_PASSWORD` | Strong initial password for `ADMIN001` |
| `CHATBOT_DB_PASSWORD` | Unique password for the staff read-only role |
| `CHATBOT_STUDENT_DB_PASSWORD` | Unique password for the student read-only role |
| `OPENAI_API_KEY` | Optional; enables chatbot answers |
| `OPENAI_CHATBOT_MODEL` | Optional; defaults to `gpt-4.1-nano` |
| `FRONTEND_ORIGINS` | Comma-separated exact frontend origins, including `https://` |
| `FRONTEND_ORIGIN_REGEX` | Optional regex for frontend preview origins |

For previews, set `FRONTEND_ORIGIN_REGEX` to match only your Vercel frontend
project's preview hostnames. Avoid a catch-all `.*` pattern. The local origins
`http://localhost:3000` and `http://localhost:5173` remain allowed by default.

The backend uses a one-connection SQLAlchemy pool per Vercel instance. Its
chatbot roles use the Supabase shared-pooler username format automatically.

## Initialize a new Supabase database once

The API no longer runs schema DDL when a Vercel function starts. From a local
checkout, create a Python 3.12 virtual environment, install
`backend/requirements.txt`, and run the following from `backend` with the
initialization URI and secrets set in the shell environment:

```powershell
python create_admin.py
python setup_chatbot_db.py
```

`create_admin.py` creates the tables and initial `ADMIN001` account. Keep
`ADMIN_INITIAL_PASSWORD` set in the shell before running it. `setup_chatbot_db.py`
creates the chatbot roles and views; it requires both chatbot passwords. The
script is optional only if you are not deploying chatbot routes/features.

The `migrate_account_status.py` and `migrate_graduation_year.py` scripts are for
older databases that predate those schema changes; a fresh database gets those
columns/tables from the current models. If restoring an older database, apply
the migrations before serving traffic.

## Vercel frontend project

Create a second Vercel project from the same repository and use the repository
root as its **Root Directory**. Vercel should detect Create React App; its build
command is `npm run build` and output directory is `build`. `vercel.json` adds
the SPA fallback for client-side routes.

Set `REACT_APP_API_URL` to the backend's production HTTPS origin, for example
`https://your-backend-project.vercel.app` (no trailing slash). Set it for
Production and Preview. This is a public URL, not a secret. Add the exact
frontend production URL to the backend's `FRONTEND_ORIGINS`; set the preview
regex as described above if you need browser testing on previews.

## Deploy and verify

Deploy the backend first, then initialize Supabase, then deploy the frontend.
Check `https://<backend-domain>/api/chatbot/health` and test registration,
login, and a database-backed screen from the frontend deployment. Check the
Vercel backend function logs if a request fails. The chatbot's diagnostic route
is admin-protected at `/api/chatbot/health/details`.
