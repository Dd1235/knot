-- Long-term memory stores: episodic (what happened), semantic (facts),
-- procedural (how to do things) — plus the agent action audit log.
-- Each store has its own retrieval logic; all share one CockroachDB cluster.
-- Vector indexes are prefixed by user_id so similarity search is always
-- scoped to one user's memory.

CREATE TABLE IF NOT EXISTS episodic_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    kind STRING NOT NULL,  -- txn | settlement | session_summary | correction
    ref_transaction_id UUID,
    session_id UUID,
    summary STRING NOT NULL,
    embedding VECTOR(512) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX episodic_by_user_time (user_id, occurred_at DESC)
);

CREATE VECTOR INDEX IF NOT EXISTS episodic_embedding_idx
    ON episodic_events (user_id, embedding);

CREATE TABLE IF NOT EXISTS semantic_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    kind STRING NOT NULL,  -- person | merchant | habit | preference | commitment
    subject STRING NOT NULL DEFAULT '',
    fact STRING NOT NULL,
    structured JSONB NOT NULL DEFAULT '{}',
    embedding VECTOR(512) NOT NULL,
    confidence FLOAT NOT NULL DEFAULT 0.7,
    evidence_count INT NOT NULL DEFAULT 1,
    last_reinforced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Contradicted facts are superseded, never deleted: the memory keeps its
    -- own history, and the inspector can show how a belief evolved.
    superseded_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX semantic_by_user (user_id, kind)
);

CREATE VECTOR INDEX IF NOT EXISTS semantic_embedding_idx
    ON semantic_facts (user_id, embedding);

CREATE TABLE IF NOT EXISTS procedural_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    kind STRING NOT NULL,  -- alias | split | categorization | phrasing | other
    trigger_text STRING NOT NULL,
    trigger_embedding VECTOR(512) NOT NULL,
    rule JSONB NOT NULL,  -- {"instruction": "...", ...}
    priority INT NOT NULL DEFAULT 0,
    usage_count INT NOT NULL DEFAULT 0,
    source STRING NOT NULL DEFAULT 'user',  -- user | inferred
    active BOOL NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX procedural_by_user (user_id, active)
);

CREATE VECTOR INDEX IF NOT EXISTS procedural_trigger_idx
    ON procedural_rules (user_id, trigger_embedding);

-- Every tool dispatch, for observability and the memory inspector timeline.
CREATE TABLE IF NOT EXISTS agent_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID,
    tool STRING NOT NULL,
    args JSONB NOT NULL DEFAULT '{}',
    result_summary STRING NOT NULL DEFAULT '',
    error STRING,
    latency_ms INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX actions_by_session (session_id, created_at DESC)
) WITH (ttl_expire_after = '90 days', ttl_job_cron = '@daily');

-- What memory was injected into each assistant turn (for the inspector's
-- "why did the agent say this?" trace).
ALTER TABLE conversation_turns ADD COLUMN IF NOT EXISTS context_trace JSONB;
