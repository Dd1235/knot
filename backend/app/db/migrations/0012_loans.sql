-- An EMI is not spending. Only the interest is an expense; the principal is a
-- balance-sheet move that shrinks a debt. Booking the whole payment as spend
-- overstates monthly spending by the principal share -- typically 60-80% of
-- the payment -- and hides the net-worth improvement, every single month.
--
-- emi is stored rather than derived: it is a contract term the bank fixed, and
-- the textbook formula will not reproduce their paisa rounding. outstanding is
-- derived from the ledger, so the amortisation schedule is a consequence of
-- the entries rather than a table that can disagree with them.
CREATE TABLE IF NOT EXISTS loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    name STRING NOT NULL,
    lender STRING NOT NULL DEFAULT '',
    principal DECIMAL(14,2) NOT NULL,
    annual_rate DECIMAL(6,3) NOT NULL,
    tenure_months INT NOT NULL,
    emi DECIMAL(14,2) NOT NULL,
    started_on DATE NOT NULL DEFAULT current_date(),
    due_day INT NOT NULL DEFAULT 5,
    account_name STRING NOT NULL,
    active BOOL NOT NULL DEFAULT true,
    last_posted_period STRING NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);
