"""Provenance: why does this transaction exist?

The chain — said → recalled → ran → posted — is assembled from data the system
already wrote. These tests pin the two things that make it trustworthy: the
link is a real column rather than a string parsed out of a truncated result,
and a missing link reads as missing rather than as a crash.
"""

import uuid
from decimal import Decimal

import pytest

from app.agent.registry import ToolContext, dispatch
from app.llm.provider import ToolCall
from app.agent.tools import ledger_tools  # noqa: F401 — registers the tools
from app.db.pool import pool
from app.ledger import service
from app.ledger.service import LegSpec
from app.memory import inspector, working


@pytest.fixture
def user() -> str:
    return f"prov-{uuid.uuid4().hex[:12]}"


async def _session(user_handle: str) -> str:
    return str(await working.get_or_create_session(user_handle, None))


async def _record(user_handle: str, said: str, args: dict) -> tuple[str, str]:
    """Run record_transaction the way a real turn does, and settle the log."""
    session_id = await _session(user_handle)
    ctx = ToolContext(user_handle=user_handle, session_id=session_id, user_message=said)
    result = await dispatch(ctx, _call("record_transaction", args))
    assert "error" not in result, result
    await _drain()
    return result["transaction_id"], session_id


def _call(name: str, args: dict) -> ToolCall:
    return ToolCall(id=str(uuid.uuid4()), name=name, arguments=args)


async def _drain() -> None:
    """_log_action is fire-and-forget; wait for it rather than sleeping."""
    import asyncio

    from app import tasks

    pending = [t for t in tasks._running if not t.done()]
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


async def test_the_chain_survives_from_sentence_to_legs(user):
    txn_id, _ = await _record(
        user,
        "blue tokai 200",
        {"description": "blue tokai", "amount": 200, "direction": "spent", "category": "food"},
    )

    chain = await inspector.provenance(user, uuid.UUID(txn_id))
    assert chain is not None

    # said — the user's own words, not the tidied description
    assert chain["said"] == "blue tokai 200"
    # ran — a real join on the new column, not a parse of result_summary
    assert chain["ran"] is not None
    assert chain["ran"]["tool"] == "record_transaction"
    assert chain["ran"]["args"]["amount"] == 200
    # posted — and the invariant, on the one screen that claims it
    assert len(chain["posted"]) == 2
    assert sum(Decimal(leg["amount"]) for leg in chain["posted"]) == 0
    assert Decimal(chain["transaction"]["leg_sum"]) == 0


async def test_a_read_tool_records_no_transaction_link(user):
    """Only writes produce a transaction; a read must not claim one."""
    session_id = await _session(user)
    ctx = ToolContext(user_handle=user, session_id=session_id, user_message="who owes me?")
    await dispatch(ctx, _call("get_balances", {}))
    await _drain()

    async with pool().connection() as conn:
        cur = await conn.execute(
            "SELECT transaction_id FROM agent_actions WHERE session_id = %s AND tool = %s",
            (session_id, "get_balances"),
        )
        row = await cur.fetchone()
    assert row is not None and row[0] is None


async def test_a_transaction_with_no_tool_call_still_explains_itself(user):
    """Posted straight through the ledger — no agent, no session, no trace.

    The parts that exist must still come back; the parts that don't must read
    as absent. An endpoint that 500s on a REST-posted row would be worse than
    no endpoint.
    """
    posted = await service.post_transaction(
        user,
        "imported row",
        [LegSpec("expense:food", Decimal("50")), LegSpec("cash", Decimal("-50"))],
        category="food",
    )

    chain = await inspector.provenance(user, posted.id)
    assert chain is not None
    assert chain["ran"] is None
    assert chain["recalled"] == {}
    assert chain["said"] == ""
    assert len(chain["posted"]) == 2


async def test_another_users_transaction_is_not_visible(user):
    """The provenance view must not become a way to read someone else's books."""
    posted = await service.post_transaction(
        user,
        "mine",
        [LegSpec("expense:food", Decimal("10")), LegSpec("cash", Decimal("-10"))],
        category="food",
    )
    stranger = f"prov-other-{uuid.uuid4().hex[:8]}"
    assert await inspector.provenance(stranger, posted.id) is None


async def test_a_spoken_amount_carries_its_transcript(user):
    """The voice path used to drop the transcript, so a spoken entry was the
    only kind that could not show what was said."""
    txn_id, _ = await _record(
        user,
        "I spent two hundred rupees at blue tokai",
        {"description": "blue tokai", "amount": 200, "direction": "spent", "category": "food"},
    )
    chain = await inspector.provenance(user, uuid.UUID(txn_id))
    assert chain["said"] == "I spent two hundred rupees at blue tokai"


def test_recall_is_not_gated_on_speaking_english():
    """Episodic search used to run only when an English hint matched.

    Live voice is multilingual and the README says so, but the gate read
    English substrings — so for a question asked in Hindi, Tamil or Telugu the
    episodic lookup silently never ran. The gate's real job is keeping a vector
    search off every "chai 15", and that job does not need English.
    """
    from app.agent.context import _wants_episodes

    # Questions, in the languages the product claims to support.
    assert _wants_episodes("did I spend a lot on food?")
    assert _wants_episodes("मैंने खाने पर कितना खर्च किया")
    assert _wants_episodes("நான் உணவுக்கு எவ்வளவு செலவழித்தேன்")
    assert _wants_episodes("నేను ఆహారం మీద ఎంత ఖర్చు చేశాను")

    # And the thing the gate exists to protect: logging a spend stays cheap.
    assert not _wants_episodes("chai 15")
    assert not _wants_episodes("blue tokai 200")
    assert not _wants_episodes("चाय 15")


@pytest.mark.asyncio
async def test_the_voice_endpoint_carries_the_transcript_into_the_ledger(user):
    """The bug this closes: /voice/tool built its ToolContext without
    user_message, so every spoken transaction stored an empty raw_input — the
    one input mode that could prove it was spoken was the only one leaving no
    receipt. Exercised through the route, because the route is where it broke.
    """
    import httpx

    from app.main import app

    session_id = await _session(user)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/voice/tool",
            headers={"X-User": user},
            json={
                "session_id": session_id,
                "call_id": "call_1",
                "name": "record_transaction",
                "arguments": '{"description":"blue tokai","amount":200,'
                '"direction":"spent","category":"food"}',
                "user_message": "spent two hundred at blue tokai",
            },
        )
    assert resp.status_code == 200, resp.text
    txn_id = resp.json()["result"]["transaction_id"]

    chain = await inspector.provenance(user, uuid.UUID(txn_id))
    assert chain["said"] == "spent two hundred at blue tokai"


@pytest.mark.asyncio
async def test_a_voice_call_without_a_transcript_still_records(user):
    """Older clients omit the field entirely; the turn must not 422."""
    import httpx

    from app.main import app

    session_id = await _session(user)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/voice/tool",
            headers={"X-User": user},
            json={
                "session_id": session_id,
                "call_id": "call_2",
                "name": "record_transaction",
                "arguments": '{"description":"chai","amount":15,'
                '"direction":"spent","category":"food"}',
            },
        )
    assert resp.status_code == 200, resp.text
    assert "error" not in resp.json()["result"]
