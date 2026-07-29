"""Auth: signup, login, token identity, and the anti-forgery rule that the
acting user comes from the token — not the X-User header — when auth is on."""

import uuid

import httpx
import pytest

from app.auth import service
from app.auth.deps import SESSION_COOKIE
from app.auth.service import AuthError
from app.config import get_settings
from app.db.pool import close_pool, open_pool


@pytest.fixture(scope="session", autouse=True)
async def _pool():
    await open_pool()
    yield
    await close_pool()


@pytest.fixture
def creds() -> tuple[str, str]:
    return f"test-{uuid.uuid4().hex[:12]}@example.com", "correct horse battery"


async def test_signup_then_login_returns_same_handle(creds):
    email, password = creds
    created = await service.signup(email, password)
    assert created["handle"]
    assert service.read_token(created["token"]) == created["handle"]

    logged_in = await service.login(email, password)
    assert logged_in["handle"] == created["handle"]


async def test_wrong_password_and_unknown_email_are_indistinguishable(creds):
    email, password = creds
    await service.signup(email, password)

    with pytest.raises(AuthError) as wrong:
        await service.login(email, "not the password")
    with pytest.raises(AuthError) as unknown:
        await service.login(f"nobody-{uuid.uuid4().hex[:8]}@example.com", password)
    assert str(wrong.value) == str(unknown.value)


async def test_duplicate_email_rejected(creds):
    email, password = creds
    await service.signup(email, password)
    with pytest.raises(AuthError, match="already exists"):
        await service.signup(email, password)


async def test_weak_password_and_bad_email_rejected(creds):
    email, _ = creds
    with pytest.raises(AuthError, match="8 characters"):
        await service.signup(email, "short")
    with pytest.raises(AuthError, match="email address"):
        await service.signup("not-an-email", "long enough password")


async def test_tampered_token_is_rejected(creds):
    email, password = creds
    account = await service.signup(email, password)
    assert service.read_token(account["token"] + "x") is None
    assert service.read_token("garbage") is None


async def test_auth_required_ignores_x_user_header(creds, monkeypatch):
    """The security property: with auth on, X-User cannot impersonate anyone."""
    from app.main import app

    email, password = creds
    account = await service.signup(email, password)
    victim = f"victim-{uuid.uuid4().hex[:8]}"

    settings = get_settings()
    monkeypatch.setattr(settings, "auth_required", True)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Forged header alone: rejected.
        forged = await client.get("/auth/me", headers={"X-User": victim})
        assert forged.status_code == 401

        # Valid session + forged header: the token wins.
        client.cookies.set(SESSION_COOKIE, account["token"])
        authed = await client.get("/auth/me", headers={"X-User": victim})
        assert authed.status_code == 200
        assert authed.json()["handle"] == account["handle"]
