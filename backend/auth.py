"""Authentication helpers: password hashing, signed access tokens, the
current-user dependency, and role checks.

Design notes
- Passwords are hashed with scrypt (stdlib, no extra dependency). Rows that
  still hold a legacy plaintext password are accepted once at login and
  re-hashed on the spot; migrate_password_hashes.py converts the rest.
- Access tokens are HMAC-SHA256 signed and expire after TOKEN_TTL_SECONDS.
  The signing key comes from AUTH_SECRET_KEY and the app refuses to start
  without a strong one. Role and identity are always re-read from the
  database on each request, so a demoted or blocked account loses access
  immediately rather than when its token expires.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

import models
from database import get_db
from models import AccountStatus, ApprovalStatus, RoleEnum

TOKEN_TTL_SECONDS = 12 * 60 * 60

_SECRET = os.environ.get("AUTH_SECRET_KEY", "")
if len(_SECRET) < 32:
    raise RuntimeError(
        "AUTH_SECRET_KEY must be set to at least 32 characters. "
        "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )
_SECRET_BYTES = _SECRET.encode()

_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_PREFIX = "scrypt$"

STAFF_ROLES = {"librarian", "hod", "admin"}


# ─────────────────────────────────────────────────────────────────────────────
# Passwords
# ─────────────────────────────────────────────────────────────────────────────

def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=32)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = _scrypt(password, salt, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P)
    return f"{_SCRYPT_PREFIX}{_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def is_hashed(stored: str) -> bool:
    return bool(stored) and stored.startswith(_SCRYPT_PREFIX)


def verify_password(plain: str, stored: str) -> bool:
    if not stored:
        return False
    if not is_hashed(stored):
        # Legacy plaintext row. Compared in constant time; the caller re-hashes it.
        return hmac.compare_digest(plain.encode(), stored.encode())
    try:
        _, n, r, p, salt_hex, digest_hex = stored.split("$")
        digest = _scrypt(plain, bytes.fromhex(salt_hex), int(n), int(r), int(p))
        return hmac.compare_digest(digest, bytes.fromhex(digest_hex))
    except (ValueError, TypeError):
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Signed tokens
# ─────────────────────────────────────────────────────────────────────────────

def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(body: str) -> str:
    return _b64encode(hmac.new(_SECRET_BYTES, body.encode(), hashlib.sha256).digest())


def create_access_token(data: dict) -> str:
    now = int(time.time())
    payload = {**data, "iat": now, "exp": now + TOKEN_TTL_SECONDS}
    body = _b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    return f"{body}.{_sign(body)}"


def decode_token(token: str):
    try:
        body, signature = token.split(".")
    except (AttributeError, ValueError):
        return None
    if not hmac.compare_digest(signature, _sign(body)):
        return None
    try:
        payload = json.loads(_b64decode(body))
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


# ─────────────────────────────────────────────────────────────────────────────
# Login rate limiting (per roll number, in-process)
# ─────────────────────────────────────────────────────────────────────────────

LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW_SECONDS = 15 * 60
_login_failures = defaultdict(deque)
_login_lock = threading.Lock()


def _prune(key: str, now: float):
    attempts = _login_failures[key]
    while attempts and now - attempts[0] > LOGIN_WINDOW_SECONDS:
        attempts.popleft()


def ensure_login_allowed(key: str):
    now = time.time()
    with _login_lock:
        _prune(key, now)
        if len(_login_failures[key]) >= LOGIN_MAX_FAILURES:
            raise HTTPException(
                status_code=429,
                detail="Too many failed login attempts. Try again in a few minutes.",
            )


def record_login_failure(key: str):
    with _login_lock:
        _login_failures[key].append(time.time())


def clear_login_failures(key: str):
    with _login_lock:
        _login_failures.pop(key, None)


# ─────────────────────────────────────────────────────────────────────────────
# Current user and role checks
# ─────────────────────────────────────────────────────────────────────────────

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload or not str(payload.get("sub", "")).isdigit():
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")

    user = db.query(models.User).filter(models.User.id == int(payload["sub"])).first()
    if (
        not user
        or not user.is_approved
        or user.approval_status == ApprovalStatus.rejected
    ):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    if user.role == RoleEnum.student and user.account_status != AccountStatus.active:
        raise HTTPException(status_code=403, detail="This account is no longer active.")
    return user


def require_roles(*roles):
    """Dependency factory: the caller must be logged in and hold one of `roles`."""
    allowed = {r.value if isinstance(r, RoleEnum) else str(r) for r in roles}

    def dependency(current: models.User = Depends(get_current_user)) -> models.User:
        if current.role.value not in allowed:
            raise HTTPException(status_code=403, detail="You do not have permission for this action.")
        return current

    return dependency


def is_staff(user: models.User) -> bool:
    return user.role.value in STAFF_ROLES


def ensure_self_or_staff(current: models.User, owner_id: int):
    """Allow the owner of a record, or any staff account, and nobody else."""
    if current.id != owner_id and not is_staff(current):
        raise HTTPException(status_code=403, detail="You can only view your own records.")


def ensure_roll_self_or_staff(current: models.User, roll_number: str):
    if current.roll_number != roll_number and not is_staff(current):
        raise HTTPException(status_code=403, detail="You can only view your own records.")
