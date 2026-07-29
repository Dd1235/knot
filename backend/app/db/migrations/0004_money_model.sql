-- Money model: professional category taxonomy (spending groups) and
-- recurring commitments (subscriptions, rent, salary).
--
-- Groups follow the needs/wants/savings split every paid finance app uses:
--   essentials | discretionary | savings_invest | income  (unmapped -> other)

CREATE TABLE IF NOT EXISTS category_groups (
    category STRING PRIMARY KEY,
    grp STRING NOT NULL
);

UPSERT INTO category_groups (category, grp) VALUES
    ('rent', 'essentials'), ('groceries', 'essentials'), ('utilities', 'essentials'),
    ('transport', 'essentials'), ('phone', 'essentials'), ('internet', 'essentials'),
    ('medical', 'essentials'), ('education', 'essentials'), ('emi', 'essentials'),
    ('food', 'discretionary'), ('entertainment', 'discretionary'),
    ('shopping', 'discretionary'), ('subscriptions', 'discretionary'),
    ('travel', 'discretionary'), ('gifts', 'discretionary'), ('coffee', 'discretionary'),
    ('sip', 'savings_invest'), ('mutual_funds', 'savings_invest'),
    ('stocks', 'savings_invest'), ('fd', 'savings_invest'), ('savings', 'savings_invest'),
    ('salary', 'income'), ('freelance', 'income'), ('interest', 'income'),
    ('cashback', 'income');

-- One row per commitment; posting is idempotent per period via last_posted_period
-- (e.g. '2026-07' for monthly, '2026' for yearly).
CREATE TABLE IF NOT EXISTS recurring_commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    name STRING NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    cadence STRING NOT NULL DEFAULT 'monthly',  -- monthly | yearly
    due_day INT,                                -- day of month (monthly)
    category STRING NOT NULL DEFAULT 'subscriptions',
    direction STRING NOT NULL DEFAULT 'spent',  -- spent | received (salary)
    active BOOL NOT NULL DEFAULT true,
    last_posted_period STRING NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);
