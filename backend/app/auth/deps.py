"""Request identity.

With AUTH_REQUIRED on (production), the acting user comes ONLY from a verified
session token — never from a client-supplied header, which anyone could forge
to read someone else's ledger. With it off (local dev), the X-User header still
works so scripts and tests stay simple.
"""

from fastapi import HTTPException, Request

from app.auth.service import read_token
from app.config import get_settings

SESSION_COOKIE = "ledger_session"


def _token_from(request: Request) -> str | None:
    cookie = request.cookies.get(SESSION_COOKIE)
    if cookie:
        return cookie
    header = request.headers.get("authorization", "")
    if header.startswith("Bearer "):
        return header.removeprefix("Bearer ").strip()
    return None


async def current_user(request: Request) -> str:
    token = _token_from(request)
    if token:
        handle = read_token(token)
        if handle:
            return handle
        if get_settings().auth_required:
            raise HTTPException(status_code=401, detail="session expired")
    if get_settings().auth_required:
        raise HTTPException(status_code=401, detail="sign in required")
    return request.headers.get("x-user", "demo")
