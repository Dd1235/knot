-- Working memory: chat sessions and raw conversation turns.
--
-- Raw turns are deliberately disposable — Row-Level TTL erases them after 30
-- days. Durable knowledge is distilled into session summaries and the
-- episodic/semantic stores (later migrations); the agent "forgets" verbatim
-- chatter the way a person does.

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status STRING NOT NULL DEFAULT 'active',
    running_summary STRING NOT NULL DEFAULT '',
    INDEX sessions_by_user (user_id, last_active_at DESC)
);

CREATE TABLE IF NOT EXISTS conversation_turns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions (id),
    seq INT NOT NULL,
    role STRING NOT NULL,
    content STRING NOT NULL,
    -- Tool activity of assistant turns: [{"tool", "args", "result_summary"}]
    tool_calls JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, seq)
) WITH (ttl_expire_after = '30 days', ttl_job_cron = '@daily');
