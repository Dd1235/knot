# Ledger extension design — shapes, direction-aware groups, holdings, loans

Design for Stage 3 of the Aug-18 plan. Written before implementation so the
double-entry invariant is decided once rather than defended five times.

The governing constraint: **`Σ legs == 0` is the one thing that must never
bend.** Every choice below is made so that new money shapes cannot reach the
invariant path at all — they choose *which* legs, never *whether* they balance.

---

## A. Leg shapes become data

New `backend/app/ledger/shapes.py`, in the **ledger** package rather than the
agent package — because `recurring.post_due` and `money_tools` must use it too.
That placement alone fixes the bug where `post_due` hardcodes `expense:` and
posts a recurring SIP as spending.

A shape declares its legs as `(role, sign, part)` templates. Roles resolve
through one function: `funding` → `req.account or "cash"` (so voice can say
"from HDFC"), `category` → `categories.account_for(...)`, plus `income`,
`receivable`, `liability`, `holding`, `loan`, `gain`, `interest`.

| shape | legs | new? |
|---|---|---|
| `spent` / split | `category +total`, `funding −total` (+ per-person shares) | |
| `received` | `funding +total`, `income −total` | |
| `lent` / `borrowed` | receivable / liability against funding | |
| `settled` | `funding +amt`, `receivable −amt` | |
| **`repaid`** | `liability +amt`, `funding −amt` | ✅ |
| **`bought`** | `holding +total`, `funding −total` | ✅ |
| **`sold`** | `funding +proceeds`, `holding −cost_relieved`, `gain −gain` | ✅ |
| **`dividend`** | `funding +total`, `income:dividends −total` | ✅ |
| **`refund`** | `funding +total`, `category −total` | ✅ |
| **`tax`** | `expense:tax_{kind} +total`, `funding −total` | ✅ |
| **`emi`** | `loan +principal`, `interest +interest`, `funding −(p+i)` | ✅ |
| `transfer` | generalises `withdraw_cash` | |

### The one architectural move that matters

`settle_up` reads the outstanding balance **inside the same serializable
transaction** that writes the legs. That read-in-transaction is the entire
write-skew defence demonstrated at `/demo/race`.

Rather than copy it for `repaid`, `sold` and `emi`, it becomes a generic
`resolve` hook: a shape may declare a coroutine that runs inside the posting
transaction and returns the computed parts. All four then inherit the guarantee,
and over-settlement / over-repayment / over-sale collapse into one guard with a
sign parameter. `service.settle_up()` stays as a thin wrapper so `/ledger/settle`,
`/demo/race` and the existing tests are untouched.

The tool's `direction` enum and its category hint are **generated from the
registry**, so adding a shape updates the model's contract with no edit. (The
hint currently lists 24 of 33 categories — the model cannot route to what it
cannot see.)

---

## B. Direction-aware groups — resolve from the account, not the category

**Chosen: resolve the group from the account type; `category_groups` demotes to
an expense-side-only taxonomy.** Zero schema change, zero backfill.

The ledger already knows the direction — `expense:rent` and `income:rent` are
different accounts with different types, chosen by the tool. Any stored
direction is a second copy of a fact the legs already carry, and it can
disagree with them.

*Rejected — a `(category, direction)` composite key:* needs `ALTER PRIMARY KEY`,
which in CockroachDB always leaves the old key behind as a unique secondary
index. That index would be unique on `category` alone and would reject the
second row for `('rent', 'in')` — exactly the 0006/0007 failure again.

*Rejected — separate names like `rental_income`:* pushes disambiguation to the
model at capture time, and when it guesses wrong the legs and the label agree
with each other and are both wrong.

```
grp(leg) =
  'income'          if account.type = 'income'
  'savings_invest'  if account.name LIKE 'invest:%'
  'debt'            if account.type = 'liability' and name <> 'equity:opening'
  'transfer'        if the txn moves only between asset accounts
  category_groups[category]   otherwise (expense legs only)
```

**`analytics.summary` needs no SQL change** — its `by_category` query already
pins `a.type = 'expense'`, so it is already on the correct side. The only defect
is data: `interest` is mapped to group `income`, so interest *paid* lands in the
income slice. One UPSERT fixes it.

**`service.recent_transactions` is the real change** — its `LEFT JOIN
category_groups ON cg.category = t.category` is direction-blind. The `direction`
CASE also grows from 5 branches to 12, ordered first-match-wins, which fixes two
display lies: `borrowed` currently falls through to **"spent"**, and so would any
refund. Put the expression in a `transaction_shape` view so
`recent_transactions`, `export_rows` and `rhythm` share one definition —
following the `person_balances` precedent of deriving rather than storing.

---

## C. Holdings — quantity on the leg, no lots table

`transaction_legs` gains nullable `quantity`, `unit_price`, `instrument_id`.
These are **annotations on the money leg**. The rupee `amount` stays the sole
authority and the sole participant in the zero-sum check.

This matters concretely: `amount = round(qty × price, 2)`, so `qty × price` will
sometimes miss `amount` by a paisa. If quantity were a second invariant that
residue would break the ledger. Because it isn't, no rounding ever can.

