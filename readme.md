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

## Stack

- **Backend**: Python / FastAPI, psycopg3 + raw SQL (serializable transactions, explicit retries)
- **Database**: CockroachDB Cloud (ap-south-1) — `VECTOR` + vector indexes, Row-Level TTL, JSONB
- **Models**: plug-and-play providers — OpenAI (free dev mode) or Amazon Bedrock (Claude / Nova / Titan)
- **Voice**: Amazon Nova 2 Sonic (bidirectional streaming), text-first fallback
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

**AWS** — Amazon Bedrock (Titan embeddings, Nova chat, Nova Sonic voice) behind
a swappable provider protocol; App Runner + S3 + CloudWatch for deployment.

## Design system

Colours, spacing and type live as tokens in `frontend/src/app/globals.css`;
components never hardcode a palette value. `cd frontend && npm run check:tokens`
enforces that with seven grep gates.

## Status

🚧 Under active development for the hackathon (deadline Aug 18, 2026).

## License

Apache-2.0
