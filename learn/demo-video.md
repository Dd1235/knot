# Demo video — storyboard, script, production

> **There are two videos.** This file's main storyboard is the ≤3-min
> **hackathon submission demo** (made later, voice mode demonstrated
> properly). The **landing-page advert** — ~40s, beat-cut, captions-first so
> it works muted, both themes with the theme flip as a transition — is
> produced by `scratch/video/` (gitignored): `shots/shots.mjs` captures,
> `assemble.py` cuts. Draft: `scratch/video/out/knot-advert-draft.mp4` with a
> scratch VO. Outstanding for the final advert: real VO (`assets/vo.m4a`),
> a ~110 BPM music track (`assets/music.mp3`), a re-shoot of the limits card
> once the month is ≥4 days old (pace verdicts are gated before that), and a
> re-shoot of shot 03 holding long enough to expand the "memories used" trace.

Target: **2:45** (hard cap 3:00 per the rules). Judged on five equal criteria:
agentic memory design, technical implementation, real-world impact, production
readiness, creativity. The rules explicitly require the video to show **"the
CockroachDB memory layer at work"** — so the memory act is the centrepiece,
told as a feature ("teach it once"), not as a diagram.

Naming discipline: CockroachDB by name where a database term earns it
(~3 mentions). AWS once, at the close. The model is "the model" / "the LLM";
voice is "the voice model". No other company names spoken.

## The shape

One person's money, one continuous story, all screen-real. Six acts:

| # | Act | Time | Judging box it ticks |
|---|-----|------|----------------------|
| 1 | Cold open — say it, it's booked | 0:00–0:12 | hook |
| 2 | Rapid-fire bookkeeping | 0:12–0:40 | real-world impact |
| 3 | **Memory** — teach once, corrected once | 0:40–1:12 | agentic memory (required) |
| 4 | Insights, limits, heatmap | 1:12–1:40 | impact + creativity |
| 5 | Depth — investments, EMI, debts, rollback | 1:40–2:08 | impact + technical |
| 6 | The race + close | 2:08–2:45 | technical + production readiness |

## Shot list + narration script

Narration is written to be read at a calm pace (~140 wpm). Finance and
database vocabulary is deliberate and load-bearing.

### Act 1 — cold open (0:00–0:12)
- **Shot**: dark theme, empty chat, composer focused. Typing: `lent Priya 500
  for lunch` → send → streaming reply, `recorded` badge appears. Speed-ramp the
  typing 2×.
- **VO**: *"This is Knot. You say what happened — and it's booked. A balanced,
  double-entry journal entry, committed in one serializable transaction."*
- Title card flashes after the badge: **Knot — money you can just talk about.** (1.5s)

### Act 2 — rapid-fire (0:12–0:40)
- **Shots** (quick cuts, ~4s each, caption bottom-left in the app's own label
  style): `chai 15` → auto-categorised chip; `salary 95000 on the 1st every
  month` → recurring income; `bought 10 Reliance at 1380` → cost basis;
  `I have a 5 lakh car loan at 9% for 5 years` → liability + EMI.
- **Captions**: *auto-categorised · recurring income · cost basis · amortisation*
- **VO**: *"Chai from a stall, salary on the first, ten shares of Reliance, a
  five-lakh car loan. Everything lands classified — essentials, discretionary,
  savings — and every debit meets its credit. The model never invents a number;
  it files entries, and SQL does the accounting."*

### Act 3 — memory, the centrepiece (0:40–1:12)
- **Shot A**: `remember: rent is split 3 ways with Kiran and Meera` → `rule
  saved` badge.
- **Shot B**: `paid 12000 rent` → reply shows the three-way split, **"2 memories
  used"** chip → click it → the trace expands showing the recalled rule.
  **Zoom in on the trace.** This is the money shot of the whole video.
- **Shot C**: `no, Priya is my flatmate not my sister` → memory inspector page,
  the old fact superseded, the new one with its confidence bar.
