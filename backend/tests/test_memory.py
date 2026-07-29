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
