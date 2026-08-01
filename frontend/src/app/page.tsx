import Link from "next/link";
import Logo, { Wordmark } from "@/components/ui/Logo";
import { buttonClass } from "@/components/ui/Button";
import Pill from "@/components/ui/Pill";
import Stat from "@/components/ui/Stat";

/* The landing page shows the product instead of describing it: every visual
 * below is the real UI's own markup and tokens — chat bubbles, memory traces,
 * debt pills, heat cells — hand-posed with static data. No screenshots to go
 * stale, no client JS to load, and it can never look unlike the app. */

const PHILOSOPHY = [
  ["Money is about people.", "Not categories. Not spreadsheets."],
  ["The agent writes. The books stay honest.", "It never invents a number."],
  ["Memory that forgets on purpose.", "Chatter expires. What matters is kept."],
  ["One database.", "The books and the memory, same transaction."],
];

const BREADTH = [
  ["Investments & SIPs", "cost, market value, and what's unpriced"],
  ["Loans & EMIs", "principal split from interest, amortised live"],
  ["Monthly limits", "judged by pace against the calendar, not a percentage"],
  ["Recurring", "salary, rent and subscriptions post on their dates"],
  ["People", "lent, borrowed, settled, repaid — per person"],
  ["Insights", "a spending heatmap, safe-to-spend, and what it notices"],
  ["Voice", "free on-device dictation, or live conversation"],
  ["Any currency", "books stay in ₹, shown at the rate you actually got"],
];

/* 26 weeks × 7 days of plausible spending for the mini heatmap: textured
 * weekdays, hot weekends, a monthly rent-and-EMI cluster. Deterministic, so
 * server and client always agree. Levels index bg-heat-0..4. */
const HEAT = Array.from({ length: 26 * 7 }, (_, i) => {
  const week = Math.floor(i / 7);
  const day = i % 7;
  const texture = (Math.sin(i * 3.7) + 1) * 0.9;
  const weekend = day >= 5 ? 1.3 : 0;
  const rentDay = week % 4 === 1 && day <= 1 ? 1.6 : 0;
  return Math.min(4, Math.round(texture + weekend + rentDay));
});

const HEAT_BG = ["bg-heat-0", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4"];

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm text-ink-on-brand">
        {children}
      </div>
    </div>
  );
}

function KnotBubble({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        <div className="rounded-2xl rounded-bl-md border border-line bg-surface-card px-3.5 py-2 text-sm">
          {children}
        </div>
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{meta}</div>}
      </div>
    </div>
  );
}

function MiniChat() {
  return (
    <div className="elevated space-y-3 rounded-2xl border border-line bg-surface-raised/40 p-4">
      <UserBubble>lent Priya 500 for lunch</UserBubble>
      <KnotBubble
        meta={
          <>
            <Pill>recorded</Pill>
            <span className="rounded-full border border-brand-line bg-brand-soft px-2 py-0.5 text-[11px] text-brand-ink">
              2 memories used
            </span>
          </>
        }
      >
        Noted — Priya now owes you ₹800 with the auto from Tuesday.
      </KnotBubble>
      <UserBubble>how am I doing this month?</UserBubble>
      <KnotBubble meta={<Pill>balances</Pill>}>
        Food is at ₹6,200 of 10k — on pace. Shopping is running hot: 315% up on
        last month.
      </KnotBubble>
    </div>
  );
}

function MiniMemory() {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5 rounded-lg border border-brand-line bg-brand-soft p-3 text-xs">
        <p>
          <span className="font-medium text-brand-ink">rule</span>{" "}
          <span className="text-ink-secondary">rent is split 3 ways with Kiran and Meera</span>
        </p>
        <p>
          <span className="font-medium text-brand-ink">relationship</span>{" "}
          <span className="text-ink-secondary">Priya is my flatmate, not my sister</span>
        </p>
        <p>
          <span className="font-medium text-brand-ink">event</span>{" "}
          <span className="text-ink-secondary">lent Priya ₹500 for lunch on Friday</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill tone="positive">Priya owes you ₹800</Pill>
        <Pill tone="positive">Matthew owes you ₹500</Pill>
        <Pill tone="negative">Arjun is owed ₹2,000</Pill>
      </div>
    </div>
  );
}

