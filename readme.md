# Knot — money you can just talk about

You tie a knot so you don't forget. Talk to it like a person: *"lent Priya ₹500 for lunch"*,
*"paid 12,000 rent, split three ways"*, *"did Priya pay me back yet?"*. Every money statement becomes a balanced double-entry
transaction committed atomically, while the people, habits, and rules of your financial life
become durable agent memory — recalled by meaning, not exact match.

Built for the [CockroachDB × AWS Hackathon: Build with Agentic Memory](https://cockroachdb-ai.devpost.com/).

## Why CockroachDB

Money needs strict serializable ACID; *"what do I usually spend on weekends?"* needs semantic
vector search. One CockroachDB cluster provides both — the ledger, all four memory stores
(working, episodic, semantic, procedural), and their vector indexes live in a single
distributed, failure-surviving database. No bolt-on vector DB, no separate cache.

## Features

### Talk, don't file

- **Natural-language bookkeeping** — *"chai 15"*, *"gpay'd 40 for auto"*, *"got 1200 rent
  from the tenant"*. The agent posts balanced journal entries; it never invents a number.
- **Streaming replies** with live tool chips (first feedback in 1.6–3.3s), plus badges on
  every answer showing exactly which tools ran — `recorded`, `settled`, `balances`.
- **"N memories used"** on each reply expands into the actual rules, facts and episodes the
  agent recalled — the memory layer is inspectable mid-conversation, not a black box.
- **Two voice modes, priced honestly**: free on-device speech (dictation into the composer,
  and a hands-free loop — no audio leaves the device) and a live low-latency conversation
  mode with barge-in interruption, billed per minute, one tap away. Voice turns land in the
  same session history as text.
- **Sessions that persist** — reload and the conversation is still there; "new conversation"
  starts a fresh session while everything learned stays in memory.

### A real ledger underneath

- **Double-entry, always balanced** — debits positive, credits negative, every transaction's
  legs sum to zero. The invariant is checked at request time and shown live on
  [/architecture](frontend/src/app/architecture/page.tsx).
- **Balances are derived, never stored** — net worth is `SUM(assets) − SUM(liabilities)` at
  read time, so it cannot drift from the entries that justify it.
- **Corrections are reversals** — a wrong entry is voided by an equal-and-opposite entry.
  History is append-only; nothing is ever silently edited or deleted.
- **Serializable isolation with retry handling** — concurrent writes cannot corrupt the
  books. The built-in **race demo** fires 10 simultaneous settlements of the same debt:
  exactly one commits, the rest are cleanly rejected, and the ledger still sums to zero.
- **Opening balances and income** — salary, freelance, rent received, dividends, refunds,
  cashback; money in is first-class, not an afterthought.

### People and debts

- **Lent / borrowed / settled / repaid**, per person — *"lent Priya 500"*, *"borrowed 2000
  from Arjun"*, *"Priya paid me back"*. Settlement reads the live balance inside the
  writing transaction, which is what makes the race demo lose safely.
- **Receivables at a glance** — who owes you and whom you owe, as chips above the chat and
  a dedicated debts page with settled history.

### Investments

- **Buys with cost basis** — *"bought 10 Reliance at 1380"*, *"put 5000 into Nifty 50"*.
  Quantity rides as an annotation on the money leg; weighted-average cost per instrument.
- **Mark-to-market by voice** — *"Reliance is at 1450 now"* revalues the holding; unrealized
  gains stay separated from cashflow so they can't inflate spending numbers.
- **Sells relieve the holding** and book realized capital gains as income.
- **SIPs are investments, not expenses** — the category taxonomy routes SIP/stocks/mutual
  funds to asset accounts, so investing never shows up as "spending".
- A portfolio page with per-instrument units, cost, value, and gain.

### Loans and EMIs

- *"I have a 5 lakh car loan at 9% for 5 years"* — the agent tracks it as a liability.
- **EMI splits principal from interest** each period; outstanding principal is re-read from
  the ledger every time, so the amortisation schedule is a consequence of the books, not a
  stored table that can drift.

### Recurring money

- Salary on the 1st, rent, Netflix — recurring commitments post on their dates through the
  same categorised pipeline as everything else.
- Track, list, and stop by voice.

### Limits that understand calendars

- *"keep me under 10k for food"* — monthly caps per category.
- **Judged by pace, not percentage**: 60% spent on the 10th is a warning; 60% on the 25th
  is fine. Projections only after enough of the month has elapsed to mean something.
- Limits are editable directly in the UI (no agent required), and a limit
  running hot is coloured by its pace — the derivative, not the level.

### Insights — SQL computes, the model phrases

- **GitHub-style spending heatmap** of the last half year, invested days marked separately —
  a heavy SIP day is not a "bad" day.
- Daily spend chart, category and spending-group breakdowns (essentials / discretionary /
  savings), merchant frequency ("where you go most"), today-vs-usual rhythm.
- **Safe-to-spend until payday** — accounts minus what's already committed before salary.
- **"What I notice"** — the one place the model reads aggregates: it phrases changes SQL
  already found (*"eating out is up 237%"*), and every number in the sentence comes from a
  query, never from generation.
- **CSV export** of any period, streamed inline.

### Memory that earns the name (CoALA four-store)

- **Working** — the current conversation, with the memories injected into each turn.
  Disposable by design: it expires via Row-Level TTL.
- **Episodic** — things that happened, recalled by vector similarity to what you just said.
- **Semantic** — durable facts about people, merchants, habits (*"Priya is my flatmate"*),
  distilled by a background pass with confidence and reinforcement counts; corrections
  supersede rather than duplicate.
- **Procedural** — rules you teach once (*"rent is split 3 ways with Kiran and Meera"*),
  matched by similarity between the rule's trigger and your words, with usage counts.
- All four are queryable in the **memory inspector**, alongside a log of every tool call
  the agent made and its latency.

### Everyday product

- **Any display currency** — books stay in ₹; INR/USD/EUR/GBP/AED/SGD/AUD/CAD/JPY at the
  rate you actually got, editable, conversion at display time only.
- Light and dark themes (warm ink-and-gold design system), PWA install, responsive from
  phone to desktop, full transaction search.

## Stack

- **Backend**: Python / FastAPI, psycopg3 + raw SQL (serializable transactions, explicit retries)
- **Database**: CockroachDB Cloud (ap-south-1) — `VECTOR` + vector indexes, Row-Level TTL, JSONB
- **Models**: plug-and-play providers — OpenAI today; Amazon Bedrock behind the
  same protocol (account-gated, see below)
- **Voice**: on-device Web Speech (free) + OpenAI Realtime over WebRTC (live mode);
  both drive the same tool registry as text
- **Frontend**: Next.js mobile-first PWA

## Setup

1. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (CockroachDB Cloud → Connect)
   plus your model provider keys.
2. Trust the cluster CA cert (needed for `sslmode=verify-full`):

   ```sh
   curl --create-dirs -o $HOME/.postgresql/root.crt \
     'https://cockroachlabs.cloud/clusters/<CLUSTER_ID>/cert'
   ```

3. Run both servers: `./scripts/dev.sh start` (backend :8000, frontend :3100).
   Stop with `./scripts/dev.sh stop`.

## How it works

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full picture: the double-entry
ledger and its serializable guarantees, the four memory stores and their
retrieval strategies, and how both live in one CockroachDB cluster.

## CockroachDB and AWS tools used

**CockroachDB**
- **Distributed vector indexing** — three `CREATE VECTOR INDEX`es (episodic,
  semantic, procedural memory), user-scoped. Memory consolidation runs its
  similarity search *inside* the transaction that writes the fact.
- **`ccloud` CLI** — cluster provisioning and connection retrieval.
- **Cloud MCP Server** — schema exploration and query debugging (`.mcp.json`).
- **Docs MCP Server** — used throughout; feedback in
  [docs/crdb-tools-feedback.md](docs/crdb-tools-feedback.md).
- Also load-bearing: serializable isolation with 40001 retry handling,
  Row-Level TTL on three tables, JSONB.

**AWS** — stated as it actually stands, not as it was planned.

- **App Runner** — the backend runs here, in `ap-south-1`, same region as the
  CockroachDB cluster. `/healthz` reports a ~7 ms database round trip; a
  serializable ledger reads *inside* the write, so crossing an ocean between
  the two would be felt on every request.
- **ECR Public** — hosts the container image App Runner serves
  (`public.ecr.aws/s5q3w4x0/knot-api`). Public rather than private for a
  specific reason, below.
- **ECR** — private repository, holds the same image.
- **CloudWatch Logs** — the application's structured JSON goes here; the first
  deployment failure was diagnosed by reading it.
- **SSM Parameter Store** — three `SecureString` parameters under `/knot/`.
- **IAM** — two App Runner service roles plus a `knot-deployer` user scoped to
  App Runner, ECR, SSM under `/knot/*`, and `PassRole` on exactly two roles.

Two account-level restrictions shaped that list, and both are worth stating
plainly because they are not code problems:

- **`iam:PassRole` is refused account-wide.** `CreateService` returns *"Account
  … is not authorized pass this role"* even with `PassRole` widened to `*`, the
  conventional role name, and the service-linked role present. A service built
  from a *public* image — needing no role — creates fine, which is what
  isolates the failure to `PassRole` rather than to App Runner. The consequence:
  the image is served from ECR Public, and secrets are runtime environment
  variables rather than the SSM `RuntimeEnvironmentSecrets` (which require an
  instance role). The SSM parameters exist and are ready for the day it clears.
- **Bedrock inference is not authorized on this account.** Implemented behind
  the same provider protocol as OpenAI — both emit 512-dimension embeddings, so
  the `VECTOR(512)` columns need no migration to switch — but it is not what
  runs. Re-tested 2026-08-15 with credits applied and a valid long-term API
  key: `get-foundation-model-availability` returns
  `authorizationStatus: NOT_AUTHORIZED` while `regionAvailability`,
  `entitlementAvailability` and `agreementAvailability` all read `AVAILABLE`,
  in `us-east-1`, `us-west-2` and `ap-south-1`. **This is not an Anthropic
  licensing issue**: Amazon Nova and Titan, Meta Llama, Mistral and DeepSeek
  all report `NOT_AUTHORIZED` with `agreementAvailability: AVAILABLE`, i.e. no
  provider agreement is even required and they are still blocked. The key
  authenticates — it is how `list_foundation_models` returns 122 models — so
  this is authorization, not authentication, and credits do not lift it.
  Inference runs on OpenAI; Bedrock stays one environment variable away.
- **S3** — `EXPORT_BUCKET` is wired in config but **not implemented**: CSV
  export streams inline. Not claimed as in use.

Teardown is a single script: `./scripts/aws-teardown.sh` (dry run by default,
`--yes` to apply) removes every resource above.

## Design system

Colours, spacing and type live as tokens in `frontend/src/app/globals.css`;
components never hardcode a palette value. `cd frontend && npm run check:tokens`
enforces that with seven grep gates.

## Status

🚧 Under active development for the hackathon (deadline Aug 18, 2026).

## License

Apache-2.0
