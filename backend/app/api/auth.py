from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.auth import service
from app.auth.deps import SESSION_COOKIE, current_user
from app.auth.service import SESSION_DAYS, AuthError
from app.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    email: str
    password: str


def _set_session(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="none" if get_settings().cookie_secure else "lax",
        secure=get_settings().cookie_secure,
        path="/",
    )


@router.post("/signup", status_code=201)
async def signup(body: Credentials, response: Response) -> dict:
    try:
        account = await service.signup(body.email, body.password)
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _set_session(response, account["token"])
    return {"email": account["email"], "token": account["token"]}


@router.post("/login")
async def login(body: Credentials, response: Response) -> dict:
    try:
        account = await service.login(body.email, body.password)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    _set_session(response, account["token"])
    return {"email": account["email"], "token": account["token"]}


@router.post("/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(handle: str = Depends(current_user)) -> dict:
    return {"handle": handle}
