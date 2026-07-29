-- Idempotency keys are supplied by the client, so they must be unique PER USER,
-- not globally. With a bare `key` primary key, user B posting with a key user A
-- already used either returned A's transaction or hit a uniqueness error — and
-- B's transaction was silently never written.

ALTER TABLE idempotency_keys ALTER PRIMARY KEY USING COLUMNS (user_id, key);
