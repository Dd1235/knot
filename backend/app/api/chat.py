import json
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agent.loop import run_turn, run_turn_stream
from app.agent.registry import ToolContext
from app.auth.deps import current_user
from app.ledger import loans, recurring
from app.memory import working
from app.tasks import fire_and_forget

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatIn(BaseModel):
    message: str
    session_id: UUID | None = None


async def _persist_turn(session_id: UUID, message: str, done: dict) -> None:
    await working.append_turn(session_id, "user", message)
    await working.append_turn(
        session_id,
        "assistant",
        done["reply"],
        tool_calls=[
            {"tool": e.tool, "args": e.args, "result": e.result} for e in done["events"]
        ]
        or None,
        context_trace=done["context_trace"] or None,
    )


@router.post("/stream")
async def chat_stream(body: ChatIn, x_user: str = Depends(current_user)):
    session_id = await working.get_or_create_session(x_user, body.session_id)
    fire_and_forget(recurring.post_due(x_user), "recurring-post")
    fire_and_forget(loans.post_due(x_user), "emi-post")
    history = await working.load_history(session_id)
    ctx = ToolContext(user_handle=x_user, session_id=str(session_id))

    async def sse():
        async for event in run_turn_stream(ctx, history, body.message):
            if event["type"] == "done":
                await _persist_turn(session_id, body.message, event)
                payload = {
                    "type": "done",
                    "session_id": str(session_id),
                    "reply": event["reply"],
                    "events": [
                        {"tool": e.tool, "args": e.args, "result": e.result}
                        for e in event["events"]
                    ],
                    "context_trace": event["context_trace"],
                }
                yield f"data: {json.dumps(payload, default=str)}\n\n"
            else:
                yield f"data: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(
        sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("")
async def chat(body: ChatIn, x_user: str = Depends(current_user)) -> dict:
    session_id = await working.get_or_create_session(x_user, body.session_id)
    fire_and_forget(recurring.post_due(x_user), "recurring-post")
    fire_and_forget(loans.post_due(x_user), "emi-post")
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
