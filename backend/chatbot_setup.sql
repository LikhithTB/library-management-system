-- ─────────────────────────────────────────────────────────────────────────
-- Chatbot read-only access layer — views + helper function only.
--
-- Role creation, password assignment, and GRANT CONNECT are handled in
-- setup_chatbot_db.py (they need the password from an environment
-- variable, which plain SQL can't read). This file only defines the
-- curated views the chatbot_ro role is allowed to SELECT from.
--
-- Views intentionally EXCLUDE sensitive columns (passwords, emails, raw
-- internal foreign keys) and join through to human-readable values
-- (roll numbers, book titles) so the model never needs to guess at ids.
--
-- Safe to re-run any time; every statement is idempotent.
-- ─────────────────────────────────────────────────────────────────────────

-- Derives a human-readable department name from a roll number, using the
-- same course-prefix map the app itself uses (backend/config.py COURSE_MAP).
CREATE OR REPLACE FUNCTION chatbot_department(roll_number TEXT)
RETURNS TEXT AS $$
    SELECT CASE
        WHEN roll_number ILIKE '%CS%' THEN 'Computer Science'
        WHEN roll_number ILIKE '%AI%' THEN 'AI/ML'
        WHEN roll_number ILIKE '%EC%' THEN 'ECE'
        WHEN roll_number ILIKE '%EE%' THEN 'EEE'
        WHEN roll_number ILIKE '%ME%' THEN 'Mechanical Engineering'
        WHEN roll_number ILIKE '%CV%' THEN 'Civil Engineering'
        WHEN roll_number ILIKE '%BT%' THEN 'Biotechnology'
        ELSE NULL
    END;
$$ LANGUAGE sql IMMUTABLE;

-- Books catalog (no internal added_by id, no cover_image blob)
CREATE OR REPLACE VIEW v_books AS
SELECT
    id AS book_id, book_code, isbn, title, author, subject, courses, edition,
    media_type, book_type, mrp, replacement_cost,
    total_copies, available_copies, is_active, created_at
FROM books;

-- Physical copies + circulation state
CREATE OR REPLACE VIEW v_book_copies AS
SELECT
    bc.id AS copy_id, bc.copy_code, b.title AS book_title, b.author AS book_author,
    bc.status, bc.condition_note,
    bc.reserved_by_roll, bc.reserved_at, bc.reservation_expires_at,
    bc.issued_to_roll, bc.issued_to_name, bc.issued_at, bc.due_date, bc.returned_at,
    bc.renewal_count, bc.added_at
FROM book_copies bc
JOIN books b ON b.id = bc.book_id;

-- Fines (already keyed by roll_number, nothing sensitive to strip)
CREATE OR REPLACE VIEW v_fines AS
SELECT
    id AS fine_id, roll_number, total_fine, amount_paid, remaining,
    copy_code, book_title, is_cleared, created_at, updated_at
FROM fine_records;

-- Users — deliberately EXCLUDES email and hashed_password
CREATE OR REPLACE VIEW v_users AS
SELECT
    id AS user_id, roll_number, role, is_blocked, is_approved, approval_status,
    chatbot_department(roll_number) AS department
FROM users;

-- Book requests (new-title requests from students, copy requests from librarians)
CREATE OR REPLACE VIEW v_book_requests AS
SELECT
    br.id AS request_id, u.roll_number AS requested_by_roll, br.title, br.author,
    br.isbn, br.reason, br.request_type, br.status, br.hod_comment,
    br.created_at, br.reviewed_at
FROM book_requests br
JOIN users u ON u.id = br.requested_by;

-- Override requests (exceptions requiring HOD approval)
CREATE OR REPLACE VIEW v_override_requests AS
SELECT
    o.id AS request_id, u.roll_number AS requested_by_roll, o.reason,
    o.affected_record, o.status, o.hod_comment, o.created_at, o.reviewed_at
FROM override_requests o
JOIN users u ON u.id = o.requested_by;

-- Per-course-prefix borrowing limits
CREATE OR REPLACE VIEW v_course_limits AS
SELECT course_prefix, max_books, updated_at
FROM course_limits;

-- Recent book activity trail (issued/returned/renewed/added/etc.)
CREATE OR REPLACE VIEW v_book_history AS
SELECT
    bh.id AS history_id, b.title AS book_title, u.roll_number AS changed_by_roll,
    bh.change_type, bh.change_detail, bh.changed_at
FROM book_history bh
JOIN books b ON b.id = bh.book_id
JOIN users u ON u.id = bh.changed_by;

-- Currently-live announcements and broadcasts
CREATE OR REPLACE VIEW v_announcements AS
SELECT id AS announcement_id, title, body, is_active, created_at, expires_at
FROM announcements;

CREATE OR REPLACE VIEW v_broadcast_messages AS
SELECT id AS broadcast_id, title, body, target_roles, is_active, created_at, expires_at
FROM broadcast_messages;

-- Grant SELECT only on these views — nothing on the underlying real tables,
-- so chatbot_ro physically cannot query users/books/etc. directly even if
-- a generated query tried to.
GRANT SELECT ON
    v_books, v_book_copies, v_fines, v_users, v_book_requests,
    v_override_requests, v_course_limits, v_book_history,
    v_announcements, v_broadcast_messages
TO chatbot_ro;