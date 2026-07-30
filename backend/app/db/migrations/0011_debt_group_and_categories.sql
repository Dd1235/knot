-- Two rows were actively wrong.
--
-- 'interest' sat in the income group, so interest PAID on a loan appeared
-- inside the income slice of a spending breakdown.
-- 'emi' sat in essentials, next to groceries, which hides debt service.
UPSERT INTO category_groups (category, grp) VALUES
    ('interest', 'debt'),
    ('emi', 'debt'),
    ('loan_interest', 'debt');

-- Expense-side gaps. Income-side categories (dividends, bonus, rental_income,
-- capital_gains) need no rows: they group by account type, so a single flat
-- category string never has to serve both an inflow and an outflow.
UPSERT INTO category_groups (category, grp) VALUES
    ('insurance', 'essentials'),
    ('fees', 'essentials'),
    ('tax_income', 'essentials'),
    ('tax_tds', 'essentials'),
    ('tax_advance', 'essentials'),
    ('tax_capital_gains', 'essentials'),
    ('charity', 'discretionary'),
    ('pets', 'discretionary'),
    ('fuel', 'essentials'),
    ('childcare', 'essentials');

-- These were reaching analytics as 'other' because nothing mapped them.
UPSERT INTO category_groups (category, grp) VALUES
    ('settlement', 'transfer'),
    ('repayment', 'transfer'),
    ('loan', 'transfer'),
    ('general', 'other'),
    ('uncategorized', 'other'),
    ('reversal', 'transfer');
