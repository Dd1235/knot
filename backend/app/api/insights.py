from fastapi import APIRouter, Depends, Query

from app.auth.deps import current_user
from app.insights import service

router = APIRouter(prefix="/insights", tags=["insights"])


@router.post("/generate")
async def generate(
    days: int = Query(default=30, ge=7, le=365),
    refresh: bool = False,
    x_user: str = Depends(current_user),
) -> dict:
    return await service.generate(x_user, days, refresh)
