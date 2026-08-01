"""Semantic memory: durable facts, consolidated by meaning.

Write path is upsert-by-similarity: a new fact is vector-compared against the
user's existing facts of the same kind *inside the same serializable
transaction* that writes it. Near-duplicates reinforce the existing row
(evidence_count, confidence) instead of piling up copies.

Read path scores facts by similarity x confidence x recency decay.
"""

import math
from datetime import UTC, datetime

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Json

from app.db.pool import pool
from app.db.tx import run_serializable
from app.ledger.service import ensure_user
from app.llm.embeddings import embed_one, to_pgvector

# L2 distance on normalized vectors: 0.5 ~= cosine similarity 0.875.
DEDUP_DISTANCE = 0.5
# Confidence halves roughly every 90 days without reinforcement.
DECAY_DAYS = 90 / math.log(2)


async def remember(
    user_handle: str,
    kind: str,
    subject: str,
    fact: str,
    structured: dict | None = None,
) -> dict:
    vector = to_pgvector(await embed_one(f"{subject}: {fact}" if subject else fact))

    async def _fn(conn: AsyncConnection) -> dict:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            SELECT id, fact, embedding <-> %s::VECTOR AS distance
            FROM semantic_facts
            WHERE user_id = %s AND kind = %s AND superseded_by IS NULL
            ORDER BY embedding <-> %s::VECTOR
            LIMIT 1
            """,
            (vector, user_id, kind, vector),
        )
        nearest = await cur.fetchone()
        if nearest and nearest[2] < DEDUP_DISTANCE:
            await conn.execute(
                """
                UPDATE semantic_facts
                SET evidence_count = evidence_count + 1,
                    confidence = LEAST(0.99, confidence + 0.1),
                    last_reinforced_at = now()
                WHERE id = %s
                """,
                (nearest[0],),
            )
            return {"reinforced": True, "fact_id": str(nearest[0]), "existing_fact": nearest[1]}

        cur = await conn.execute(
            """
            INSERT INTO semantic_facts (user_id, kind, subject, fact, structured, embedding)
            VALUES (%s, %s, %s, %s, %s, %s::VECTOR)
            RETURNING id
            """,
            (user_id, kind, subject, fact, Json(structured or {}), vector),
        )
        return {"created": True, "fact_id": str((await cur.fetchone())[0])}

    return await run_serializable(_fn)


def _decayed_score(similarity: float, confidence: float, last_reinforced_at) -> float:
    age_days = (datetime.now(UTC) - last_reinforced_at).total_seconds() / 86400
    return similarity * confidence * math.exp(-age_days / DECAY_DAYS)


async def search(
    user_handle: str,
    query_vector: list[float],
    k: int = 5,
    kinds: list[str] | None = None,
) -> list[dict]:
    vector = to_pgvector(query_vector)
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT f.id::STRING, f.kind, f.subject, f.fact, f.confidence,
                   f.evidence_count, f.last_reinforced_at,
                   1 - (f.embedding <-> %s::VECTOR) ^ 2 / 2 AS similarity
            FROM semantic_facts AS f
            JOIN users AS u ON u.id = f.user_id
            WHERE u.handle = %s AND f.superseded_by IS NULL
              AND (%s::STRING[] IS NULL OR f.kind = ANY(%s))
            ORDER BY f.embedding <-> %s::VECTOR
            LIMIT %s
            """,
            (vector, user_handle, kinds, kinds, vector, k * 3),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()

    for row in rows:
        row["score"] = round(
            _decayed_score(row["similarity"], row["confidence"], row["last_reinforced_at"]), 4
        )
        row["similarity"] = round(row["similarity"], 4)
        row["last_reinforced_at"] = row["last_reinforced_at"].isoformat()
    rows.sort(key=lambda r: r["score"], reverse=True)
    return rows[:k]