function MiniHeatmap() {
  return (
    <div className="elevated rounded-2xl border border-line bg-surface-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
        Half a year of spending
      </p>
      {/* Column-major like the real one: a column is a week, a row a weekday. */}
      <div className="mt-3 grid grid-flow-col grid-cols-26 grid-rows-7 gap-1">
        {HEAT.map((level, i) => (
          <div key={i} className={`aspect-square rounded-xs ${HEAT_BG[level]}`} />
        ))}
      </div>
      <p className="mt-3 flex items-baseline gap-2 text-sm text-ink-secondary">
        <span aria-hidden className="text-brand-ink">
          •
        </span>
        Eating out is up 237% this month — numbers from SQL, never guessed.
      </p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line px-6 pt-[env(safe-area-inset-top)] sm:px-8">
        <div className="mx-auto flex h-16 w-full max-w-310 items-center justify-between">
          <Wordmark size={24} />
          <div className="flex items-center gap-2">
            <Link href="/login" className={buttonClass("ghost", "sm")}>
              Sign in
            </Link>
            <Link href="/login" className={buttonClass("primary", "sm")}>
              Try it
            </Link>
          </div>
        </div>
      </header>

      <main className="px-6 pb-20 sm:px-8">
        <div className="mx-auto w-full max-w-310">
          {/* Hero: the claim on the left, the product already doing it on the right. */}
          <section className="grid items-center gap-10 pt-12 pb-16 lg:grid-cols-2 lg:gap-16">
            <div>
              <h1 className="max-w-[14ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">
                Money you can just talk about.
              </h1>
              <p className="mt-4 max-w-150 text-lg text-ink-secondary">
                You tie a knot so you don&apos;t forget. Knot keeps a real double-entry
                ledger and remembers the people, habits and commitments behind it.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/login" className={buttonClass("primary", "md")}>
                  Try it
                </Link>
                <Link href="/demo" className={buttonClass("ghost", "md")}>
                  See the race demo
                </Link>
              </div>
            </div>
            <MiniChat />
          </section>

          {/* Demo video — swap the placeholder for an <iframe> when it's cut */}
          <section className="mb-20">
            <div className="hairline-gold flex aspect-video w-full items-center justify-center rounded-2xl border border-line bg-surface-card">
              <div className="text-center">
                <Logo size={34} className="mx-auto text-brand-ink opacity-60" />
                <p className="mt-3 text-sm text-ink-secondary">Demo video</p>
                <p className="mt-1 text-xs text-ink-muted">Two minutes. Coming soon.</p>
              </div>
            </div>
          </section>

          {/* Feature band: memory */}
          <section className="grid items-center gap-8 py-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                Agentic memory
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">It remembers.</h2>
              <p className="mt-2 max-w-150 text-[15px] leading-relaxed text-ink-secondary">
                Teach it once — rent splits three ways — and next month it just does
                it. Four memory stores live beside the books: facts, events, rules,
                and the conversation itself. You never explain the same thing twice.
              </p>
            </div>
            <div className="lg:col-span-7">
              <MiniMemory />
            </div>
          </section>

          {/* Feature band: insights (mirrored) */}
          <section className="grid items-center gap-8 py-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-7 lg:order-first">
              <MiniHeatmap />
            </div>
            <div className="lg:col-span-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                Rule-based insights
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">It notices.</h2>
              <p className="mt-2 max-w-150 text-[15px] leading-relaxed text-ink-secondary">
                A heatmap of half a year, safe-to-spend until payday, limits judged
                by pace against the calendar. SQL computes every number; the agent
                only phrases what is already true.
              </p>
            </div>
          </section>

          {/* Feature band: correctness */}
          <section className="grid items-center gap-8 py-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                Serializable isolation
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                The books can&apos;t drift.
              </h2>
              <p className="mt-2 max-w-150 text-[15px] leading-relaxed text-ink-secondary">
                Ten writes race to settle the same debt; exactly one wins and the
                rest are cleanly rejected. Every debit still meets its credit — you
                can fire the race yourself.
              </p>
              <Link href="/demo" className={`mt-4 ${buttonClass("ghost", "sm")}`}>
                Run the race demo
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-3 lg:col-span-7">
              <Stat label="writes racing" value="10" />
              <Stat label="winner" value="1" tone="positive" />
              <Stat label="drift" value="0" tone="brand" />
            </div>
          </section>

          {/* Breadth, without a wall of text */}
          <section className="py-10">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              The whole picture
            </p>
            <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
              {BREADTH.map(([title, line]) => (
                <div key={title}>
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{line}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Philosophy */}
          <section className="max-w-3xl py-10">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              How it thinks
            </h2>
            <dl className="mt-4 divide-y divide-line border-y border-line">
              {PHILOSOPHY.map(([claim, note]) => (
                <div key={claim} className="flex flex-col gap-1 py-4 sm:flex-row sm:gap-8">
                  <dt className="text-[15px] font-medium sm:w-1/2">{claim}</dt>
                  <dd className="text-[15px] text-ink-secondary sm:w-1/2">{note}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Built on */}
          <section className="py-10">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              Built on
            </p>
            <p className="mt-3 max-w-160 text-[15px] leading-relaxed text-ink-secondary">
              One CockroachDB cluster holds the ledger and four memory stores —
              serializable money, vector recall, same transaction.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/login" className={buttonClass("primary", "md")}>
                Start talking
              </Link>
              <Link href="/architecture" className={buttonClass("ghost", "md")}>
                See how it works
              </Link>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-line px-6 py-6 sm:px-8">
        <p className="mx-auto w-full max-w-310 text-xs text-ink-muted">
          Built for the CockroachDB × AWS hackathon.
        </p>
      </footer>
    </div>
  );
}
