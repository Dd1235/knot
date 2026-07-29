"""Working memory: the current conversation, persisted turn by turn.

Read path is a simple recency window for now; the token budgeter and running
summary compaction land with the memory subsystem stage.
"""

import json
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from app.db.pool import pool
from app.db.tx import run_serializable
from app.ledger.service import ensure_user

HISTORY_WINDOW = 20


async def get_or_create_session(user_handle: str, session_id: UUID | None) -> UUID:
    async def _fn(conn: AsyncConnection) -> UUID:
        user_id = await ensure_user(conn, user_handle)
        if session_id is not None:
            cur = await conn.execute(
                "SELECT id FROM sessions WHERE id = %s AND user_id = %s",
                (session_id, user_id),
            )
            if await cur.fetchone():
                await conn.execute(
                    "UPDATE sessions SET last_active_at = now() WHERE id = %s",
                    (session_id,),
                )
                return session_id
        cur = await conn.execute(
            "INSERT INTO sessions (user_id) VALUES (%s) RETURNING id", (user_id,)
        )
        return (await cur.fetchone())[0]

    return await run_serializable(_fn)


async def append_turn(
    session_id: UUID, role: str, content: str, tool_calls: list[dict] | None = None
) -> None:
    async def _fn(conn: AsyncConnection) -> None:
        cur = await conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM conversation_turns WHERE session_id = %s",
            (session_id,),
        )
        seq = (await cur.fetchone())[0]
        await conn.execute(
            """
            INSERT INTO conversation_turns (session_id, seq, role, content, tool_calls)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (session_id, seq, role, content, json.dumps(tool_calls) if tool_calls else None),
        )
        await conn.execute(
            "UPDATE sessions SET last_active_at = now() WHERE id = %s", (session_id,)
        )

    await run_serializable(_fn)


async def load_history(session_id: UUID, window: int = HISTORY_WINDOW) -> list[dict]:
    """Last N turns as provider-neutral messages (text only — tool internals
    are not replayed across requests; their outcomes live in the ledger)."""
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT role, content FROM (
                SELECT role, content, seq FROM conversation_turns
                WHERE session_id = %s ORDER BY seq DESC LIMIT %s
            ) ORDER BY seq ASC
            """,
            (session_id, window),
        )
        cur.row_factory = dict_row
        return [
            {"role": row["role"], "content": row["content"]} for row in await cur.fetchall()
        ]
