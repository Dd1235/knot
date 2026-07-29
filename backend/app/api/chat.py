from uuid import UUID

from fastapi import APIRouter, Header
from pydantic import BaseModel

from app.agent.loop import run_turn
from app.agent.registry import ToolContext
from app.memory import working

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatIn(BaseModel):
    message: str
    session_id: UUID | None = None


@router.post("")
async def chat(body: ChatIn, x_user: str = Header(default="demo")) -> dict:
    session_id = await working.get_or_create_session(x_user, body.session_id)
    history = await working.load_history(session_id)

    ctx = ToolContext(user_handle=x_user, session_id=str(session_id))
    result = await run_turn(ctx, history, body.message)

    await working.append_turn(session_id, "user", body.message)
    await working.append_turn(
        session_id,
        "assistant",
        result.reply,
        tool_calls=[
            {"tool": e.tool, "args": e.args, "result": e.result} for e in result.events
        ]
        or None,
        context_trace=result.context_trace or None,
    )
    return {
        "session_id": str(session_id),
        "reply": result.reply,
        "events": [
            {"tool": e.tool, "args": e.args, "result": e.result} for e in result.events
        ],
        "context_trace": result.context_trace,
    }
