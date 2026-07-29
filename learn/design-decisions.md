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

### D12. Non-streaming agent loop first; SSE later
The MVP `/chat` returns complete JSON. Streaming with tool-call delta assembly is real work with real bugs; it lands with the frontend polish stage. The loop's contract (provider-neutral messages, tool registry) doesn't change when streaming arrives.

### D13. Split rounding: the user absorbs the paise
"12,000 three ways" gives others ₹4,000 each; when shares don't divide evenly (₹100/3), others owe the rounded share (₹33.33) and the user's own expense leg absorbs the remainder (₹33.34) so legs still sum to zero exactly. Never let rounding drift into someone else's debt.

### D14. Cross-request history replays text only
When a session continues, the agent re-reads prior turns as plain user/assistant text — tool-call internals are not replayed. Tool outcomes live in the ledger itself, which the agent re-queries; replaying stale tool results would be a second source of truth that can lie.

### D15. Prompt examples must be name-free (found via the context trace)
The rent-split demo "worked" on the first try — but the context trace showed NO memory was injected. The model had copied "Arun and Priya" from a few-shot example in our own system prompt: a fake memory win that would silently split rent with the wrong people for any real user. Fixed with placeholder names and an explicit "names come only from the user's words or injected memory" rule. Lesson: the injection trace isn't just inspector UI — it's how we catch the agent lying about remembering.

### D16. Procedural triggers embed trigger + instruction, threshold measured not guessed
Models write unreliable trigger phrases (declarative restatements, single words) no matter what the tool schema says. We embed `"{trigger}. {instruction}"` — the instruction carries the key nouns real future messages share. Measured on text-embedding-3-small/512: related casual phrasings land at 0.57–0.98 L2, unrelated at 1.11+; threshold 1.05. Over-injection is cheap (the model ignores irrelevant rules); under-injection silently loses taught behavior.

### D17. gpt-4.1-mini as the dev-mode default
gpt-4o-mini recorded the taught rent split in only 1 of 3 identical runs (and once claimed "Done!" without calling any tool — countered by an explicit "never say recorded unless a tool succeeded this turn" prompt rule). gpt-4.1-mini: 3 of 3 with the rule injected each time. ~4x the price of 4o-mini, still pennies; Bedrock Claude remains the judged-demo model.
