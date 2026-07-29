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


async def get_or_create_session(
    user_handle: str, session_id: UUID | None, channel: str = "text"
) -> UUID:
    """Resume a session if it exists, otherwise start one.

    `channel` records how the conversation is happening. A session that is both
    spoken and typed becomes 'mixed' rather than flipping between the two —
    continuing a voice conversation in text is the reason both live in one
    table, so the history page should say so rather than pick a side.
    """

    async def _fn(conn: AsyncConnection) -> UUID:
        user_id = await ensure_user(conn, user_handle)
        if session_id is not None:
            cur = await conn.execute(
                "SELECT id, channel FROM sessions WHERE id = %s AND user_id = %s",
                (session_id, user_id),
            )
            row = await cur.fetchone()
            if row:
                merged = "mixed" if row[1] not in (channel, "mixed") else row[1]
                await conn.execute(
                    "UPDATE sessions SET last_active_at = now(), channel = %s WHERE id = %s",
                    (merged, session_id),
                )
                return session_id
        cur = await conn.execute(
            "INSERT INTO sessions (user_id, channel) VALUES (%s, %s) RETURNING id",
            (user_id, channel),
        )
        return (await cur.fetchone())[0]

    return await run_serializable(_fn)


async def list_sessions(user_handle: str, limit: int = 30) -> list[dict]:
    """Conversations, newest first, with enough to render a list row.

    The title is the user's first message: it is what they actually came to do,
    and it beats a generated summary that has to be kept fresh.
    """
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT s.id::STRING AS id,
                   s.started_at, s.last_active_at, s.channel,
                   COALESCE(s.running_summary, '') AS summary,
                   (SELECT count(*) FROM conversation_turns AS t
                    WHERE t.session_id = s.id) AS turns,
                   (SELECT t.content FROM conversation_turns AS t
                    WHERE t.session_id = s.id AND t.role = 'user'
                    ORDER BY t.seq LIMIT 1) AS opened_with
            FROM sessions AS s
            JOIN users AS u ON u.id = s.user_id
            WHERE u.handle = %s
            ORDER BY s.last_active_at DESC
            LIMIT %s
            """,
            (user_handle, limit),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return [
        {
            "id": r["id"],
            "started_at": r["started_at"].isoformat(),
            "last_active_at": r["last_active_at"].isoformat(),
            "channel": r["channel"],
            "turns": r["turns"],
            # Raw turns TTL away after 30 days, so an old session legitimately
            # has none left. Say that rather than showing an empty row.
            "title": (r["opened_with"] or r["summary"] or "").strip(),
        }
        for r in rows
    ]


async def append_turn(
    session_id: UUID,
    role: str,
    content: str,
    tool_calls: list[dict] | None = None,
    context_trace: dict | None = None,
) -> None:
    async def _fn(conn: AsyncConnection) -> None:
        cur = await conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM conversation_turns WHERE session_id = %s",
            (session_id,),
        )
        seq = (await cur.fetchone())[0]
        await conn.execute(
            """
            INSERT INTO conversation_turns
                (session_id, seq, role, content, tool_calls, context_trace)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                session_id,
                seq,
                role,
                content,
                json.dumps(tool_calls, default=str) if tool_calls else None,
                json.dumps(context_trace, default=str) if context_trace else None,
            ),
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
