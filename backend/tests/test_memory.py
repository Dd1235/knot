"""Memory store tests. Hit the live cluster and the embeddings API
(a few hundred tokens per run)."""

import uuid

import pytest

from app.llm.embeddings import embed_one
from app.memory import episodic, procedural, semantic


@pytest.fixture
def user() -> str:
    return f"memtest-{uuid.uuid4().hex[:12]}"


async def test_semantic_near_duplicate_reinforces_instead_of_duplicating(user):
    first = await semantic.remember(
        user, "habit", "weekend food", "User usually orders food on weekends"
    )
    assert first.get("created")

    second = await semantic.remember(
        user, "habit", "weekend food", "The user tends to order food every weekend"
    )
    assert second.get("reinforced"), f"expected reinforcement, got {second}"
    assert second["fact_id"] == first["fact_id"]

    results = await semantic.search(user, await embed_one("weekend eating habits"), k=5)
    assert len(results) == 1
    assert results[0]["evidence_count"] == 2
    assert results[0]["confidence"] > 0.7


async def test_semantic_distinct_facts_stay_separate_and_rank_by_relevance(user):
    await semantic.remember(
        user, "person", "Priya", "Priya is a college friend user often lends lunch money to"
    )
    await semantic.remember(
        user, "commitment", "rent", "Rent of ₹12,000 is due on the 1st of every month"
    )

    results = await semantic.search(user, await embed_one("who is priya?"), k=2)
    assert len(results) == 2
    assert "Priya" in results[0]["fact"]


async def test_procedural_rule_matches_paraphrase_not_unrelated(user):
    await procedural.learn(
        user, "split", "paid rent", "Rent is always split three ways with Arun and Priya"
    )

    hit = await procedural.match(user, await embed_one("just paid the rent 12000"))
    assert len(hit) == 1
    assert "three ways" in hit[0]["rule"]["instruction"]

    miss = await procedural.match(user, await embed_one("bought chai for 15 rupees"))
    assert miss == []


async def test_episodic_roundtrip(user):
    await episodic.record_event(user, "txn", "Lent Priya ₹500 for lunch at the office canteen")
    results = await episodic.search(user, await embed_one("money lent to priya"), k=3)
    assert len(results) == 1
    assert "Priya" in results[0]["summary"]


async def test_a_wrong_fact_can_be_corrected_and_keeps_its_history(user):
    """superseded_by has existed since the first migration, is filtered out of
    every read, and was never written — so a wrong fact was permanent."""
    await semantic.remember(user, "person", "Priya", "Priya is my sister")
    result = await semantic.correct(
        user, "Priya is my sister", "Priya is my flatmate", kind="person", subject="Priya"
    )
    assert result["found"] is True
    assert result["replaced"] == "Priya is my sister"

    live = await semantic.search(user, await embed_one("who is Priya"), k=5)
    facts = [f["fact"] for f in live]
    assert "Priya is my flatmate" in facts
    assert "Priya is my sister" not in facts, "the wrong belief is still being read"


async def test_the_superseded_row_survives_for_the_inspector(user):
    from app.memory import inspector

    await semantic.remember(user, "person", "Arun", "Arun works at Infosys")
    await semantic.correct(user, "Arun works at Infosys", "Arun works at Zoho", kind="person")
    rows = await inspector.semantic_facts(user, limit=50)
    superseded = [r for r in rows if r["fact"] == "Arun works at Infosys"]
    assert superseded, "history was deleted rather than superseded"
    assert superseded[0]["superseded_by"] is not None


async def test_forgetting_retires_a_fact_without_deleting_it(user):
    await semantic.remember(user, "preference", "", "I hate paying by card")
    result = await semantic.forget(user, "I hate paying by card")
    assert result["found"] is True
    live = [
        f["fact"] for f in await semantic.search(user, await embed_one("paying by card"), k=5)
    ]
    assert "I hate paying by card" not in live


async def test_correcting_something_never_believed_reports_not_found(user):
    result = await semantic.correct(user, "the moon is made of cheese", "it is not")
    assert result["found"] is False


async def test_a_cancelled_rule_stops_being_applied(user):
    """`active` was filtered on everywhere and never set false, so a rule the
    user cancelled kept being injected on every turn."""
    await procedural.learn(user, "split", "when I pay rent", "split rent three ways")
    assert await procedural.match(user, await embed_one("just paid the rent 12000"))

    result = await procedural.cancel(user, "split rent three ways")
    assert result["found"] is True
    assert await procedural.match(user, await embed_one("just paid the rent 12000")) == []
