"""Tool registry shared by every agent surface (text now, voice later)."""

import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from app.db.pool import pool
from app.ledger.display import Currency
from app.ledger.service import LedgerError
from app.llm.provider import ToolCall
from app.tasks import fire_and_forget

log = logging.getLogger(__name__)


@dataclass
class ToolContext:
    user_handle: str
    session_id: str
    # What the user actually said this turn, stored verbatim on anything the
    # agent records — the receipt for every entry in the books.
    user_message: str = ""
    # Where the user is standing. "this page" has to mean something.
    route: str = ""
    # What unit the user is reading. The ledger is always rupees; this only
    # decides what the agent says and how it reads an amount the user states.
    currency: Currency = field(default_factory=Currency)


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    handler: Callable[[ToolContext, dict], Awaitable[dict]]


_REGISTRY: dict[str, Tool] = {}


def register(name: str, description: str, parameters: dict):
    def decorator(fn: Callable[[ToolContext, dict], Awaitable[dict]]):
        _REGISTRY[name] = Tool(name, description, parameters, fn)
        return fn

    return decorator


def specs() -> list[dict]:
    return [
        {"name": t.name, "description": t.description, "parameters": t.parameters}
        for t in _REGISTRY.values()
    ]


async def _log_action(
    session_id: str, tool: str, args: dict, result: dict, latency_ms: int
) -> None:
    async with pool().connection() as conn:
        await conn.execute(
            """
            INSERT INTO agent_actions (session_id, tool, args, result_summary, error, latency_ms)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                session_id,
                tool,
                json.dumps(args, default=str),
                json.dumps(result, default=str)[:400],
                result.get("error"),
                latency_ms,
            ),
        )


async def dispatch(ctx: ToolContext, call: ToolCall) -> dict:
    tool = _REGISTRY.get(call.name)
    if tool is None:
        return {"error": f"unknown tool: {call.name}"}
    start = time.perf_counter()
    try:
        result = await tool.handler(ctx, call.arguments)
    except LedgerError as exc:
        # Domain errors go back to the model verbatim so it can explain or
        # ask a clarifying question.
        result = {"error": str(exc)}
    except Exception:
        log.exception("tool %s failed", call.name)
        result = {"error": "internal error executing tool"}
    latency_ms = int((time.perf_counter() - start) * 1000)
    fire_and_forget(
        _log_action(ctx.session_id, call.name, call.arguments, result, latency_ms),
        "agent-action-log",
    )
    return result
