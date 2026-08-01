-- An instrument bought as a rupee amount ("bought Pidilite for 1700") has a
-- name and a cost basis but no units. The original HAVING required units, so
-- those holdings vanished from the portfolio entirely and reappeared only as
-- one anonymous "not itemised" total — which read as the page being broken.
--
-- Units now gate only the per-unit figures. Cost basis is always real.
CREATE OR REPLACE VIEW holdings AS
SELECT
    a.user_id,
    i.symbol,
    i.display_name,
    i.kind,
    SUM(l.quantity)                                 AS units,
    SUM(l.amount)                                   AS cost_basis,
    CASE WHEN COALESCE(SUM(l.quantity), 0) != 0
         THEN SUM(l.amount) / SUM(l.quantity) END   AS avg_cost,
    i.last_price,
    i.last_price_at,
    CASE WHEN COALESCE(SUM(l.quantity), 0) != 0
         THEN SUM(l.quantity) * i.last_price END    AS market_value,
    CASE WHEN COALESCE(SUM(l.quantity), 0) != 0
         THEN SUM(l.quantity) * i.last_price - SUM(l.amount) END AS unrealised
FROM accounts AS a
JOIN instruments AS i ON i.id = a.instrument_id
JOIN transaction_legs AS l ON l.account_id = a.id
GROUP BY a.user_id, i.symbol, i.display_name, i.kind, i.last_price, i.last_price_at
HAVING SUM(l.amount) != 0;
