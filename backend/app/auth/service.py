"""Account signup/login: Argon2id password hashing, JWT session tokens.

The user's ledger scoping key is `users.handle`; authentication only decides
which handle a request may act as. Handles for signed-up accounts are derived
from the account UUID so they are unguessable and stable.
"""

import re
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from psycopg import AsyncConnection

from app.config import get_settings
from app.db.tx import run_serializable

SESSION_DAYS = 30
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_hasher = PasswordHasher()
# Fixed hash used to equalise timing on the unknown-email path.
_DUMMY_HASH = _hasher.hash("timing-equalisation-placeholder")


class AuthError(Exception):
    pass


def _normalize_email(email: str) -> str:
    email = email.strip().lower()
    if not EMAIL_RE.match(email):
        raise AuthError("that doesn't look like an email address")
    return email


def issue_token(handle: str) -> str:
    settings = get_settings()
    payload = {
        "sub": handle,
        "iat": datetime.now(UTC),
        "exp": datetime.now(UTC) + timedelta(days=SESSION_DAYS),
    }
    return jwt.encode(payload, settings.session_secret, algorithm="HS256")


def read_token(token: str) -> str | None:
    """Return the handle a token authorizes, or None if it is invalid."""
    try:
        payload = jwt.decode(
            token, get_settings().session_secret, algorithms=["HS256"]
        )
    except jwt.PyJWTError:
        return None
    handle = payload.get("sub")
    return handle if isinstance(handle, str) else None


async def signup(email: str, password: str) -> dict:
    email = _normalize_email(email)
    if len(password) < 8:
        raise AuthError("password must be at least 8 characters")
    password_hash = _hasher.hash(password)

    async def _fn(conn: AsyncConnection) -> dict:
        cur = await conn.execute("SELECT 1 FROM users WHERE email = %s", (email,))
        if await cur.fetchone():
            raise AuthError("an account with that email already exists")
        cur = await conn.execute(
            """
            INSERT INTO users (handle, email, password_hash, display_name)
            VALUES (gen_random_uuid()::STRING, %s, %s, %s)
            RETURNING handle, email
            """,
            (email, password_hash, email.split("@")[0]),
        )
        handle, stored_email = await cur.fetchone()
        return {"handle": handle, "email": stored_email}

    account = await run_serializable(_fn)
    return {**account, "token": issue_token(account["handle"])}


async def login(email: str, password: str) -> dict:
    email = _normalize_email(email)

    async def _fn(conn: AsyncConnection) -> dict:
        cur = await conn.execute(
            "SELECT handle, password_hash FROM users WHERE email = %s", (email,)
        )
        row = await cur.fetchone()
        if row is None or not row[1]:
            # Verify against a throwaway hash so an unregistered email costs the
            # same time as a wrong password — otherwise login is an oracle.
            try:
                _hasher.verify(_DUMMY_HASH, password)
            except VerifyMismatchError:
                pass
            raise AuthError("email or password is incorrect")
        handle, password_hash = row
        try:
            _hasher.verify(password_hash, password)
        except VerifyMismatchError:
            raise AuthError("email or password is incorrect") from None
        if _hasher.check_needs_rehash(password_hash):
            await conn.execute(
                "UPDATE users SET password_hash = %s WHERE handle = %s",
                (_hasher.hash(password), handle),
            )
        await conn.execute(
            "UPDATE users SET last_login_at = now() WHERE handle = %s", (handle,)
        )
        return {"handle": handle, "email": email}

    account = await run_serializable(_fn)
    return {**account, "token": issue_token(account["handle"])}
