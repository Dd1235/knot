# Knot — Design Decision Log

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

### D18. Embedding provider is pinned per environment, never switched mid-flight
OpenAI and Titan embeddings share our 512-dim column shape but live in different vector spaces — a query embedded by one is meaningless against vectors stored by the other. So `EMBEDDING_PROVIDER` is an environment-lifetime choice: dev runs OpenAI; the judged deployment starts fresh on Bedrock Titan and seeds its own demo data. If a mid-life switch is ever needed, every stored embedding must be re-embedded.

### D19. Voice is a ladder: Web Speech now, Nova 2 Sonic when AWS clears
Browser Web Speech API (`en-IN`) gives free on-device speech-to-text with live transcripts, and speechSynthesis speaks replies — voice-first UX with zero cloud dependency, shipping today. Amazon Nova 2 Sonic (bidirectional streaming, barge-in, Hindi) upgrades the experience later behind the same `/chat` + tool registry; the voice path never gets its own business logic. AWS's account-verification gate blocks all Bedrock generative models equally (tested: same "Operation not allowed" via SigV4 and Bedrock API key), so no provider swap dodges it — only waiting does.

### D20. Provider strategy: Bedrock open models for the brain, OpenAI where genuinely better
Bedrock's catalog (verified in us-east-1) carries Mistral Large 3, Kimi K2.5 / K2-Thinking, DeepSeek v3.2, and Qwen3 — none need Anthropic's use-case agreement. Plan: once account verification clears, benchmark Kimi K2.5 and Mistral Large 3 against gpt-5-mini on our tool-discipline suite (the 3/3 rent-rule test) and make the winner the judged-demo default. OpenAI stays for what it is genuinely best at: dev-mode iteration and realtime voice (until Nova 2 Sonic unblocks). Budget ceiling for personal use: <$10/month out of pocket (AWS hosting comes from credits; site torn down after judging).

### D22. The AWS story is compute + storage + observability, not Bedrock
Tested 2026-07-29 with valid root credentials: **every Bedrock generative model is blocked** (`Operation not allowed` — Nova Micro/Lite/Pro, Mistral Ministral, Kimi K2.5, Llama 4 Scout, DeepSeek v3.2, Qwen3), and Titan embeddings — which worked the day before — is now blocked too, so this is an account-level Bedrock gate, not IAM permissions and not per-provider paperwork. Meanwhile **S3, ECR, App Runner, Lambda, and CloudWatch Logs all work**. The hackathon requires ≥1 AWS service ("Lambda, ECS/EKS, S3, SageMaker, or equivalent"), so we satisfy it — and arguably tell a stronger production-readiness story — with containerized deployment on App Runner, S3-backed exports, and CloudWatch logging. The Bedrock provider stays wired and one env var away; if the gate lifts we add it as a second inference option rather than depending on it.

### D21. Spending groups live in a seeded table, not code
The professional needs/wants/savings split (essentials / discretionary / savings_invest / income) is a `category_groups` table seeded by migration, LEFT-JOINed in analytics SQL with COALESCE to 'other'. In-table (not a Python dict) so dashboards are pure SQL, unmapped categories degrade gracefully, and per-user overrides are one column away. Charts use fixed group colors (validated dark palette: blue/orange/aqua/yellow) — color follows the entity, never the rank.

### D23. Investing is not spending, so it is not an expense account
A SIP posted to `expense:sip` was wrong twice over, and the two errors compounded: net worth fell by ₹10,000 every time the user moved ₹10,000 into a fund, and every "you spent" total was inflated by their savings. An app that renders saving as a loss teaches the opposite of what it exists to teach.

Investment categories now route to an `invest:` account, which falls through `_account_type` to `asset` — money that changed shape, not money that left. Net worth stays flat, spend totals exclude it, `total_invested` is reported alongside, and `safe_to_spend` excludes it too, because mutual fund units do not buy chai. The taxonomy also gained `nps`, `ppf`, `elss`, `rd`, `gold`, `crypto` and `bonds`, which previously fell into `other` and were counted as discretionary spending.

The Python `INVESTMENT_CATEGORIES` set and the `savings_invest` rows in migration 0004/0008 are two sources of truth, so a test asserts they are equal. Drift is now a test failure rather than a silent mis-categorisation.

### D24. The heatmap ranks days, and refuses to shade a day you saved
Six months of spending as a GitHub-style calendar grid. Three choices carry it:

