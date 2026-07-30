-- Monthly caps, opt-in and per-scope.
--
-- Not a budget in the YNAB sense: nothing is allocated up front and nothing is
-- blocked. A limit is a line the user drew, and the only thing the app does
-- with it is compare pace against it. Budgeting apps lose ~67% of users inside
-- 30 days, and asking someone to plan every rupee before they can use the
-- product is how that happens.
CREATE TABLE IF NOT EXISTS spend_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    -- 'total' | 'group' | 'category'
    scope STRING NOT NULL,
    -- '' for total; otherwise the group or category name
    target STRING NOT NULL DEFAULT '',
    amount DECIMAL(14,2) NOT NULL,
    active BOOL NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, scope, target)
);
