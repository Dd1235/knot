"""The agent loop: model call -> tool dispatch -> repeat -> final text."""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import app.agent.tools  # noqa: F401  (registers tools)
from app.agent.registry import ToolContext, dispatch, specs
from app.llm.provider import get_provider

log = logging.getLogger(__name__)

MAX_ITERATIONS = 6
PROMPTS_DIR = Path(__file__).parent / "prompts"
USER_TZ = ZoneInfo("Asia/Kolkata")


@dataclass
class ToolEvent:
    tool: str
    args: dict
    result: dict


@dataclass
class TurnResult:
    reply: str
    events: list[ToolEvent] = field(default_factory=list)


@lru_cache
def _base_prompt() -> str:
    return (PROMPTS_DIR / "system.md").read_text()


def _system_prompt() -> str:
    now = datetime.now(USER_TZ)
    return f"{_base_prompt()}\nToday is {now:%A, %d %B %Y} ({now:%Y-%m-%d}), timezone Asia/Kolkata."


async def run_turn(ctx: ToolContext, history: list[dict], user_message: str) -> TurnResult:
    provider = get_provider()
    messages = [*history, {"role": "user", "content": user_message}]
    events: list[ToolEvent] = []

    for _ in range(MAX_ITERATIONS):
        response = await provider.chat(_system_prompt(), messages, specs())
        if not response.tool_calls:
            return TurnResult(response.text or "", events)

        messages.append(
            {
                "role": "assistant",
                "content": response.text,
                "tool_calls": [
                    {"id": c.id, "name": c.name, "arguments": c.arguments}
                    for c in response.tool_calls
                ],
            }
        )
        for call in response.tool_calls:
            result = await dispatch(ctx, call)
            events.append(ToolEvent(call.name, call.arguments, result))
            messages.append(
                {
                    "role": "tool",
                    "call_id": call.id,
                    "content": json.dumps(result, default=str),
                }
            )

    log.warning("turn hit MAX_ITERATIONS for session %s", ctx.session_id)
    return TurnResult(
        "I got stuck in a loop handling that — mind rephrasing?", events
    )
