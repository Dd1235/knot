from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.auth.deps import current_user
from app.memory import inspector, working

router = APIRouter(prefix="/memory", tags=["memory"])


@router.get("/overview")
async def overview(x_user: str = Depends(current_user)) -> dict:
    return await inspector.overview(x_user)


@router.get("/semantic")
async def semantic(
    limit: int = Query(default=50, ge=1, le=200), x_user: str = Depends(current_user)
) -> dict:
    return {"facts": await inspector.semantic_facts(x_user, limit)}


@router.get("/episodic")
async def episodic(
    limit: int = Query(default=50, ge=1, le=200), x_user: str = Depends(current_user)
) -> dict:
    return {"events": await inspector.episodic_events(x_user, limit)}


@router.get("/procedural")
async def procedural(
    limit: int = Query(default=50, ge=1, le=200), x_user: str = Depends(current_user)
) -> dict:
    return {"rules": await inspector.procedural_rules(x_user, limit)}


@router.get("/sessions")
async def sessions(
    limit: int = Query(default=30, ge=1, le=100), x_user: str = Depends(current_user)
) -> dict:
    return {"sessions": await working.list_sessions(x_user, limit)}


@router.get("/sessions/{session_id}/trace")
async def trace(session_id: UUID, x_user: str = Depends(current_user)) -> dict:
    return {"turns": await inspector.session_trace(x_user, session_id)}


@router.get("/actions")
async def actions(
    limit: int = Query(default=50, ge=1, le=200), x_user: str = Depends(current_user)
) -> dict:
    return {"actions": await inspector.recent_actions(x_user, limit)}
