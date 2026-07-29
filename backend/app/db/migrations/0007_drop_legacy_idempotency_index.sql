-- ALTER PRIMARY KEY keeps the previous key as a unique index, so `key` was
-- still globally unique and a second user reusing a key hit a constraint
-- violation instead of getting their own transaction recorded.

DROP INDEX IF EXISTS idempotency_keys@idempotency_keys_key_key CASCADE;
