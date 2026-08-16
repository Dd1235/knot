import Link from "next/link";
import Logo, { Wordmark } from "@/components/ui/Logo";
import { buttonClass } from "@/components/ui/Button";
import Pill from "@/components/ui/Pill";

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
          {/* Quiet anchors, not a mega-menu: a one-page product gets a one-line map. */}
          <nav aria-label="Sections" className="hidden items-center gap-7 md:flex">
            <a
              href="#memory"
              className="text-sm text-ink-secondary transition-colors hover:text-ink-primary"
            >
              Memory
            </a>
            <a
              href="#correctness"
              className="text-sm text-ink-secondary transition-colors hover:text-ink-primary"
            >
              Correctness
            </a>
            <Link
              href="/architecture"
              className="text-sm text-ink-secondary transition-colors hover:text-ink-primary"
            >
              How it works
            </Link>
          </nav>
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
          {/* Hero: the claim on the left, the product already doing it on the
              right. The headline is the wordmark's serif — the one place the
              brand voice should be loudest — with the promise in italic. */}
          <section className="grid items-center gap-10 bg-[radial-gradient(55%_45%_at_72%_28%,color-mix(in_oklab,var(--brand)_6%,transparent),transparent)] pt-14 pb-20 sm:pt-20 sm:pb-28 lg:grid-cols-2 lg:gap-16">
            <div>
              <h1 className="max-w-[15ch] font-display text-[54px] leading-[1.02] font-normal tracking-[-0.01em] sm:text-[74px]">
                Money you can <em>just talk</em> about.
              </h1>
              <p className="mt-6 max-w-[52ch] text-[17px] leading-[1.65] text-ink-secondary">
                You tie a knot so you don&apos;t forget. Knot keeps a real double-entry
                ledger and remembers the people, habits and commitments behind it.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link href="/login" className={buttonClass("primary", "lg")}>
                  Try it
                </Link>
                <Link href="/demo" className={buttonClass("ghost", "lg")}>
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
          <section
            id="memory"
            className="grid scroll-mt-24 items-center gap-8 py-16 sm:py-24 lg:grid-cols-12 lg:gap-12"
          >
            <div className="lg:col-span-5">
              <p className="eyebrow text-brand-ink">Agentic memory</p>
              <h2 className="mt-3 font-display text-[34px] leading-[1.1] font-normal sm:text-[40px]">
                It remembers.
              </h2>
              <p className="mt-4 max-w-150 text-base leading-relaxed text-ink-secondary">
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
          <section className="grid items-center gap-8 py-16 sm:py-24 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-7 lg:order-first">
              <MiniHeatmap />
            </div>
            <div className="lg:col-span-5">
              <p className="eyebrow text-brand-ink">Rule-based insights</p>
              <h2 className="mt-3 font-display text-[34px] leading-[1.1] font-normal sm:text-[40px]">
                It notices.
              </h2>
              <p className="mt-4 max-w-150 text-base leading-relaxed text-ink-secondary">
                A heatmap of half a year, safe-to-spend until payday, limits judged
                by pace against the calendar. SQL computes every number; the agent
                only phrases what is already true.
              </p>
            </div>
          </section>

          {/* Feature band: correctness */}
          <section
            id="correctness"
            className="grid scroll-mt-24 items-center gap-10 py-16 sm:py-24 lg:grid-cols-12 lg:gap-12"
          >
            <div className="lg:col-span-5">
              <p className="eyebrow text-brand-ink">Serializable isolation</p>
              <h2 className="mt-3 font-display text-[34px] leading-[1.1] font-normal sm:text-[40px]">
                The books can&apos;t drift.
              </h2>
              <p className="mt-4 max-w-150 text-base leading-relaxed text-ink-secondary">
                Ten writes race to settle the same debt; exactly one wins and the
                rest are cleanly rejected. Every debit still meets its credit — you
                can fire the race yourself.
              </p>
              <Link href="/demo" className={`mt-6 ${buttonClass("ghost", "md")}`}>
                Run the race demo
              </Link>
            </div>
            {/* Display numerals, not dashboard tiles — these three are the
                argument, so they get the display face and a whole column each.
                Marketing numerals only: money and data stay sans, tabular. */}
            <div className="grid grid-cols-3 divide-x divide-line lg:col-span-7">
              {[
                { value: "10", label: "writes racing", tone: "" },
                { value: "1", label: "winner", tone: "text-positive" },
                { value: "0", label: "drift", tone: "text-brand-ink" },
              ].map(({ value, label, tone }) => (
                <div key={label} className="px-6 py-2 first:pl-0 sm:px-10">
                  <p className={`font-display text-[56px] leading-none sm:text-[72px] ${tone}`}>
                    {value}
                  </p>
                  <p className="eyebrow mt-3 text-ink-secondary">{label}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Breadth, without a wall of text */}
          <section className="py-16 sm:py-24">
            <p className="eyebrow text-brand-ink">The whole picture</p>
            <div className="mt-8 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
              {BREADTH.map(([title, line]) => (
                <div key={title} className="border-t border-line pt-4">
                  <h3 className="text-[15px] font-medium">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{line}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Philosophy */}
          <section className="max-w-3xl py-16 sm:py-24">
            <h2 className="eyebrow text-brand-ink">How it thinks</h2>
            <dl className="mt-6 divide-y divide-line border-y border-line">
              {PHILOSOPHY.map(([claim, note]) => (
                <div key={claim} className="flex flex-col gap-1 py-5 sm:flex-row sm:gap-8">
                  <dt className="text-[15px] font-medium sm:w-1/2">{claim}</dt>
                  <dd className="text-[15px] text-ink-secondary sm:w-1/2">{note}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* The finale: one line in the brand voice, then the door. */}
          <section className="py-20 text-center sm:py-28">
            <p className="eyebrow text-brand-ink">Built on one database</p>
            <h2 className="mx-auto mt-4 max-w-[18ch] font-display text-[40px] leading-[1.05] font-normal sm:text-[52px]">
              Start talking <em>to</em> your money.
            </h2>
            <p className="mx-auto mt-5 max-w-[46ch] text-base leading-relaxed text-ink-secondary">
              One CockroachDB cluster holds the ledger and four memory stores —
              serializable money, vector recall, same transaction.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/login" className={buttonClass("primary", "lg")}>
                Start talking
              </Link>
              <Link href="/architecture" className={buttonClass("ghost", "lg")}>
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
