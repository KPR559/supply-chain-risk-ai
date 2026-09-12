"""User authentication backed by the DuckDB warehouse.

- Passwords: PBKDF2-HMAC-SHA256 (600k iterations), per-user random salt,
  stdlib-only. Stored as ``pbkdf2_sha256$<iters>$<salt_hex>$<hash_hex>``.
- Sessions: opaque bearer tokens (``secrets.token_urlsafe``), stored as
  SHA-256 digests with a 12 h expiry. No JWT library needed.
- The default admin (``AUTH_USER`` / ``AUTH_PASS``) is seeded on first login
  attempt when missing, so a fresh database always has a way in.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Optional, Tuple

from backend.core.config import get_settings
from backend.core import storage

_ITERATIONS = 600_000
_SESSION_TTL_HOURS = 12


def _utcnow() -> datetime:
    return datetime.utcnow()


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


def _ensure_tables() -> None:
    con = storage.connect()
    try:
        con.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            "username VARCHAR PRIMARY KEY, "
            "password_hash VARCHAR, "
            "created_at TIMESTAMP)"
        )
        con.execute(
            "CREATE TABLE IF NOT EXISTS sessions ("
            "token_hash VARCHAR PRIMARY KEY, "
            "username VARCHAR, "
            "expires_at TIMESTAMP)"
        )
    finally:
        con.close()


def ensure_default_admin() -> str:
    """Create the default admin user if missing. Returns the username."""
    s = get_settings()
    _ensure_tables()
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
    ensure_default_admin()
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


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(username: str,
                   ttl_hours: int = _SESSION_TTL_HOURS) -> Tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = _utcnow() + timedelta(hours=ttl_hours)
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


def verify_token(token: Optional[str]) -> Optional[str]:
    """Return the username for a live session token, else None."""
    if not token:
        return None
    _ensure_tables()
    con = storage.connect()
    try:
        row = con.execute(
            "SELECT username, expires_at FROM sessions WHERE token_hash = ?",
            [_token_hash(token)],
        ).fetchone()
    finally:
        con.close()
    if row is None:
        return None
    username, expires_at = row
    if expires_at is not None and expires_at < _utcnow():
        revoke_token(token)
        return None
    return username


def revoke_token(token: Optional[str]) -> None:
    if not token:
        return
    _ensure_tables()
    con = storage.connect()
    try:
        con.execute(
            "DELETE FROM sessions WHERE token_hash = ?",
            [_token_hash(token)],
        )
    finally:
        con.close()
