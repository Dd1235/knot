"""Tool registry shared by every agent surface (text now, voice later)."""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.ledger.service import LedgerError
from app.llm.provider import ToolCall

log = logging.getLogger(__name__)


@dataclass
class ToolContext:
    user_handle: str
    session_id: str


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


async def dispatch(ctx: ToolContext, call: ToolCall) -> dict:
    tool = _REGISTRY.get(call.name)
    if tool is None:
        return {"error": f"unknown tool: {call.name}"}
    try:
        return await tool.handler(ctx, call.arguments)
    except LedgerError as exc:
        # Domain errors go back to the model verbatim so it can explain or
        # ask a clarifying question.
        return {"error": str(exc)}
    except Exception:
        log.exception("tool %s failed", call.name)
        return {"error": "internal error executing tool"}
