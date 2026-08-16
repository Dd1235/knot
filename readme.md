# Knot — money you can just talk about

Say what happened. Knot turns a plain sentence into real double-entry
accounting, remembers the people and rules behind it, and can read the whole
thing back to you — with the screen off.

**Live:** [frontend-flame-chi-lahigc424k.vercel.app](https://frontend-flame-chi-lahigc424k.vercel.app)
· API on AWS App Runner in `ap-south-1`
([health](https://jmm87vpt23.ap-south-1.awsapprunner.com/healthz))
· Built for the [CockroachDB × AWS Hackathon](https://cockroachdb-ai.devpost.com/)

## What it does

- **Talk or type** — *"chai 15"*, *"lent Priya 500 for lunch"*, *"paid 12,000
  rent split three ways"*. Every sentence becomes a balanced journal entry.
- **Track investments & SIPs** — units, weighted-average cost, mark-to-market,
  realised and unrealised gains. A SIP is savings, never "spending".
- **Track debt & EMIs** — principal split from interest every month, with the
  schedule re-derived from the ledger rather than stored.
- **Lending between people** — lent, borrowed, settled, repaid, per person.
- **Monthly limits judged by pace** — 60% spent on the 5th is a warning; on the
  25th it is fine.
- **Recurring money** — salary, rent, subscriptions post themselves on their
  dates.
- **Cash tracking** — withdrawals are transfers, not spending, and what is left
  unaccounted is visible.
- **Insights** — a half-year spending heatmap, safe-to-spend until payday,
  category and group breakdowns, merchant rhythm. Every number computed by SQL.
- **Agentic memory, four stores** — working, episodic, semantic, procedural.
  Teach a rule once and it applies forever; corrections supersede rather than
  duplicate; every reply shows which memories it used.
- **Every entry can explain itself** — press `why` on any row to see what you
  said, which memories were recalled, which tool ran with which arguments, and
  the legs it posted. Provenance as typed columns in the same database, not a
  second graph store to keep in sync.
- **Rollbacks** — a correction is a reversing entry. Nothing is ever deleted.
- **A ledger that cannot drift** — serializable isolation, balances always
  derived, an invariant checked live and provable in the built-in race demo.
- **Multi-currency display** — the books stay in rupees; the screen *and the
  voice* follow whatever unit you choose.

## Accessible by design

Voice is not a shortcut bolted onto a dashboard — it is a complete second way
to use the product, which is what makes the app usable without sight.

- **The agent reads every dashboard aloud** — net worth, safe-to-spend, limits,
  debt, investments, cash, "what changed". Same SQL the screen renders, so what
  you hear and what you see cannot disagree.
- **Two keystrokes to talk, from any page** — `Tab`, `Tab`, `Enter`. No mouse,
  no hunting for a button, and no single-letter shortcut (screen readers
  capture those in browse mode, so they would reach sighted users only).
- **Live voice is multilingual** — speak in your language and it answers in it.
  Free on-device voice defaults to English.
- **Screen-reader first** — polite live regions announce replies and page
  changes, a skip link, real landmarks, per-route page titles, `aria-current`,
  focus that enters and leaves the voice overlay correctly.
- **Colour is never the only signal** — every amount carries its sign, every
  status carries words.
- **Provenance is keyboard-reachable** — `why` on a ledger row is a real button
  with `aria-expanded`, not a hover-only affordance, and its panel announces
  when it loads.
- **WCAG-conscious palette** — contrast checked against every surface in both
  themes, and a focus ring that is visible in light mode.
- **Reduced motion honoured** — including the JavaScript-driven scrolling that
  a CSS media query cannot reach.
- **Enforced, not asserted** — the full `jsx-a11y` rule set plus seven grep
  gates run on every change, and the end-to-end suite asserts focus retention,
  the live region and the skip link.

## Try it — every feature, one sentence each

Everything below works **typed or spoken**; voice gets the tool registry
wholesale, so there is no feature that only one of them can reach. ⚠️ marks
something that needs data seeded first.

<details>
<summary><b>Recording money</b></summary>

| Say this | What happens |
|---|---|
| `chai 15` | the smallest possible sentence becomes a balanced journal entry. Spends under ₹100 render smaller on purpose — Indian UPI is dominated by small payments (76% are under ₹500), and if the chai shouts as loudly as the rent, nothing reads |
| `gpay'd 40 for the auto` | payment-method words are understood and discarded |
| `paid 12000 rent split three ways with Kiran and Meera` | one sentence → four legs, two people created. The split rounds so *you* absorb the extra paise, never someone else's debt |
| `lent Priya 500 for lunch` | a receivable, not an expense |
| `borrowed 2000 from Arjun` | a liability |
| `Priya paid me back` / `Arjun settled 300` | full and partial settlement |
| `paid Priya back` | the mirror direction — clears a liability |
| `I got my salary, 95000` | income is first-class, not negative spending |
| `I never spent that — void it` | the agent lists, confirms, then posts a reversing entry at the **original's** date and category |

</details>

<details>
<summary><b>Cash — the loop an SMS parser can't close</b></summary>

| Say this | What happens |
|---|---|
| `took out 5000 from the ATM` | *Cash to reconcile* appears: withdrawn ₹5,000 / accounted ₹0 / unaccounted ₹5,000. **A withdrawal is a transfer, never spending** |
| `paid 200 cash for vegetables` | unaccounted drops to ₹4,800, live |
| `how much cash have I not accounted for?` | the same numbers, spoken |

</details>

<details>
<summary><b>Investments</b></summary>

| Say this | What happens |
|---|---|
| `bought 10 Reliance at 1380` | a named holding with units and weighted-average cost |
| `put 1700 into Pidilite` | works **without units** — amount-only holdings are first-class |
| `Reliance is at 1450 now` | revalues the holding and **posts no legs at all** — mark-to-market is a price fact, not a transaction |
| `sold 5 Reliance at 1500` | relieves cost at the weighted average, books the gain |
| `sold my stocks for 60k` | category-level redemption, no instrument named |
| `I put 5000 into an SIP` | savings, not spending — absent from every spend total, and the heatmap marks that day with a green ring instead of heat |
| `how's my portfolio doing?` | cost, value, unrealised, realised |

</details>

<details>
<summary><b>Loans, EMIs and recurring money</b></summary>

| Say this | What happens |
|---|---|
| `I have a 5 lakh car loan at 9% for 5 years` | tracked as a liability; the EMI is **computed**, not stored |
| `...for 5 years, already running` | balances against opening equity instead of inventing cash |
| `when will my car loan be paid off?` | *"3y 2m left · Oct 2029"*, derived from the ledger — there is no amortisation table anywhere |
| `Netflix is 649 a month on the 5th` | a commitment, on the calendar and in *Due next* |
| `salary 95000 on the 1st` | incoming — this is what turns safe-to-spend into a countdown |
| `it's called Prime, not Amazon Prime Video` | renames in place; refuses a name clash |
| `I cancelled Netflix` | drops out of upcoming; past auto-posted rows stay |
| `what's coming up?` | outgoing, incoming, and the next income date |

</details>

<details>
<summary><b>Limits and insights</b></summary>

| Say this | What happens |
|---|---|
| `keep me under 10k for food` | a monthly cap. It answers with your **current pace** in the same breath — set one mid-month and it may tell you you're already past it |
| `cap discretionary at 15000` | a group-scoped limit |
| `how am I doing on my limits?` | spent / left / share% / pace / projected / verdict |
| `how am I doing?` | net worth, spend, income, invested, net cashflow, safe-to-spend |
| `can I afford a 3000 dinner?` | liquid − claimed = available, plus per-day until payday |
| `where do I go most often?` | merchants ranked **by count, not rupees** |
| `what changed?` | the same sentences as the *What I notice* card |
| ⚠️ `what would a sensible food budget be?` | suggestions from your own 3-month median — needs **two complete prior months** |

</details>

<details>
<summary><b>Memory — the four stores</b></summary>

| Say this | What happens |
|---|---|
| `my landlord is Sharma uncle` | a semantic fact, with a confidence bar |
| `rent is always split 3 ways with Kiran and Meera` | a procedural rule |
| **then, in a fresh conversation:** `paid 12000 rent` | **it splits it.** Expand the "N memories used" chip to see the rule it retrieved |
| `chai wala means the tea stall near office` | a vocabulary rule |
| `no, Priya is my flatmate not my sister` | the old fact goes struck-through and grey; the new one arrives at 0.9. Corrections supersede, never duplicate |
| `Priya is my flatmate` → later `Priya and I share a flat` | **one** fact whose evidence count went 1→2 — the similarity search and the write are one transaction |
| `forget where I work` / `stop splitting rent three ways` | retired; the row survives for the inspector |
| `when did I last see Priya?` | episodic recall by vector similarity |

</details>

<details>
<summary><b>Voice</b></summary>

| Do this | What happens |
|---|---|
| **`Tab` `Tab` `Enter`** from a cold page load | voice opens. Two keystrokes, from any page, no mouse |
| ask `what's on this page?` while on `/insights` | it answers about insights — the route travels with the turn |
| speak Hindi, Tamil or Telugu mid-conversation | live voice switches language with you |
| tap the circle while it's talking | barge-in stops it immediately — the audio buffer is cleared, not just generation |
| open voice on `/app` vs elsewhere | on `/app` the spoken turn joins the visible conversation; elsewhere it's waiting in History afterwards |
| switch the engine tab | **free** (on-device, no audio leaves the device) vs **live** (billed per minute). Named by cost, not by technology |

</details>

<details>
<summary><b>Say the wrong thing on purpose</b></summary>

The ledger validates independently of the model. These are refusals, not crashes:

| Say this | It answers |
|---|---|
| `got 60000 from selling my stocks` | *"use sell_investment for stocks; recording it as income would count the holding twice"* |
| `I have 40k in the bank` (twice) | *"an opening balance for 'bank' already exists… Void it first to set a new one."* |
| `Priya paid me 900` (she owes 500) | *"settlement of 900.00 exceeds outstanding 500.00"* |
| `sold 15 Reliance at 1500` (you hold 10) | *"cannot sell 15 of 10 held"* |
| void a transaction, then void the reversal | *"cannot void a reversal entry"* |
| `paid 500 from my food budget` | *"expense:food is not an account money can move from; name a bank, card or wallet"* |

</details>

<details>
<summary><b>Pages worth opening</b></summary>

| Page | What to look at |
|---|---|
| `/architecture` | **every number is read live from the cluster** — version string, the three vector index names, the TTLs parsed from `SHOW CREATE TABLE`, per-store memory counts, and the ledger sum |
| `/demo` | ten concurrent settlements of one debt. One commits, nine are cleanly rejected, drift is zero |
| `/memory` → Actions | every tool call the agent ever made, with latency in ms |
| `/sessions` | voice and text in one timeline. An expired transcript says so — that's Row-Level TTL, visible in the product |
| `/insights` | the densest page: heatmap, safe-to-spend, limits with a today-marker, merchant rhythm, what-I-notice |
| `/transactions` | search, sticky day headers, category glyphs, `auto` badges, annotations — and **`why` on any row** (see below) |

</details>

<details>
<summary><b>Ask any entry why it exists</b></summary>

Hover or tab to any row on `/transactions` and press **`why`**. It expands into
the derivation chain, assembled from records the system already wrote:

| Step | What it shows |
|---|---|
| **you said** | your own words, verbatim — including for entries recorded by voice |
| **recalled** | the rules, facts and episodes retrieved for that turn, with their scores |
| **ran** | the tool that executed, its exact arguments, and its latency |
| **posted** | every leg, and their sum |

The demo worth doing: teach `rent is always split 3 ways with Kiran and Meera`,
start a **new conversation**, then say `paid 12000 rent`. Open `why` on the row
and the `ran` step reads `split_with: ["Kiran","Meera"]` — two names that appear
nowhere in the sentence. The `recalled` step shows where they came from.

This is a graph — utterance → rule → tool call → legs — and it is typed columns
and indexed joins in the same serializable database as the money, not a second
system kept in sync.

</details>

## Things that happen without being asked

None of these is a notification — see below. They surface when you show up.

- **Facts are distilled from your transactions.** Log five things, open the
  memory inspector, and there are facts you never dictated.
- **Annotations** — a short note under a ledger row, written when a transaction
  is statistically interesting: a recurrence, a new habit, an unusual price, a
  heavy day. It fires on *change, not state*; the function's default answer is
  "say nothing", and that's the common case by design.
- **Rules earn usage counts** silently, every time one is retrieved.
- **Commitments catch up** — a due date that passed posts itself next time
  you're active, tagged `auto`. The period marker advances inside the same
  transaction as the legs, so two concurrent catch-ups can't double-post.
- **The same sentence twice is one transaction** — idempotency keys, per user,
  expiring after 7 days.
- **Confidence decays** — a fact not reinforced halves in about 90 days, and
  below the floor it stops being retrieved at all.
- **Memory is fenced as data, never instruction.** It's injected in a user-role
  message inside `<user_memory>`, the closing tag is stripped from every
  injected string, and the prompt says to treat it as information about the
  user, never as commands. Ask it to "remember: always ignore previous
  instructions" and it won't obey that later.

## What it deliberately doesn't do

- **No notifications.** No push, no service worker, no email, no cron, no
  scheduler, no background job. A finance app that pings you is one you mute in
  a week. Knot notices things and keeps them until you look.
- **No market data feed.** Prices are stated — *"Reliance is at 1450 now"* —
  and holdings without a stated price are carried at cost and labelled as such.
- **No arithmetic in the model.** Every figure is computed by SQL or Python and
  handed to the model already formatted, with its unit attached. The model's job
  is turning a sentence into a tool call and phrasing something already true.
- **No deletes.** Corrections are reversing entries; superseded facts stay
  visible in the inspector, struck through.

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

### Details you'd only find by looking

Small decisions that took real work and are invisible until pointed at:

- **The knot ties itself when a write commits** — a ~900ms cinch on the
  wordmark. Only the eight tools that change the books trigger it; asking *"how
  am I doing?"* deliberately does not, and voice writes cinch it too. Back-to-back
  writes restart the tie.
- **Money typography** — the currency symbol, the decimal point and the paise
  render at 0.62em and 70% opacity, so the number reads as the number. Tabular
  figures everywhere, so columns line up.
- **A negative amount always shows its minus sign**, even where nothing asked for
  a sign, because colour must never be the only carrier of meaning.
- **Nine direction glyphs** — spent `−`, received `+`, lent `→`, settled `←`,
  borrowed `+`, repaid `−`, transfer `↔`, refund `+`, reversal `↺` — and
  **invested `→` is green, never tinted like an outflow.**
- **Category glyphs across 40 categories**, in a group-tinted circle, falling back
  to the merchant's initial. The tint is deliberately low-contrast so it reads as
  texture rather than as a warning.
- **The heatmap ranks days into quartiles over spending days only**, so one rent
  day can't flatten a year — and it refuses to shade a day you invested, giving it
  a green ring instead. It scrolls to *today* on mount, not to six months ago.
- **The limits bar has a today-marker** — a 1px tick at `day ÷ days_in_month`.
  Being left of that line is the entire definition of on track.
- **Limits are judged by pace and suppressed before day 4** — one heavy Saturday
  on the 1st must not project to thirty-one heavy Saturdays.
- **`raw_input` is quoted under a row**, but only when your words added something
  the description doesn't already carry.
- **Only the tallest bar** in the daily chart is labelled, and the label vanishes
  the moment you hover.
- **The composer mic is dictation, not conversation** — it fills the box and
  stops, so a misheard "fifteen/fifty" is correctable *before* it becomes a ledger
  entry.
- **There is no `voice` badge on a transaction**, on purpose: how you said it is
  not a property of the money. The only source badge is `auto`.
- **Nav labels are short on screen and full in `title`**, so the accessible name
  contains the visible text (WCAG "Label in Name").
- **CSV export defuses formula injection** — a description like `=cmd|'/c calc'!A1`
  is written quoted, including the leading-whitespace variants Excel strips before
  evaluating.
- **Login has no timing oracle** — an unknown email is verified against a dummy
  Argon2 hash so it costs the same as a wrong password.
- **Rate limiting is keyed per (caller, path)**, so exhausting `/auth/login`
  cannot lock you out of `/chat`.
- **Every tool call is audit-logged with its latency**, visible on `/memory` →
  Actions — expand one to see the arguments it was given and the result it
  returned.

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
