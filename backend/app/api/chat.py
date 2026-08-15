import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agent.loop import run_turn, run_turn_stream
from app.agent.registry import ToolContext
from app.auth.deps import current_user
from app.ledger import scheduled
from app.ledger.display import Currency
from app.memory import working

log = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


class ChatIn(BaseModel):
    message: str
    session_id: UUID | None = None
    # Where the user is standing, so "this page" means something.
    route: str | None = None
    # What unit they are reading: {"code": "USD", "per_rupee": "0.0115"}.
    # The ledger is always rupees; this only decides what is said and how an
    # amount the user states is read.
    currency: dict | None = None


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
    scheduled.catch_up(x_user)
    history = await working.load_history(session_id)
    ctx = ToolContext(
        user_handle=x_user,
        session_id=str(session_id),
        route=body.route or "",
        currency=Currency.parse(body.currency),
    )

    async def sse():
        # A 200 and the headers are already flushed by the time anything can go
        # wrong here, so an exception used to simply truncate the body: the
        # client's read loop ended cleanly, `done` never arrived, and no reply
        # and no error were shown. Every other failure in a turn — a tool
        # raising, the model erroring, a serialization retry — became invisible
        # that way. An error frame is the only channel left to say so.
        try:
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
        except Exception as exc:  # noqa: BLE001 — the stream is the only channel
            log.exception("chat stream failed mid-turn")
            # The exception class, never its message: those carry queries,
            # rows and occasionally keys.
            detail = (
                f"Something went wrong ({type(exc).__name__}). Nothing was "
                "half-recorded — the ledger only commits whole transactions."
            )
            yield f"data: {json.dumps({'type': 'error', 'detail': detail})}\n\n"

    return StreamingResponse(
        sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("")
async def chat(body: ChatIn, x_user: str = Depends(current_user)) -> dict:
    session_id = await working.get_or_create_session(x_user, body.session_id)
    scheduled.catch_up(x_user)
    history = await working.load_history(session_id)

    ctx = ToolContext(
        user_handle=x_user,
        session_id=str(session_id),
        route=body.route or "",
        currency=Currency.parse(body.currency),
    )
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
