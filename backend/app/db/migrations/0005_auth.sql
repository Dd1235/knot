-- Real accounts: email + password hash on the existing users table.
--
-- users.handle stays the internal scoping key every table already joins on,
-- so authentication slots in without touching the ledger or memory schema.
-- Rows created before auth (demo/test handles) simply have no email.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email STRING;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash STRING;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email)
    WHERE email IS NOT NULL;
