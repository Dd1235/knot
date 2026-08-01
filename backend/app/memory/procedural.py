"""Procedural memory: user-taught rules, matched by trigger similarity.

A rule is a standing instruction ("rent is always split three ways with Arun
and Priya") stored with an embedding of its trigger phrase. Each turn, rules
similar to the user's message are injected as standing instructions.
"""

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Json

from app.db.pool import pool
from app.db.tx import run_serializable
from app.ledger.service import ensure_user
from app.llm.embeddings import embed_one, to_pgvector

# Measured on text-embedding-3-small (512d, normalized): related paraphrases
# land at 0.57-0.96 from a message-like trigger, unrelated messages at 1.11+.
# 1.05 catches casual rephrasings ("rent done 12k"); over-injection is cheap
# because the model only applies rules relevant to the current message.
MATCH_DISTANCE = 1.05


async def learn(
    user_handle: str,
    kind: str,
    trigger_text: str,
    instruction: str,
    payload: dict | None = None,
    source: str = "user",
) -> dict:
    # Embed trigger AND instruction together: models write unreliable triggers,
    # but the instruction carries the key nouns (rent, split, names) that real
    # future messages share. Measured: blend lands ~0.98 from casual rent
    # phrasings vs 1.18+ for unrelated messages.
    vector = to_pgvector(await embed_one(f"{trigger_text}. {instruction}"))
    rule = {"instruction": instruction, **(payload or {})}

    async def _fn(conn) -> dict:
        user_id = await ensure_user(conn, user_handle)
        # One rule per near-identical trigger: replace rather than stack.
        cur = await conn.execute(
            """
            SELECT id, trigger_embedding <-> %s::VECTOR AS distance
            FROM procedural_rules
            WHERE user_id = %s AND active AND kind = %s
            ORDER BY trigger_embedding <-> %s::VECTOR
            LIMIT 1
            """,
            (vector, user_id, kind, vector),
        )
        nearest = await cur.fetchone()
        if nearest and nearest[1] < 0.3:
            await conn.execute(
                "UPDATE procedural_rules SET rule = %s, trigger_text = %s WHERE id = %s",
                (Json(rule), trigger_text, nearest[0]),
            )
            return {"updated": True, "rule_id": str(nearest[0])}
        cur = await conn.execute(
            """
            INSERT INTO procedural_rules
                (user_id, kind, trigger_text, trigger_embedding, rule, source)
            VALUES (%s, %s, %s, %s::VECTOR, %s, %s)
            RETURNING id
            """,
            (user_id, kind, trigger_text, vector, Json(rule), source),
        )
        return {"created": True, "rule_id": str((await cur.fetchone())[0])}

    return await run_serializable(_fn)


async def match(user_handle: str, query_vector: list[float], k: int = 3) -> list[dict]:
    vector = to_pgvector(query_vector)
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT r.id::STRING, r.kind, r.trigger_text, r.rule, r.usage_count,
                   r.trigger_embedding <-> %s::VECTOR AS distance
            FROM procedural_rules AS r
            JOIN users AS u ON u.id = r.user_id
            WHERE u.handle = %s AND r.active
            ORDER BY r.trigger_embedding <-> %s::VECTOR
            LIMIT %s
            """,
            (vector, user_handle, vector, k),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    matched = [row for row in rows if row["distance"] < MATCH_DISTANCE]
    for row in matched:
        row["distance"] = round(row["distance"], 4)
    return matched


async def record_usage(rule_ids: list[str]) -> None:
    if not rule_ids:
        return
    async with pool().connection() as conn:
        await conn.execute(
            "UPDATE procedural_rules SET usage_count = usage_count + 1 WHERE id = ANY(%s)",
            (rule_ids,),
        )


async def recent_rules(user_handle: str, limit: int = 8) -> list[str]:
    """Active rule instructions, most-used first — always-relevant context."""
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT r.rule->>'instruction' AS instruction
            FROM procedural_rules AS r
            JOIN users AS u ON u.id = r.user_id
            WHERE u.handle = %s AND r.active
            ORDER BY r.usage_count DESC, r.created_at DESC
            LIMIT %s
            """,
            (user_handle, limit),
        )
        return [row[0] for row in await cur.fetchall() if row[0]]


async def cancel(user_handle: str, description: str) -> dict:
    """Stop applying a rule the user taught.

    `active` has been on this table since the first migration and is filtered
    out of every read, but nothing ever set it false. So "stop splitting rent
    three ways" had nowhere to go: the rule stayed live and kept being injected
    as a standing instruction on every turn. Re-teaching could overwrite a rule
    only if the new phrasing landed within 0.3 — a cancellation with no
    replacement had no path at all.

    Matched at MATCH_DISTANCE, the same loose net used to inject rules: if a
    phrase is close enough to trigger a rule, it is close enough to cancel it.
    """
    vector = to_pgvector(await embed_one(description))

    async def _fn(conn: AsyncConnection) -> dict:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            SELECT id, rule, trigger_embedding <-> %s::VECTOR AS distance
            FROM procedural_rules
            WHERE user_id = %s AND active
            ORDER BY trigger_embedding <-> %s::VECTOR
            LIMIT 1
            """,
            (vector, user_id, vector),
        )
        row = await cur.fetchone()
        if row is None or row[2] > MATCH_DISTANCE:
            return {"found": False}
        await conn.execute(
            "UPDATE procedural_rules SET active = false WHERE id = %s", (row[0],)
        )
        return {"found": True, "cancelled": row[1].get("instruction", "")}

    return await run_serializable(_fn)
