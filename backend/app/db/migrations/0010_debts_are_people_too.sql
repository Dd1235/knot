-- Borrowing created liability:<name> accounts with person_id NULL, and
-- person_balances filtered to receivables, so "who do I owe" had no answer.
INSERT INTO people (user_id, display_name)
SELECT DISTINCT a.user_id, initcap(split_part(a.name, ':', 2))
FROM accounts AS a
WHERE a.type = 'liability'
  AND a.person_id IS NULL
  AND a.name LIKE 'liability:%'
  AND split_part(a.name, ':', 3) = ''
  AND split_part(a.name, ':', 2) NOT IN ('loan', 'card', 'tax', 'opening')
  AND NOT EXISTS (
      SELECT 1 FROM people AS p
      WHERE p.user_id = a.user_id
        AND lower(p.display_name) = lower(split_part(a.name, ':', 2))
  );

UPDATE accounts AS a
SET person_id = p.id
FROM people AS p
WHERE a.person_id IS NULL
  AND a.type = 'liability'
  AND a.name LIKE 'liability:%'
  AND split_part(a.name, ':', 3) = ''
  AND p.user_id = a.user_id
  AND lower(p.display_name) = lower(split_part(a.name, ':', 2));

-- Same columns, so CREATE OR REPLACE works with no DROP window. The signs
-- compose: receivable +500 and liability -300 net to +200. A negative balance
-- means you owe them, which is exactly the question that was unanswerable.
CREATE OR REPLACE VIEW person_balances AS
SELECT
    a.user_id,
    a.person_id,
    p.display_name,
    sum(l.amount) AS balance
FROM accounts AS a
JOIN people AS p ON p.id = a.person_id
LEFT JOIN transaction_legs AS l ON l.account_id = a.id
WHERE a.type IN ('receivable', 'liability')
GROUP BY a.user_id, a.person_id, p.display_name;
