-- Separate file on purpose: this depends on columns added by 0013's async
-- schema change, and putting both in one implicit transaction is the biggest
-- ordering hazard in CockroachDB.
--
-- Mirrors person_balances: derived, never stored. Units and cost basis are
-- both plain SUMs over the legs, so the money and the units cannot drift apart
-- — there is only one record, and it is the ledger.
--
-- avg_cost is weighted-average, not FIFO. It is computable from history alone,
-- and after a sale it is mathematically unchanged, which is exactly the
-- property that makes a lots table unnecessary. (Indian tax wants FIFO with
-- grandfathering; that belongs in an export, not in the ledger.)
CREATE VIEW IF NOT EXISTS holdings AS
SELECT
    a.user_id,
    i.symbol,
    i.display_name,
    i.kind,
    SUM(l.quantity)                                 AS units,
    SUM(l.amount)                                   AS cost_basis,
    SUM(l.amount) / NULLIF(SUM(l.quantity), 0)      AS avg_cost,
    i.last_price,
    i.last_price_at,
    SUM(l.quantity) * i.last_price                  AS market_value,
    SUM(l.quantity) * i.last_price - SUM(l.amount)  AS unrealised
FROM accounts AS a
JOIN instruments AS i ON i.id = a.instrument_id
JOIN transaction_legs AS l ON l.account_id = a.id
GROUP BY a.user_id, i.symbol, i.display_name, i.kind, i.last_price, i.last_price_at
HAVING SUM(l.quantity) IS NOT NULL AND SUM(l.quantity) != 0;
