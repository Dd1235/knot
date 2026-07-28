# Ledger — Design Decision Log

Running log of every significant design decision, newest last. Format: what we chose, what we rejected, and why.

## 2026-07-28

### D1. Hand-rolled agent loop, no LangGraph/framework
The tool-calling loop is ~150 LOC. Agentic memory design is the #1 judging criterion — it must be visible in *our* code, not buried in framework abstractions. Fewer dependencies, fewer 3-week surprises. Nova 2 Sonic later reuses the same tool registry via its own event stream, so the framework would not even unify text and voice.

### D2. Raw SQL via psycopg3, no ORM
Judges reward "production-grade CRDB integration beyond toy queries". Explicit `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`, 40001 retry handling, `CREATE VECTOR INDEX`, and Row-Level TTL DDL *are* the story. An ORM hides all of it. Numbered `.sql` migration files + a tiny runner (see `backend/app/db/migrate.py`) double as schema documentation.

### D3. Single-column double-entry (debits positive, credits negative)
Alternative was two-column debit/credit accounting style. Single signed column makes the invariant trivial (`SUM(amount) = 0` per transaction) and balance queries one-line `SUM`s. Sign convention documented in `0001_ledger.sql`.

### D4. Zero-sum invariant enforced app-side, inside the serializable txn
CockroachDB (like Postgres) has no cross-row CHECK constraints. We validate legs sum to zero in Python *and* re-verify with a `SELECT SUM` against the inserted rows inside the same serializable transaction before commit. Deliberate, documented tradeoff — deferred triggers were rejected as more magic for no additional safety under serializable isolation.

### D5. Balances always derived, never stored
No mutable `balance` column anywhere; `person_balances` is a view over legs. A stored balance is a cache that can drift; a derived balance cannot. This is the foundation of the concurrency demo ("two writes race, ledger stays balanced").

### D6. Provider plug-and-play pinned at 512 embedding dims
`LLM_PROVIDER` / `EMBEDDING_PROVIDER` env switches choose OpenAI (cheap dev mode, no AWS spend) or Bedrock (judged mode). OpenAI `text-embedding-3-small` and Bedrock Titan v2 both emit 512-dim vectors, so every `VECTOR(512)` column is provider-independent — switching providers never requires re-migrating the database. Claude Max cannot power the product (no API keys with a chat subscription); it powers the development instead.

### D7. Idempotency keys with Row-Level TTL, not app cleanup
`idempotency_keys` dedupes client retries (voice clients double-fire easily) and expires via CRDB Row-Level TTL (`ttl_expire_after = '7 days'`). No cron, no app-level janitor. Also our first live demonstration of TTL for the "memory that forgets" story.

### D8. CockroachDB cluster in aws-ap-south-1 (Mumbai)
Target persona is an Indian UPI user; ~90ms round trip from a laptop in India-adjacent latitudes beats us-east by 3-4x. AWS Bedrock runs in us-east-1 (model availability); the latency-sensitive path is user↔DB, not agent↔LLM.

## 2026-07-29

### D9. AWS credentials via `aws login` (short-lived), not static IAM keys
AWS's new free-tier console steers away from long-lived access keys; the official [agent-toolkit-for-aws](https://github.com/aws/agent-toolkit-for-aws) flow issues 12-hour browser-authenticated credentials (auto-renewing 90 days). More secure than keys in `.env`, and boto3 picks them up from the default chain with zero code. Deployed environments will use IAM task roles — static keys never exist anywhere. (We skipped the toolkit's agent-rules install steps; only credentials matter to this app.)

### D10. Four-store memory taxonomy (CoALA), each with its own retrieval logic
Planned stores: **working** (session turns + running summary, a context-*budget* problem, TTL'd), **episodic** (what happened when — auto-written from committed transactions, vector-searchable), **semantic** (facts with confidence + evidence counts, upsert-by-similarity dedup, `superseded_by` instead of delete), **procedural** (user-taught rules like "rent splits 3-way", trigger-matched by embedding). 2026 consensus is that collapsing these into one retrieval problem is the classic mistake; keeping them separate is our differentiation.

### D11. Named parameterized query templates only — the LLM never writes SQL
`query_ledger` exposes an allowlist of named templates (spend by category, weekend averages, recent txns). Rejected letting the model generate SQL: unbounded blast radius, injection surface, and judges explicitly score security posture.