- **VO**: *"Here's the part that makes it an agent and not a chatbot. Teach it a
  rule once — next month it just applies it, and shows you exactly which
  memories it used. Correct it once, and the old fact is superseded, never
  duplicated. Four memory stores — working, episodic, semantic, procedural —
  live in CockroachDB next to the money, and recall is a vector similarity
  search over a distributed vector index. In SQL. In the same database."*

### Act 4 — insights (1:12–1:40)
- **Shots**: insights page scroll — the half-year **heatmap** (pan across it),
  safe-to-spend card, "what I notice" (eating out up 237%), then `keep me under
  10k for food` → limits card showing **pace** colouring running hot.
- **VO**: *"Half a year of spending as a heatmap — investment days marked apart,
  because a SIP isn't a splurge. Safe-to-spend until payday. Limits judged by
  pace against the calendar: sixty percent spent on the tenth is a warning;
  on the twenty-fifth it's fine. Every number here is computed by SQL — the
  model only phrases what is already true."*

### Act 5 — depth (1:40–2:08)
- **Shots**: portfolio page → `Reliance is at 1450 now` → unrealized gain
  updates (mark-to-market); debts page chips (receivables); EMI card splitting
  principal from interest; then back to chat: `void that chai` → reversal
  entry appears in the ledger, struck through.
- **VO**: *"Mark the market by voice and unrealized gains stay apart from
  cashflow. Debts and receivables per person. EMIs split principal from
  interest, re-derived from the ledger each month. And mistakes? Corrections
  are reversing entries — the books are append-only, so history is never
  rewritten."*

### Act 6 — the race + close (2:08–2:45)
- **Shot A**: race demo page → **Fire 10 concurrent settlements** → tiles land:
  10 attempts / 1 committed / 9 rejected / ledger sum 0. Zoom the zero.
- **Shot B** (fast, 6–8s): voice overlay listening ring mid-conversation; then
  the architecture page's live invariant ("4,141 legs sum to 0.00").
- **End card**: Knot wordmark, *"Tie a knot so you don't forget."*, URL.
- **VO**: *"And because it's real money, we let ten writes race to settle the
  same debt. Under serializable isolation exactly one wins, nine are cleanly
  rejected, and the trial balance still sums to zero — write skew doesn't get a
  vote. It talks, through a live voice model if you want. It runs containerised
  on AWS with structured logs and exports. One database holds the money and
  the memory. Knot — tie a knot so you don't forget."*

## Production pipeline (what's generated vs recorded)

Everything except the voiceover and music is generated from code:

1. **Screen capture** — Playwright `recordVideo` at 1920×1080, dark theme,
   seeded demo account, human-speed typing (`pressSequentially` with delay).
   Deterministic and re-runnable: `scripts/video/` holds one script per act.
2. **Title/end cards** — plain HTML using the app's own tokens and fonts,
   CSS-animated (logo draw-in via the existing `knot-tying` keyframes),
   recorded headlessly the same way.
3. **Assembly** — ffmpeg: `xfade` crossfades between acts, `setpts` speed
   ramps over typing, `zoompan` for the trace/zero zooms, styled captions.
4. **Voiceover** — record on a phone/mac mic against the cut (script above,
   ~140 wpm ≈ 2:30 of speech). A `say`-generated scratch track times the edit
   before the real VO exists.
5. **Music** — one low-key track under the VO, ducked with
   `sidechaincompress`. (Pick from a royalty-free library; keep it quiet.)

Order of work: freeze demo data → capture acts → assemble with scratch VO →
review timing → record real VO → final mix → YouTube (public) → link in
README + Devpost form.

## Demo-data prerequisites (freeze before capture)

The seeded demo account must already contain: several weeks of categorised
spending (heatmap needs density), the salary recurring rule, the Reliance
holding bought at 1380, the car loan with a couple of EMIs posted, Priya/Arjun
debt history, the rent-split rule NOT yet taught (Act 3 teaches it live), and
a food limit at ~60% mid-month so the pace warning shows.
