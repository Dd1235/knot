-- Per-instrument investment tracking.
--
-- Until now every holding collapsed into one rupee bucket per category, so
-- RELIANCE and INFY were indistinguishable and a portfolio was a single number
-- valued at purchase cost forever.
--
-- quantity and unit_price are ANNOTATIONS on the money leg, never a second
-- source of truth. amount = round(qty * price, 2), so qty * price will
-- sometimes miss amount by a paisa; if quantity were an invariant that residue
-- would break the ledger. It is not, so no rounding ever can.
CREATE TABLE IF NOT EXISTS instruments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    symbol STRING NOT NULL,                 -- 'reliance', 'parag_flexi'
    display_name STRING NOT NULL DEFAULT '',
    kind STRING NOT NULL DEFAULT 'stocks',  -- stocks | mutual_funds | gold | crypto | bonds
    -- Stated by the user, never fetched. No feed, no key, no rate limit.
    last_price DECIMAL(18,4),
    last_price_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, symbol)
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS instrument_id UUID REFERENCES instruments (id);

-- One statement, not three: separate ALTERs on the same table in one implicit
-- transaction risk "table is undergoing another schema change".
-- DECIMAL(24,8) covers crypto satoshis and mutual-fund unit fractions alike.
ALTER TABLE transaction_legs
    ADD COLUMN IF NOT EXISTS quantity DECIMAL(24,8),
    ADD COLUMN IF NOT EXISTS unit_price DECIMAL(18,4),
    ADD COLUMN IF NOT EXISTS instrument_id UUID REFERENCES instruments (id);
