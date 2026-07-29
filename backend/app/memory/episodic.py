"""Episodic memory: what happened and when.

Events are written automatically when transactions commit (fire-and-forget,
never blocking the ledger) and searched by meaning + recency.
"""

from datetime import datetime
from uuid import UUID

from psycopg.rows import dict_row

from app.db.pool import pool
from app.db.tx import run_serializable
from app.ledger.service import ensure_user
from app.llm.embeddings import embed_one, to_pgvector


async def record_event(
    user_handle: str,
    kind: str,
    summary: str,
    ref_transaction_id: str | UUID | None = None,
    session_id: str | UUID | None = None,
    occurred_at: datetime | None = None,
) -> str:
    vector = to_pgvector(await embed_one(summary))

    async def _fn(conn) -> str:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            INSERT INTO episodic_events
                (user_id, kind, summary, embedding, ref_transaction_id, session_id, occurred_at)
            VALUES (%s, %s, %s, %s::VECTOR, %s, %s, COALESCE(%s, now()))
            RETURNING id
            """,
            (user_id, kind, summary, vector, ref_transaction_id, session_id, occurred_at),
        )
        return str((await cur.fetchone())[0])

    return await run_serializable(_fn)


async def search(user_handle: str, query_vector: list[float], k: int = 3) -> list[dict]:
    vector = to_pgvector(query_vector)
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT e.id::STRING, e.kind, e.summary, e.occurred_at,
                   1 - (e.embedding <-> %s::VECTOR) ^ 2 / 2 AS similarity
            FROM episodic_events AS e
            JOIN users AS u ON u.id = e.user_id
            WHERE u.handle = %s
            ORDER BY e.embedding <-> %s::VECTOR
            LIMIT %s
            """,
            (vector, user_handle, vector, k),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    for row in rows:
        row["occurred_at"] = row["occurred_at"].isoformat()
        row["similarity"] = round(row["similarity"], 4)
    return rows
