-- Link a tool call to the transaction it produced.
--
-- agent_actions already stored the whole result as result_summary, and for a
-- write that JSON begins with transaction_id — so the link was technically
-- recoverable by string-parsing a value we deliberately truncate at 400 chars.
-- That is not a join, it is a guess that happens to work. One nullable column
-- makes "why does this transaction exist?" an indexed lookup instead.
--
-- Nullable on purpose: read tools produce no transaction, and every row written
-- before this migration has no way to know its own answer.

ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS transaction_id UUID;

-- The provenance view looks up by transaction, never by action.
CREATE INDEX IF NOT EXISTS actions_by_transaction
    ON agent_actions (transaction_id) WHERE transaction_id IS NOT NULL;
