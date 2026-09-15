"""User authentication backed by the DuckDB warehouse.

- Passwords: PBKDF2-HMAC-SHA256 (600k iterations), per-user random salt,
  stdlib-only. Stored as ``pbkdf2_sha256$<iters>$<salt_hex>$<hash_hex>``.
- Sessions: JWT access (15m) + JWT refresh (7d, stored hashed, HttpOnly cookie).
  Old opaque tokens are still accepted as a fallback until they expire.
- The default admin (``AUTH_USER`` / ``AUTH_PASS``) is seeded on first login
  attempt when missing, so a fresh database always has a way in.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import jwt as pyjwt

from backend.core.config import get_settings
from backend.core import storage

_ITERATIONS = 600_000
_SESSION_TTL_HOURS = 12  # legacy opaque sessions
_JWT_ALG = "HS256"


def _utcnow() -> datetime:
    # Naive-UTC to stay consistent with stored DuckDB timestamps.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _jwt_secret() -> str:
    return get_settings().auth_secret


def _jwt_issue(username: str, ttl: timedelta, typ: str) -> str:
    now_ts = int(time.time())
    payload = {
        "sub": username,
        "iat": now_ts,
        "exp": now_ts + int(ttl.total_seconds()),
        "jti": secrets.token_hex(12),
        "type": typ,
    }
    return pyjwt.encode(payload, _jwt_secret(), algorithm=_JWT_ALG)


def _jwt_verify(token: str, expected_type: str) -> Optional[str]:
    try:
        data = pyjwt.decode(token, _jwt_secret(), algorithms=[_JWT_ALG])
    except pyjwt.PyJWTError:
        return None
    if data.get("type") != expected_type:
        return None
    return data.get("sub")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"),
            bytes.fromhex(salt_hex), int(iters),
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def ensure_tables() -> None:
    """Create users/sessions/reset_tokens tables if missing. Called once at app startup;
    write paths below also call it so ad-hoc use never hits a missing table.
    """
    con = storage.connect()
    try:
        con.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            "username VARCHAR PRIMARY KEY, "
            "password_hash VARCHAR, "
            "created_at TIMESTAMP, "
            "avatar VARCHAR)"
        )
        con.execute(
            "CREATE TABLE IF NOT EXISTS sessions ("
            "token_hash VARCHAR PRIMARY KEY, "
            "username VARCHAR, "
            "expires_at TIMESTAMP)"
        )
        con.execute(
            "CREATE TABLE IF NOT EXISTS reset_tokens ("
            "token_hash VARCHAR PRIMARY KEY, "
            "username VARCHAR, "
            "expires_at TIMESTAMP)"
        )
        # migrate older databases that were created without the avatar column
        try:
            con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR")
        except Exception:
            pass
    finally:
        con.close()


def ensure_default_admin() -> str:
    """Create the default admin user if missing. Returns the username."""
    s = get_settings()
    ensure_tables()
    con = storage.connect()
    try:
        row = con.execute(
            "SELECT username FROM users WHERE username = ?",
            [s.auth_user],
        ).fetchone()
        if row is None:
            con.execute(
                "INSERT INTO users (username, password_hash, created_at) "
                "VALUES (?, ?, ?)",
                [s.auth_user, hash_password(s.auth_pass), _utcnow()],
            )
        return s.auth_user
    finally:
        con.close()


def authenticate(username: str, password: str) -> Optional[str]:
    """Return the username when credentials are valid, else None."""
    con = storage.connect()
    try:
        row = con.execute(
            "SELECT password_hash FROM users WHERE username = ?",
            [username],
        ).fetchone()
    finally:
        con.close()
    if row is None:
        return None
    return username if verify_password(password, row[0]) else None


class UsernameTakenError(ValueError):
    """Raised when registering a username that already exists."""


def register_user(username: str, password: str) -> str:
    """Create a new user with a hashed password. Returns the username.

    Raises UsernameTakenError when the name is already registered.
    """
    username = username.strip()
    ensure_tables()
    con = storage.connect()
    try:
        exists = con.execute(
            "SELECT 1 FROM users WHERE username = ?",
            [username],
        ).fetchone()
        if exists is not None:
            raise UsernameTakenError(f"Username already registered: {username}")
        con.execute(
            "INSERT INTO users (username, password_hash, created_at) "
            "VALUES (?, ?, ?)",
            [username, hash_password(password), _utcnow()],
        )
    finally:
        con.close()
    return username


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(username: str,
                   ttl_hours: int = _SESSION_TTL_HOURS) -> Tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = _utcnow() + timedelta(hours=ttl_hours)
    ensure_tables()
    con = storage.connect()
    try:
        con.execute(
            "INSERT INTO sessions (token_hash, username, expires_at) "
            "VALUES (?, ?, ?)",
            [_token_hash(token), username, expires_at],
        )
    finally:
        con.close()
    return token, expires_at


# ---------------------------------------------------------------------------
# JWT issuance
# ---------------------------------------------------------------------------

def issue_token_pair(username: str) -> Dict[str, str]:
    s = get_settings()
    access = _jwt_issue(username, timedelta(minutes=s.auth_access_ttl_min), "access")
    refresh = _jwt_issue(username, timedelta(days=s.auth_refresh_ttl_days), "refresh")
    # persist both for revocation (access short-lived, refresh long-lived)
    ensure_tables()
    now = _utcnow()
    access_exp = now + timedelta(minutes=s.auth_access_ttl_min)
    refresh_exp = now + timedelta(days=s.auth_refresh_ttl_days)
    con = storage.connect()
    try:
        con.execute(
            "INSERT INTO sessions (token_hash, username, expires_at) VALUES (?, ?, ?)",
            [_token_hash(access), username, access_exp],
        )
        con.execute(
            "INSERT INTO sessions (token_hash, username, expires_at) VALUES (?, ?, ?)",
            [_token_hash(refresh), username, refresh_exp],
        )
    finally:
        con.close()
    return {"access_token": access, "refresh_token": refresh, "expires_at": access_exp.isoformat()}


def verify_token(token: Optional[str]) -> Optional[str]:
    """Return the username for a live session token, else None.

    Accepts both JWT access tokens and legacy opaque tokens.
    JWTs are verified cryptographically and then checked for revocation
    (presence in sessions). Legacy path hits DB but never raises.
    """
    if not token:
        return None
    # JWT-like? (header.payload.signature)
    if token.count(".") == 2:
        sub = _jwt_verify(token, "access")
        if sub is not None:
            try:
                con = storage.connect()
                try:
                    row = con.execute(
                        "SELECT 1 FROM sessions WHERE token_hash = ?",
                        [_token_hash(token)],
                    ).fetchone()
                finally:
                    con.close()
            except Exception:
                return None
            return sub if row is not None else None
        # JWT present but invalid/expired — do not fall through to legacy
        return None
    # legacy opaque fallback
    try:
        con = storage.connect()
        try:
            row = con.execute(
                "SELECT username, expires_at FROM sessions WHERE token_hash = ?",
                [_token_hash(token)],
            ).fetchone()
        finally:
            con.close()
    except Exception:
        return None
    if row is None:
        return None
    username, expires_at = row
    if expires_at is not None and expires_at < _utcnow():
        revoke_token(token)
        return None
    return username


def verify_refresh_token(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    sub = _jwt_verify(token, "refresh")
    if sub is None:
        return None
    # must still be present (not revoked)
    try:
        con = storage.connect()
        try:
            row = con.execute(
                "SELECT 1 FROM sessions WHERE token_hash = ?",
                [_token_hash(token)],
            ).fetchone()
        finally:
            con.close()
    except Exception:
        return None
    return sub if row is not None else None


def revoke_token(token: Optional[str]) -> None:
    if not token:
        return
    try:
        con = storage.connect()
        try:
            con.execute(
                "DELETE FROM sessions WHERE token_hash = ?",
                [_token_hash(token)],
            )
        finally:
            con.close()
    except Exception:
        pass


def revoke_refresh_token(token: Optional[str]) -> None:
    revoke_token(token)


# ---------------------------------------------------------------------------
# Password reset / change
# ---------------------------------------------------------------------------

def create_reset_token(username: str) -> Tuple[str, datetime]:
    ensure_tables()
    # must be a known user
    con = storage.connect()
    try:
        exists = con.execute("SELECT 1 FROM users WHERE username = ?", [username]).fetchone()
        if exists is None:
            raise ValueError("Unknown user")
    finally:
        con.close()
    raw = secrets.token_urlsafe(32)
    exp = _utcnow() + timedelta(minutes=get_settings().auth_reset_ttl_min)
    con = storage.connect()
    try:
        con.execute("DELETE FROM reset_tokens WHERE username = ?", [username])
        con.execute("INSERT INTO reset_tokens (token_hash, username, expires_at) VALUES (?, ?, ?)",
                    [_token_hash(raw), username, exp])
    finally:
        con.close()
    return raw, exp


def reset_password_with_token(token: str, new_password: str) -> str:
    th = _token_hash(token)
    con = storage.connect()
    try:
        row = con.execute("SELECT username, expires_at FROM reset_tokens WHERE token_hash = ?", [th]).fetchone()
        if row is None:
            raise ValueError("Invalid or expired reset token")
        username, exp = row
        if exp is not None and exp < _utcnow():
            con.execute("DELETE FROM reset_tokens WHERE token_hash = ?", [th])
            raise ValueError("Reset token expired")
        con.execute("UPDATE users SET password_hash = ? WHERE username = ?",
                    [hash_password(new_password), username])
        con.execute("DELETE FROM reset_tokens WHERE token_hash = ?", [th])
        # revoke all sessions so old tokens die
        con.execute("DELETE FROM sessions WHERE username = ?", [username])
        return username
    finally:
        con.close()


def change_password(username: str, old_password: str, new_password: str) -> None:
    if authenticate(username, old_password) is None:
        raise ValueError("Current password is incorrect")
    con = storage.connect()
    try:
        con.execute("UPDATE users SET password_hash = ? WHERE username = ?",
                    [hash_password(new_password), username])
        con.execute("DELETE FROM sessions WHERE username = ?", [username])
    finally:
        con.close()


def delete_user(username: str) -> bool:
    """Delete a user and all their sessions. Returns True when removed."""
    ensure_tables()
    con = storage.connect()
    try:
        exists = con.execute(
            "SELECT 1 FROM users WHERE username = ?", [username]
        ).fetchone()
        if exists is None:
            return False
        con.execute("DELETE FROM sessions WHERE username = ?", [username])
        con.execute("DELETE FROM reset_tokens WHERE username = ?", [username])
        con.execute("DELETE FROM users WHERE username = ?", [username])
        return True
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Profile (avatar) and username changes
# ---------------------------------------------------------------------------

def get_profile(username: str) -> Optional[Dict]:
    """Return the public profile for a user, or None if the user is unknown."""
    ensure_tables()
    con = storage.connect()
    try:
        row = con.execute(
            "SELECT username, avatar, created_at FROM users WHERE username = ?",
            [username],
        ).fetchone()
    except Exception:
        return None
    finally:
        con.close()
    if row is None:
        return None
    return {
        "username": row[0],
        "avatar": row[1],
        "created_at": row[2].isoformat() if row[2] is not None else None,
    }


def update_profile(username: str, avatar: Optional[str]) -> Dict:
    """Set the avatar (data URL) for a user. Returns the updated profile."""
    ensure_tables()
    con = storage.connect()
    try:
        con.execute("UPDATE users SET avatar = ? WHERE username = ?", [avatar, username])
    finally:
        con.close()
    profile = get_profile(username) or {"username": username, "avatar": avatar, "created_at": None}
    return profile


def change_username(old_username: str, new_username: str) -> str:
    """Rename an account (login handle), moving sessions and reset tokens along.

    Returns the new username. Raises ValueError for invalid targets
    and UsernameTakenError when the name is already registered.
    """
    new_username = new_username.strip()
    if not re.match(r"^[A-Za-z0-9_.-]{3,32}$", new_username):
        raise ValueError("Username must be 3-32 chars: letters, digits, _ . -")
    if old_username.lower() == new_username.lower():
        return old_username

    ensure_tables()
    con = storage.connect()
    try:
        exists = con.execute(
            "SELECT 1 FROM users WHERE username = ?", [old_username]
        ).fetchone()
        if exists is None:
            raise ValueError("Unknown user")
        taken = con.execute(
            "SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)",
            [new_username],
        ).fetchone()
        if taken is not None:
            raise UsernameTakenError(f"Username already registered: {new_username}")
        # rename the account and all its live sessions / pending resets
        con.execute("UPDATE users SET username = ? WHERE username = ?",
                    [new_username, old_username])
        con.execute("UPDATE sessions SET username = ? WHERE username = ?",
                    [new_username, old_username])
        con.execute("UPDATE reset_tokens SET username = ? WHERE username = ?",
                    [new_username, old_username])
        # drop every existing session so old tokens die; a fresh pair is
        # issued right after the rename completes
        con.execute("DELETE FROM sessions WHERE username = ?", [new_username])
    finally:
        con.close()
    return new_username


# ---------------------------------------------------------------------------
# Rate limiting (in-memory, per-IP)
# ---------------------------------------------------------------------------

_rate_buckets: Dict[str, List[float]] = defaultdict(list)
_RATE_LIMIT = 5
_RATE_WINDOW_S = 60.0


def check_rate_limit(key: str) -> bool:
    """Return True when allowed, False when the 5/min budget is exceeded."""
    now = time.monotonic()
    bucket = _rate_buckets[key]
    # drop outside window
    cutoff = now - _RATE_WINDOW_S
    while bucket and bucket[0] < cutoff:
        bucket.pop(0)
    if len(bucket) >= _RATE_LIMIT:
        return False
    bucket.append(now)
    return True


def reset_rate_limits() -> None:
    _rate_buckets.clear()
