-- Indian savers use instruments the original taxonomy missed. Without these
-- rows an NPS or PPF contribution falls into 'other' and gets counted as
-- discretionary spending, which is the opposite of what it is.
UPSERT INTO category_groups (category, grp) VALUES
    ('rd', 'savings_invest'), ('nps', 'savings_invest'),
    ('ppf', 'savings_invest'), ('elss', 'savings_invest'),
    ('gold', 'savings_invest'), ('crypto', 'savings_invest'),
    ('bonds', 'savings_invest'),
    -- Withdrawing cash is a transfer between accounts, never spending.
    ('withdrawal', 'transfer'), ('opening_balance', 'transfer');
