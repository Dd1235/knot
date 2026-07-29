"""The agent loop: model call -> tool dispatch -> repeat -> final text."""

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import app.agent.tools  # noqa: F401  (registers tools)
from app.agent.context import assemble
from app.agent.registry import ToolContext, dispatch, specs
from app.llm.provider import get_provider
from app.memory import procedural
from app.tasks import fire_and_forget

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
    context_trace: dict = field(default_factory=dict)


@lru_cache
def _base_prompt() -> str:
    return (PROMPTS_DIR / "system.md").read_text()


def _system_prompt() -> str:
    now = datetime.now(USER_TZ)
    return f"{_base_prompt()}\nToday is {now:%A, %d %B %Y} ({now:%Y-%m-%d}), timezone Asia/Kolkata."


async def run_turn_stream(ctx: ToolContext, history: list[dict], user_message: str):
    """Yields {"type": "delta"|"tool"|"done", ...} events for SSE streaming.

    Text deltas stream optimistically; if the model call turns out to be a
    tool-call round, a "tool" event follows and the client discards the
    partial text. The final "done" event carries the reply, tool events, and
    the memory-injection trace.
    """
    provider = get_provider()
    start = time.perf_counter()
    assembled = await assemble(ctx.user_handle, user_message)
    assembly_ms = int((time.perf_counter() - start) * 1000)
    system = _system_prompt() + (f"\n\n{assembled.suffix}" if assembled.suffix else "")
    if assembled.rule_ids:
        fire_and_forget(procedural.record_usage(assembled.rule_ids), "rule-usage")

    messages = [*history, {"role": "user", "content": user_message}]
    events: list[ToolEvent] = []

    for iteration in range(MAX_ITERATIONS):
        llm_start = time.perf_counter()
        response = None
        async for stream_event in provider.chat_stream(system, messages, specs()):
            if stream_event["type"] == "text_delta":
                yield {"type": "delta", "text": stream_event["text"]}
            elif stream_event["type"] == "response":
                response = stream_event["response"]
        log.info(
            "llm call",
            extra={
                "session_id": ctx.session_id,
                "iteration": iteration,
                "assembly_ms": assembly_ms if iteration == 0 else None,
                "llm_ms": int((time.perf_counter() - llm_start) * 1000),
            },
        )
        if response is None:
            break
        if not response.tool_calls:
            yield {
                "type": "done",
                "reply": response.text or "",
                "events": events,
                "context_trace": assembled.trace,
            }
            return

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
            yield {"type": "tool", "tool": call.name}
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
    yield {
        "type": "done",
        "reply": "I got stuck in a loop handling that — mind rephrasing?",
        "events": events,
        "context_trace": assembled.trace,
    }


async def run_turn(ctx: ToolContext, history: list[dict], user_message: str) -> TurnResult:
    """Non-streaming wrapper around run_turn_stream (used by tests and voice)."""
    result = TurnResult("")
    async for event in run_turn_stream(ctx, history, user_message):
        if event["type"] == "done":
            result = TurnResult(event["reply"], event["events"], event["context_trace"])
    return result
