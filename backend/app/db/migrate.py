"""Apply numbered SQL migrations in order.

Usage: uv run python -m app.db.migrate

Migration files run on an autocommit connection because CockroachDB schema
changes (vector index builds, TTL params) run as async jobs and are best kept
out of explicit transactions. Each file is recorded in schema_migrations after
it completes, so reruns are no-ops.
"""

import sys
from pathlib import Path

import psycopg

from app.config import get_settings

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def main() -> int:
    with psycopg.connect(get_settings().database_url, autocommit=True) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename STRING PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        applied = {row[0] for row in conn.execute("SELECT filename FROM schema_migrations")}
        pending = [
            f for f in sorted(MIGRATIONS_DIR.glob("[0-9]*.sql")) if f.name not in applied
        ]
        if not pending:
            print("schema up to date")
            return 0
        for f in pending:
            print(f"applying {f.name} ...", flush=True)
            conn.execute(f.read_text())
            conn.execute(
                "INSERT INTO schema_migrations (filename) VALUES (%s)", (f.name,)
            )
        print(f"applied {len(pending)} migration(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
