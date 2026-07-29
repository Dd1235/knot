# Ledger — Product Roadmap

From the 2026-07-29 product review. Ordered by (hackathon judging value × effort).
Deadline: Aug 18. Items marked 🏁 are required for submission.

## Done

1. ~~**Latency**~~ — parallel assembly + SSE token streaming + live tool chips
   (first feedback 1.6–3.3s, measured).
2. ~~**Voice-first mode**~~ — hands-free loop (listen → think → speak →
   re-listen), tap-to-interrupt, auto-exit on silence. Web Speech now;
   Nova 2 Sonic upgrade when AWS verification clears.

## Next

3. **Money model depth** (what professional finance apps have):
   - Opening balance + income setup ("I have ₹40k in the bank, salary ₹60k on the 1st").
   - Category taxonomy with **spending groups**: essentials (rent, groceries,
     utilities, transport), discretionary (eating out, entertainment, shopping),
     savings/investments, debt. 50/30/20-style split views.
   - **Recurring commitments**: Netflix/Prime/AI subscriptions, rent, EMIs —
     stored as semantic `commitment` memories + a `recurring_rules` table; agent
     detects repeats ("3rd month of Netflix ₹649 — track it as a subscription?")
     and posts them automatically with user confirmation.
   - **Investments** (see market-research.md): buys as transfers into
     `asset:invest:*` accounts; mark-to-market via revaluation entries against
     `income:unrealized_gains`; net worth = assets − liabilities, always derived.
     Manual voice-first now; Account Aggregator / broker APIs post-hackathon.
4. **Dashboards (rule-based, no AI in the read path)** 🏁-adjacent:
   daily/weekly/monthly spend trends, category breakdown, group split,
   people/receivables aging. AI writes the states; dashboards are deterministic
   SQL. Excel/CSV export per period.
5. **AI insights** (separate from dashboards): "you spent 38% more on eating out
   than your monthly norm", "3 subscriptions overlap in streaming", "what could
   have been different" retrospectives. Generated from ledger aggregates fed to
   the LLM, cached as episodic `insight` events.

## Deployment track 🏁

6. **Auth**: real sign-in for the public URL (passcode is dev-only). Simplest
   robust option: magic-link or OTP-less email + signed session cookie; user_id
   scoping already exists everywhere.
7. **Deploy**: backend container (ECS Fargate) + Amplify frontend + public URL.
   Blocked on AWS account verification; non-AWS fallback acceptable since
   Bedrock Titan embeddings already satisfies the AWS requirement.

## Submission assets 🏁

8. Demo video (<3 min), ARCHITECTURE.md + diagram, crdb-tools-feedback.md,
   README tools-used section, Devpost form.
