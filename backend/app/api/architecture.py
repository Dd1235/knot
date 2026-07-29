"""What the system actually is, read from the running cluster.

Everything here is introspected rather than written down, because a page that
explains an architecture is only worth reading if it cannot drift from the
architecture. The version string, the vector indexes and the TTL settings are
whatever the database says they are right now.
"""

from fastapi import APIRouter, Depends

from app.auth.deps import current_user
from app.db.pool import pool

router = APIRouter(prefix="/architecture", tags=["architecture"])

# The four stores of the CoALA taxonomy, and the table each one lives in.
MEMORY_TABLES = {
    "working": "conversation_turns",
    "episodic": "episodic_events",
    "semantic": "semantic_facts",
    "procedural": "procedural_rules",
}

VECTOR_TABLES = ("episodic_events", "semantic_facts", "procedural_rules")
TTL_TABLES = ("conversation_turns", "agent_actions", "idempotency_keys")


@router.get("/stack")
async def stack(x_user: str = Depends(current_user)) -> dict:
    async with pool().connection() as conn:
        version = (await (await conn.execute("SELECT version()")).fetchone())[0]

        # Vector indexes, by name, straight from the catalog. These are what
        # make similarity search a SQL operation inside the same transaction
        # as the write, rather than a round trip to a separate vector store.
        vector_indexes = []
        for table in VECTOR_TABLES:
            cur = await conn.execute(
                f"SELECT index_name, column_name, seq_in_index "
                f"FROM [SHOW INDEXES FROM {table}] "
                f"WHERE index_name LIKE '%embedding%' OR index_name LIKE '%trigger%' "
                f"ORDER BY seq_in_index"
            )
            columns: list[str] = []
            index_name = ""
            for name, column, _ in await cur.fetchall():
                index_name = name
                if column not in columns:
                    columns.append(column)
            if index_name:
                # The leading user_id is the interesting part: each user's
                # vectors are their own partition of the index, so similarity
                # search never scans another tenant's memories.
                vector_indexes.append(
                    {"table": table, "index": index_name, "columns": columns}
                )

        # Row-Level TTL: the database forgets on its own. Raw conversation is
        # disposable; what survives is what was distilled from it.
        ttl = []
        for table in TTL_TABLES:
            cur = await conn.execute(f"SELECT create_statement FROM [SHOW CREATE TABLE {table}]")
            row = await cur.fetchone()
            ddl = row[0] if row else ""
            expire = _between(ddl, "ttl_expire_after = '", "'")
            if expire:
                ttl.append({"table": table, "expire_after": expire})

        # Live counts for this user, so the taxonomy is illustrated by their
        # own data rather than by an example.
        counts = {}
        for store, table in MEMORY_TABLES.items():
            column = "session_id" if table == "conversation_turns" else "user_id"
            if table == "conversation_turns":
                cur = await conn.execute(
                    "SELECT count(*) FROM conversation_turns AS t "
                    "JOIN sessions AS s ON s.id = t.session_id "
                    "JOIN users AS u ON u.id = s.user_id WHERE u.handle = %s",
                    (x_user,),
                )
            else:
                cur = await conn.execute(
                    f"SELECT count(*) FROM {table} AS t "
                    f"JOIN users AS u ON u.id = t.{column} WHERE u.handle = %s",
                    (x_user,),
                )
            counts[store] = (await cur.fetchone())[0]

        cur = await conn.execute(
            "SELECT count(*) FROM transaction_legs AS l "
            "JOIN accounts AS a ON a.id = l.account_id "
            "JOIN users AS u ON u.id = a.user_id WHERE u.handle = %s",
            (x_user,),
        )
        legs = (await cur.fetchone())[0]

        # The invariant, checked live. Every leg the user owns, summed.
        cur = await conn.execute(
            "SELECT COALESCE(SUM(l.amount), 0)::STRING FROM transaction_legs AS l "
            "JOIN accounts AS a ON a.id = l.account_id "
            "JOIN users AS u ON u.id = a.user_id WHERE u.handle = %s",
            (x_user,),
        )
        ledger_sum = (await cur.fetchone())[0]

    return {
        "version": version,
        "vector_indexes": vector_indexes,
        "ttl": ttl,
        "memory_counts": counts,
        "legs": legs,
        "ledger_sum": ledger_sum,
    }


def _between(text: str, start: str, end: str) -> str | None:
    i = text.find(start)
    if i < 0:
        return None
    j = text.find(end, i + len(start))
    return text[i + len(start) : j] if j > 0 else None
