-- Ledger core: users, people, accounts, double-entry transactions.
--
-- Sign convention (standard double-entry, single-column amounts):
--   debits are positive, credits are negative; every transaction's legs sum to 0.
--   A positive balance on a 'receivable' account means the person owes the user.
-- The zero-sum invariant is enforced by the application inside the same
-- serializable transaction that inserts the legs (CockroachDB, like Postgres,
-- has no cross-row CHECK constraints).

CREATE TYPE IF NOT EXISTS account_type AS ENUM (
    'asset', 'liability', 'income', 'expense', 'receivable'
);

CREATE TYPE IF NOT EXISTS txn_source AS ENUM ('text', 'voice', 'system');

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle STRING NOT NULL UNIQUE,
    display_name STRING NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- People in the user's financial life ("Priya", "Arun", "landlord").
CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    display_name STRING NOT NULL,
    aliases STRING[] NOT NULL DEFAULT ARRAY[]::STRING[],
    notes STRING NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, display_name)
);

CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    name STRING NOT NULL,
    type account_type NOT NULL,
    -- Set for per-person receivable accounts; NULL otherwise.
    person_id UUID REFERENCES people (id),
    currency STRING NOT NULL DEFAULT 'INR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    description STRING NOT NULL,
    -- What the user actually said/typed; the agent's raw evidence.
    raw_input STRING NOT NULL DEFAULT '',
    source txn_source NOT NULL DEFAULT 'text',
    category STRING NOT NULL DEFAULT 'uncategorized',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX txns_by_user_time (user_id, occurred_at DESC)
);

CREATE TABLE IF NOT EXISTS transaction_legs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts (id),
    amount DECIMAL(14,2) NOT NULL CHECK (amount != 0),
    memo STRING NOT NULL DEFAULT '',
    INDEX legs_by_account (account_id, transaction_id)
);

-- Client retry dedup; rows expire automatically via Row-Level TTL.
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key STRING PRIMARY KEY,
    user_id UUID NOT NULL,
    transaction_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
) WITH (ttl_expire_after = '7 days', ttl_job_cron = '@hourly');

-- Live per-person balances, always derived from legs, never stored.
CREATE VIEW IF NOT EXISTS person_balances AS
SELECT
    a.user_id,
    a.person_id,
    p.display_name,
    sum(l.amount) AS balance
FROM accounts AS a
JOIN people AS p ON p.id = a.person_id
LEFT JOIN transaction_legs AS l ON l.account_id = a.id
WHERE a.type = 'receivable'
GROUP BY a.user_id, a.person_id, p.display_name;
