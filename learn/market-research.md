# Market Research — What Professional Finance Apps Offer (July 2026)

Sources: NerdWallet/Engadget 2026 budgeting app roundups, x1wealth Monarch-vs-Copilot,
EquityLogy + Finny Indian expense-tracker reviews, Jupiter/INDmoney/Fi product pages.

## The field

| App | Positioning | Signature features |
|---|---|---|
| **Monarch Money** ($8-17/mo) | Complete financial dashboard | Net worth, investments, goals, shared/couples budgets |
| **Copilot Money** ($8-13/mo) | AI + Apple polish | **Categorization that learns from your corrections**, recurring detection, beautiful reports |
| **YNAB** ($109/yr) | Methodology app | Zero-based budgeting ("give every dollar a job") |
| **Simplifi** ($4-7/mo) | Value pick | Spending watchlists, cashflow projection |
| **Jupiter** (IN) | Neobank + tracking | UPI-native auto tracking, **"Pots" goal buckets**, salary features |
| **INDmoney** (IN) | Multi-asset aggregator | **Net worth across stocks/MF/EPF/FD**, Account Aggregator framework |
| **Fi Money** (IN) | All-in-one banking | Auto expense tracking + rules ("FIT rules") |

Common paid-tier feature set: auto-categorization with learning, recurring/subscription
detection, budgets per category, goals, net worth, investment tracking, monthly reports,
CSV export, cashflow (income vs spend), bill reminders.

## How each maps to Knot (our advantages)

1. **Learning categorization** (Copilot's moat) — we already have it: procedural
   rules + semantic merchant facts, taught by voice ("chai wala means the tea
   stall"). Copilot needs taps; we need one sentence.
2. **Net worth** (Monarch/INDmoney) — free with double-entry: `SUM(assets) −
   SUM(liabilities)`, always consistent, never a synced snapshot. Needs: opening
   balances + income recording (roadmap #3).
3. **Investments** — model as asset accounts, no new machinery:
   - Buy: "put 10k in niftybees" → debit `asset:invest:etf` +10,000, credit `cash` −10,000.
   - Mark-to-market: "portfolio's at 1.2L now" → revaluation entry: debit
     `asset:invest:*` +Δ, credit `income:unrealized_gains` −Δ. Gains are visible
     but clearly separated from cashflow. Voice-first manual now; India's
     Account Aggregator / broker APIs (Zerodha Kite) are the automated path later.
4. **Recurring/subscriptions** — semantic `commitment` facts + detection from
   episodic repeats ("3rd Netflix ₹649 — track as subscription?"). Pro apps
   detect from bank feeds; we detect from memory, and can *prompt before* the
   charge ("Netflix renews tomorrow").
5. **Budgets/Pots** — YNAB-style zero-based is heavy; Jupiter-style pots are
   approachable. Knot take: monthly caps per **spending group** (essentials /
   discretionary / savings-investments / debt) with agent nudges, not hard locks.
6. **Reports** — deterministic SQL dashboards (daily/weekly/monthly trends,
   group split, category breakdown, receivables aging) + CSV export. AI never
   sits in the read path (roadmap #4).
7. **AI insights** (nobody does this well yet) — "eating out is 38% above your
   3-month norm", "two overlapping streaming subs", monthly retrospective.
   Generated from aggregates, stored as episodic `insight` events — so insights
   themselves become memory the agent can recall.

## Category taxonomy to adopt (professional standard, Indian flavor)

- **Essentials**: rent, groceries, utilities, transport, phone/internet, medical, education, EMI
- **Discretionary**: eating out, entertainment, shopping, subscriptions, travel, gifts
- **Savings & invest**: SIP/mutual funds, stocks, FD/RD, emergency fund
- **Income**: salary, freelance, interest, cashback, gifts received
- 50/30/20 as the default lens (needs/wants/savings), overridable per user.

## Voice back-and-forth (conversation UX)

Pro voice assistants converge on: continuous conversation mode (auto re-listen
after the assistant finishes), barge-in (interrupt while it speaks), visible
state (listening/thinking/speaking), and graceful exit on silence.
- **Now (Web Speech)**: hands-free loop — listen → send → stream → speak →
  auto re-listen; tap to interrupt; auto-exit after 2 silent rounds.
- **Later (Nova 2 Sonic)**: native bidirectional streaming gives real barge-in,
  sub-second turn-taking, Hindi/Hinglish, and async tool calling against the
  same registry.