**Weighted-average cost, not FIFO lots.** FIFO needs a mutable `remaining_qty`
per lot — the stored-mutable-state this codebase avoids everywhere — plus row
locking on sale. Weighted average is computable from history alone:
`avg_cost = SUM(amount) / SUM(quantity)`. After a sale it is *unchanged*, which
is the mathematically correct property. The legs alone are a complete record of
both money and units, so nothing can drift. (Indian tax actually requires FIFO
with grandfathering — worth one honest sentence in the README rather than a lots
table that won't get finished.)

Accounts are named `invest:stocks:reliance` — still prefixed `invest`, so
`_account_type` returns `asset` unchanged and **every existing `LIKE 'invest:%'`
filter keeps matching**.

**Unrealised P&L never becomes legs.** No revaluation entries, so `ledger_sum`
stays zero. `summary` reports two figures: `net_worth` (at cost, existing tests
stay green) and `net_worth_market`. The delta *is* the interesting number.

Selling more units than held is rejected by the same read-in-transaction guard —
a second instance of the write-skew pattern, which strengthens the CockroachDB
story rather than merely reusing it.

Prices come from a `mark_price` tool ("reliance is at 1450 now"). No feed, no
scheduler, no key.

---

## D. Loans — own table, shared scheduler, no schedule

`recurring_commitments` describes a *fixed leg amount*; a loan's legs change
every month by construction. But the posting *mechanism* is identical, so
`loans` carries the same `last_posted_period` and `post_due()` iterates it as a
second source.

`emi` is **stored, not derived** — it is a contract term the bank fixed, and the
textbook formula will not reproduce their paisa rounding. `outstanding` is
**derived**: `−SUM(amount)` over the loan account's legs.

```
interest       = round(outstanding × annual_rate / 12 / 100, 2)
principal_part = min(emi, outstanding + interest) − interest
```

**Reducing-balance amortisation falls out for free**, because `outstanding` is
re-read from the ledger every period. There is no schedule table, because the
schedule is a *consequence* of the ledger rather than a stored artifact. The
`min()` lands the final payment exactly on zero.

**This is the biggest correctness win available.** Today an EMI books the whole
payment as an expense. In reality only the interest is spending; the principal
is a balance-sheet move. So the current model overstates monthly spend by the
principal portion — typically 60–80% of the payment — every single month.

---

## E. A sixth group: `debt`

`interest` paid has no honest home today. Once EMIs split, interest is a
distinct kind of money — the price of past consumption — that people reason
about separately from rent and groceries.

Only the **expense side** needs rows. Income-side categories (`dividends`,
`bonus`, `rental_income`, `capital_gains`) group by account type and need none.

`refund` is deliberately *not* a category: it is a shape that credits the
original category, so a ₹200 refund on ₹500 of groceries leaves groceries at
₹300. A refund income category would instead show ₹500 spent and ₹200 earned —
a worse description of the same event.

---

## F. Migrations

| # | File | Kind |
|---|---|---|
| 0009 | `direction_aware_groups.sql` | data only |
| 0010 | `liability_people.sql` | backfill + widen `person_balances` |
| 0011 | `instruments.sql` | additive; three columns in **one** ALTER |
| 0012 | `holdings_view.sql` | **separate file** — depends on 0011's async schema change |
| 0013 | `loans.sql` | additive |

**Nothing uses `ALTER PRIMARY KEY`.** That is deliberate, and it is the main
reason B chose account-resolution over a composite key.

`person_balances` keeps its column list byte-identical and only widens
`WHERE a.type = 'receivable'` to include liabilities, so `CREATE OR REPLACE`
succeeds with no DROP window. The signs then compose for free: receivable +500
and liability −300 net to +200. A person you only borrowed from surfaces as a
negative balance — which is precisely what makes "who do I owe" answerable.

### Legacy rows are not rewritten

Recurring SIPs already posted to `expense:sip` stay there. **Rewriting history
violates the principle the whole project rests on.** `analytics.summary` already
classifies them correctly as invested; only net worth is off. The
accounting-correct remedy is a one-time reclassification *transaction* per
account — `[invest:sip +X, expense:sip −X]` — which preserves the audit trail.
Optional, low priority.

Legacy `invest:stocks` cannot be backfilled into per-instrument accounts (the
share counts are unknown). It survives as an un-itemised bucket; the holdings
view's `HAVING SUM(quantity) IS NOT NULL` keeps it out while net worth still
counts the rupees. Surface it honestly as "₹X in un-itemised stocks".

---

## Build order

| # | Piece | Effort | Migration |
|---|---|---|---|
| 1 | Shape registry | 3–4h | none |
| 2 | Borrow/repay | 2–3h | 0010 |
| 3 | Direction-aware groups + categories | 2h | 0009 |
| 4 | Loans/EMI | 4–5h | 0013 |
| 5 | Instruments/holdings | 6–8h | 0011, 0012 |

~20h. **Cut order: 5, then 4.** Dropping holdings leaves a coherent product.
Dropping borrow/repay does not — `liability:` accounts stay write-only and "who
do I owe" stays unanswerable, which is the most obvious hole to poke.

## Tests

The one that makes "shapes are data" safe:
`test_shape_registry_every_shape_sums_to_zero`, **parametrised over the
registry** — so adding a shape automatically gets a zero-sum test and the
extension point can never be used to break the invariant.

Then: concurrent repayment and concurrent sale races (one commits),
`test_sale_preserves_average_cost`, `test_emi_principal_is_not_spend`,
`test_final_emi_lands_outstanding_exactly_on_zero`,
`test_rent_received_does_not_group_as_essentials`,
`test_interest_paid_is_not_income`, `test_borrowed_does_not_render_as_spent`,
`test_recurring_sip_posts_to_invest_not_expense`.
