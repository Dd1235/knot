"""Read models for the Memory Inspector: look inside all four memory stores."""

from uuid import UUID

from psycopg.rows import dict_row

from app.db.pool import pool


async def _rows(query: str, params: tuple) -> list[dict]:
    async with pool().connection() as conn:
        cur = await conn.execute(query, params)
        cur.row_factory = dict_row
        return await cur.fetchall()


async def overview(user_handle: str) -> dict:
    counts = await _rows(
        """
        SELECT
            (SELECT count(*) FROM semantic_facts f
              JOIN users u ON u.id = f.user_id WHERE u.handle = %s
              AND f.superseded_by IS NULL) AS semantic_facts,
            (SELECT count(*) FROM episodic_events e
              JOIN users u ON u.id = e.user_id WHERE u.handle = %s) AS episodic_events,
            (SELECT count(*) FROM procedural_rules r
              JOIN users u ON u.id = r.user_id
              WHERE u.handle = %s AND r.active) AS procedural_rules,
            (SELECT count(*) FROM sessions s
              JOIN users u ON u.id = s.user_id WHERE u.handle = %s) AS sessions
        """,
        (user_handle, user_handle, user_handle, user_handle),
    )
    return counts[0]


async def semantic_facts(user_handle: str, limit: int = 50) -> list[dict]:
    rows = await _rows(
        """
        SELECT f.id::STRING, f.kind, f.subject, f.fact, f.confidence, f.evidence_count,
               f.last_reinforced_at, f.created_at, f.superseded_by::STRING
        FROM semantic_facts AS f JOIN users AS u ON u.id = f.user_id
        WHERE u.handle = %s
        ORDER BY f.last_reinforced_at DESC
        LIMIT %s
        """,
        (user_handle, limit),
    )
    for row in rows:
        row["last_reinforced_at"] = row["last_reinforced_at"].isoformat()
        row["created_at"] = row["created_at"].isoformat()
    return rows


async def episodic_events(user_handle: str, limit: int = 50) -> list[dict]:
    rows = await _rows(
        """
        SELECT e.id::STRING, e.kind, e.summary, e.occurred_at,
               e.ref_transaction_id::STRING
        FROM episodic_events AS e JOIN users AS u ON u.id = e.user_id
        WHERE u.handle = %s
        ORDER BY e.occurred_at DESC
        LIMIT %s
        """,
        (user_handle, limit),
    )
    for row in rows:
        row["occurred_at"] = row["occurred_at"].isoformat()
    return rows


async def procedural_rules(user_handle: str, limit: int = 50) -> list[dict]:
    rows = await _rows(
        """
        SELECT r.id::STRING, r.kind, r.trigger_text, r.rule, r.usage_count,
               r.source, r.active, r.created_at
        FROM procedural_rules AS r JOIN users AS u ON u.id = r.user_id
        WHERE u.handle = %s
        ORDER BY r.created_at DESC
        LIMIT %s
        """,
        (user_handle, limit),
    )
    for row in rows:
        row["created_at"] = row["created_at"].isoformat()
    return rows


async def session_trace(user_handle: str, session_id: UUID) -> list[dict]:
    """Turns with their tool calls and injected-memory traces — the full
    'what did the agent know and do' record of a conversation."""
    rows = await _rows(
        """
        SELECT t.seq, t.role, t.content, t.tool_calls, t.context_trace, t.created_at
        FROM conversation_turns AS t
        JOIN sessions AS s ON s.id = t.session_id
        JOIN users AS u ON u.id = s.user_id
        WHERE u.handle = %s AND t.session_id = %s
        ORDER BY t.seq
        """,
        (user_handle, session_id),
    )
    for row in rows:
        row["created_at"] = row["created_at"].isoformat()
    return rows


async def recent_actions(user_handle: str, limit: int = 50) -> list[dict]:
    rows = await _rows(
        """
        SELECT a.id::STRING, a.session_id::STRING, a.tool, a.args, a.result_summary,
               a.error, a.latency_ms, a.created_at
        FROM agent_actions AS a
        JOIN sessions AS s ON s.id = a.session_id
        JOIN users AS u ON u.id = s.user_id
        WHERE u.handle = %s
        ORDER BY a.created_at DESC
        LIMIT %s
        """,
        (user_handle, limit),
    )
    for row in rows:
        row["created_at"] = row["created_at"].isoformat()
    return rows