async def top_facts(user_handle: str, limit: int = 8) -> list[str]:
    """Best-supported current facts, for contexts with no query to match on."""
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT f.fact
            FROM semantic_facts AS f
            JOIN users AS u ON u.id = f.user_id
            WHERE u.handle = %s AND f.superseded_by IS NULL
            ORDER BY f.confidence * f.evidence_count::FLOAT DESC, f.last_reinforced_at DESC
            LIMIT %s
            """,
            (user_handle, limit),
        )
        return [row[0] for row in await cur.fetchall()]


# A correction is a *different* belief about the same subject, so it will
# usually land beyond DEDUP_DISTANCE and be inserted alongside the wrong one.
# Matching a correction needs a looser net than deduplicating an identical
# restatement does.
CORRECTION_DISTANCE = 1.05


async def correct(
    user_handle: str, wrong: str, right: str, kind: str = "", subject: str = ""
) -> dict:
    """Replace a belief, keeping the one it replaced.

    `superseded_by` has been on this table since the first migration, is
    filtered out of every read, and was never once written — so a fact the
    agent got wrong was permanent, and stating the truth just added a second
    contradictory row beside it. Worse, if the correction happened to land
    within DEDUP_DISTANCE it *reinforced* the wrong fact.

    Superseding rather than deleting is what lets the inspector show how a
    belief changed, which is the whole reason the column exists.
    """
    target_vector = to_pgvector(await embed_one(wrong))
    new_vector = to_pgvector(await embed_one(f"{subject}: {right}" if subject else right))

    async def _fn(conn: AsyncConnection) -> dict:
        user_id = await ensure_user(conn, user_handle)
        params: list = [target_vector, user_id]
        kind_clause = ""
        if kind:
            kind_clause = "AND kind = %s"
            params.append(kind)
        params.append(target_vector)
        cur = await conn.execute(
            f"""
            SELECT id, kind, subject, fact, embedding <-> %s::VECTOR AS distance
            FROM semantic_facts
            WHERE user_id = %s AND superseded_by IS NULL {kind_clause}
            ORDER BY embedding <-> %s::VECTOR
            LIMIT 1
            """,
            tuple(params),
        )
        old = await cur.fetchone()
        if old is None or old[4] > CORRECTION_DISTANCE:
            return {"found": False}

        cur = await conn.execute(
            """
            INSERT INTO semantic_facts
                (user_id, kind, subject, fact, embedding, confidence, evidence_count)
            VALUES (%s, %s, %s, %s, %s::VECTOR, 0.9, 1)
            RETURNING id
            """,
            # Confidence starts high: the user said it directly, which is
            # stronger evidence than anything distilled from conversation.
            (user_id, kind or old[1], subject or old[2], right, new_vector),
        )
        new_id = (await cur.fetchone())[0]
        await conn.execute(
            "UPDATE semantic_facts SET superseded_by = %s WHERE id = %s", (new_id, old[0])
        )
        return {
            "found": True,
            "replaced": old[3],
            "with": right,
            "fact_id": str(new_id),
        }

    return await run_serializable(_fn)


async def forget(user_handle: str, description: str, kind: str = "") -> dict:
    """Retire a fact without replacing it.

    Marked superseded by itself: the row stops being read while the history
    stays intact, and nothing in this system deletes what it once believed.
    """
    vector = to_pgvector(await embed_one(description))

    async def _fn(conn: AsyncConnection) -> dict:
        user_id = await ensure_user(conn, user_handle)
        params: list = [vector, user_id]
        kind_clause = ""
        if kind:
            kind_clause = "AND kind = %s"
            params.append(kind)
        params.append(vector)
        cur = await conn.execute(
            f"""
            SELECT id, fact, embedding <-> %s::VECTOR AS distance
            FROM semantic_facts
            WHERE user_id = %s AND superseded_by IS NULL {kind_clause}
            ORDER BY embedding <-> %s::VECTOR
            LIMIT 1
            """,
            tuple(params),
        )
        row = await cur.fetchone()
        if row is None or row[2] > CORRECTION_DISTANCE:
            return {"found": False}
        await conn.execute(
            "UPDATE semantic_facts SET superseded_by = id WHERE id = %s", (row[0],)
        )
        return {"found": True, "forgot": row[1]}

    return await run_serializable(_fn)