**Intensity is a rank, not a ratio.** Scaling linearly against the maximum lets one rent day flatten a year to step 1. Cells bucket by quartile over *spending days only*, so the ramp always uses its full range and a heavy day reads heavy relative to how this person normally lives rather than relative to their worst day ever.

**Investing never darkens a cell** — it gets a quiet ring instead. The grid cannot scold someone for saving.

**A no-spend day is an absence, not a zero.** Surface colour plus a hairline, with the streak counter doing the celebrating; tinting it green would collide with income.

The ramp is a single hue stepped evenly in OKLCH (H 45), computed rather than eyeballed, and every adjacent pair was checked in OKLab before shipping. The first attempt put step 1 only 6.3 from the empty-day colour — a day with real spending on it looked like a day with none.

### D25. The warm end of the palette had three collisions, all measured
Adding a sequential ramp exposed conflicts that were invisible while the palette was purely categorical:

- The heatmap's hot step sat at hue 45; the `discretionary` group colour at hue 40. The same colour meant two different things on one page. Discretionary moved to violet; warm now belongs to the sequential ramp alone.
- `chart-3` (savings) and `positive` (income) were **4.9 apart in OKLab** — indistinguishable in dark mode while claiming to differ. They now share the positive green and say the one thing they have in common: money that stayed yours.
- Spend stopped wearing brand gold. The daily bars and the heatmap encode the same measure, so they take the same hue, and gold went back to being chrome that never encodes data — which is what the plan had called for.

The lesson worth keeping: a palette is only "validated" against the charts that existed when you validated it.

### D26. Annotate what changed, not what merely is
The per-transaction annotations passed their gate on a seeded day at 21% and then embarrassed themselves against six months of realistic data: "29 visits this month", on nine merchants at once. Every one true. Every one worthless — the user knows where they eat.

Two rounds of threshold tuning did not fix it, because the problem was never *how often* a habit fires. An established habit is not news to the person living it. So a settled habit earns nothing; what earns a word is a habit that just **formed**, a charge repeating at the same amount **across months**, a price that **moved**, or a day that got away.

Two correctness bugs surfaced from reading the output rather than the code. Counting same-amount charges alone called a ₹38 bus fare a subscription, because it is the same ₹38 every morning — subscriptions repeat across *months*. And prices were compared to the *category* median, so an ₹859 bakery run read as "higher than typical shopping (₹286)"; a bakery is not every shop the user has ever visited. Baselines are now per-merchant.

**The fix that mattered most: gating the kind was never enough.** The model still had every number in front of it and reached past the gate for the dullest one, writing "Reached 31 Swiggy orders" under a gate that had opened for a repeating charge. The context packet is now narrowed to the fields the qualifying kind needs. A model cannot say what it is not told — the same principle as "SQL computes, the model phrases", applied one level deeper.

Honest status: on synthetic data the rate sits at ~41% rather than the 15–25% target, inflated by a seed that introduces seventeen brand-new merchants at once, which reads as an extraordinary month. Every surviving note is about a change. Further tuning against fabricated data would be overfitting.

### D27. Identity on a transaction row is a glyph, not a hue
The coloured spine was replaced by a category glyph. Shape survives greyscale, colour blindness and forced-colours mode, and stays legible at the twelfth category, where hue #12 of a categorical ramp does not. The group tint stays behind the glyph at 16% so it never competes with the amount.

Rows under ₹100 render lighter and tighter. Indian UPI is dominated by small payments — 76% are under ₹500 — so if the chai shouts as loudly as the rent, nothing reads. ₹100 is where a payment stops being an event and becomes the texture of a day.

Two things were removed for the same reason: a `voice` badge on every row (speech is how this app is meant to be used, so badging all of them marks none of them) and a `raw_input` echo that repeated the row back — "saloon 375" beside a row already saying saloon and ₹375 — then truncated mid-word.

### D28. One dashboard on a laptop, one column on a phone
The insights page was a single `max-w-lg` column that wasted roughly two thirds of a laptop screen. Desktop now gets an 8/4 grid with everything *actionable* held in a sticky right rail: safe-to-spend, what I notice, what is due, who owes you, cash to reconcile. The phone keeps a single stack ordered so the two things you can act on today come first.

This also fixed the bug that made the AI card useless: it was nested inside the `loading` branch, so it unmounted the moment the analytics request resolved. It has its own fetch and its own lifecycle, so it now lives outside both.

Net worth dropped from a hero tile to one quiet row. It barely moves and it changes no decision.
