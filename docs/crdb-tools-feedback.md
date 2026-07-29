# Feedback on CockroachDB's AI tooling

Written while building [Knot](../readme.md) — a voice-first finance agent whose
ledger and four agent-memory stores share one CockroachDB cluster. This is
honest field notes from ~3 days of continuous use, not a testimonial: what
worked, what cost us time, and what we'd want next.

## Vector indexing — the reason this architecture exists

`VECTOR(512)` plus `CREATE VECTOR INDEX` is what let us delete a whole category
of infrastructure. The thing we did that a bolt-on vector database structurally
cannot do:

```sql
-- inside ONE serializable transaction
SELECT id, embedding <-> $1::VECTOR AS distance
FROM semantic_facts
WHERE user_id = $2 AND kind = $3 AND superseded_by IS NULL
ORDER BY embedding <-> $1::VECTOR LIMIT 1;
-- ...then, atomically, either reinforce the near-duplicate or insert
```

Memory consolidation is read-then-conditionally-write. With a separate vector
store that is a distributed transaction you cannot have, so everyone writes it
as "search, then hope". Here it is one transaction and the race simply cannot
happen. **This deserves to be the headline example in the docs** — it is a
sharper argument than "you can store embeddings too".

Prefixing the index with `user_id` (`CREATE VECTOR INDEX … ON t (user_id, embedding)`)
worked exactly as hoped for multi-tenant scoping.

**Friction:** index creation runs as an async job and prints
`NOTICE: waiting for job(s) to complete`. In a migration runner that is fine,
but it wasn't obvious up front whether a subsequent query would see a fully
built index. A sentence in the vector-index docs on read behaviour during
backfill would have saved us a nervous detour.

**Wish:** a `SHOW VECTOR INDEXES` or a documented way to inspect C-SPANN health
(partition count, recall estimate). We tuned similarity thresholds empirically
by measuring L2 distances across ~40 real phrasings; we'd have liked to see what
the index thought.

## Row-Level TTL — did exactly what it says

Three tables use it: conversation turns (30d), agent action logs (90d),
idempotency keys (7d). Declaring it in `CREATE TABLE … WITH (ttl_expire_after …)`
and never thinking about it again is the correct developer experience.

It also gave us a *product* idea rather than just an ops one: raw conversation
turns expire while distilled summaries persist, so the agent genuinely forgets
verbatim chatter the way a person does. **That framing — TTL as deliberate
forgetting in agent memory — is worth a docs example**; every TTL example we
found was about log/event cleanup.

## Serializable isolation and 40001 retries

The one thing we most wanted to demonstrate, and it worked first time: ten
concurrent settlements of the same debt, exactly one commits, the ledger stays
zero-sum. Our `run_serializable()` helper (set isolation, catch
`SerializationFailure`, jittered backoff) is ~40 lines and has needed no
changes since.

**Gap worth closing:** the docs explain retries well for hand-written SQL, but
we found no canonical async-Python example. Every driver-level example we could
find was sync psycopg2. A short `psycopg3 async` retry snippet in the
transaction-retry docs would be genuinely useful — this is the code path every
serious application needs and gets subtly wrong.

## Postgres-compatibility edges we hit

Compatibility is very good; these are the three places we spent real time:

1. **No cross-row CHECK constraints.** Expected (Postgres is the same), but for
   a double-entry ledger the "legs sum to zero" invariant is the whole game. We
   enforce it in the application *and* re-verify with `SELECT SUM` inside the
   same transaction. A documented pattern page for multi-row invariants —
   perhaps the accepted uses of `SELECT … FOR UPDATE` vs re-verification under
   serializable — would help anyone modelling ledgers, inventory, or bookings.
2. **`make_interval(hours => $1)` is a syntax error.** The named-argument form
   is not supported; we switched to passing a Python `timedelta` as a parameter,
   which is cleaner anyway. A note in the Postgres-compatibility list would have
   caught this at write time instead of test time.
3. **`ALTER TABLE … ALTER COLUMN TYPE`** needing an experimental setting is
   documented, but the docs page we landed on first didn't mention it.

## `ccloud` CLI

Cluster creation, SQL user, connection string — straightforward and genuinely
scriptable, which is the point for agent-driven workflows. The certificate step
(`curl --create-dirs … /cert`) for `sslmode=verify-full` is easy to miss when
you copy a connection string out of the console; surfacing it *next to* the
connection string rather than a click away would prevent a confusing first
failure.

## MCP servers

**Docs MCP server** — used constantly and it changed how we worked. Asking
"how does Row-Level TTL interact with changefeeds" mid-file and getting a
sourced answer without a context switch is a real productivity change, and the
answers were accurate every time we cross-checked them.

**Cloud MCP server** — the read-only-by-default posture with write behind
explicit consent is the right default for a tool that an agent drives. Setup
via the connect modal was a two-minute job.

One genuine request: the OAuth flow requires an interactive browser, which
means a headless or CI agent can't use it without a service-account key. That
is understandable, but it does mean the "agent operates the database" story
splits into two setups. Documenting the service-account path as the *primary*
route for autonomous agents (rather than a footnote to the OAuth path) would
match how people will actually deploy it.

## What we'd ask for next

1. **Vector index observability** — even a basic `EXPLAIN` annotation showing
   whether a query used the vector index and how many partitions it scanned.
   Today we can't tell an index scan from a brute-force rescan from the client.
2. **A canonical async retry example** per driver (see above).
3. **An "agent memory on CockroachDB" reference schema** — the four-store
   taxonomy (working / episodic / semantic / procedural) is converging across
   the industry, and CockroachDB is unusually well suited to it because
   consolidation wants transactions. A worked schema would land better than a
   generic RAG tutorial, because RAG is the easy case; *memory that updates
   itself* is the hard one, and it is the one your isolation guarantees
   actually solve.
