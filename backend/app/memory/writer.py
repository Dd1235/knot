"""The memory writer: a background pass that distills durable facts from
transactions. Runs after the ledger commit, never on the critical path."""

import json
import logging

from app.llm.provider import get_provider
from app.memory import semantic

log = logging.getLogger(__name__)

VALID_KINDS = {"person", "merchant", "habit", "preference", "commitment"}

SYSTEM = """You distill durable facts about a user's financial life.
Given one money event, return STRICT JSON only (no prose, no code fences):
{"facts": [{"kind": "person|merchant|habit|preference|commitment",
            "subject": "<short name>", "fact": "<one sentence>"}]}

Only facts worth remembering for months belong here: people and the user's
financial relationship with them, recurring merchants, habits, commitments.
A one-off purchase is NOT a fact. An empty list is a good answer."""


async def process_event(user_handle: str, event_text: str) -> None:
    response = await get_provider().chat(
        SYSTEM, [{"role": "user", "content": event_text}], tools=[]
    )
    raw = (response.text or "").strip()
    raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```")
    try:
        facts = json.loads(raw).get("facts", [])
    except (json.JSONDecodeError, AttributeError):
        log.warning("memory writer returned unparseable output: %.120s", raw)
        return
    for fact in facts:
        if fact.get("kind") in VALID_KINDS and fact.get("fact"):
            await semantic.remember(
                user_handle, fact["kind"], fact.get("subject", ""), fact["fact"]
            )
