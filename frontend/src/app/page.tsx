import Link from "next/link";
import Logo from "@/components/ui/Logo";
import { buttonClass } from "@/components/ui/Button";

const FEATURES = [
  {
    title: "Say it. It's booked.",
    lines: ["“Lent Priya 500 for lunch.”", "Balanced double-entry, committed atomically."],
  },
  {
    title: "It remembers.",
    lines: ["Teach it once: rent splits three ways.", "Next month it just does it."],
  },
  {
    title: "The books can't drift.",
    lines: ["Ten writes racing, one wins.", "Every debit still meets its credit."],
  },
  {
    title: "It notices.",
    lines: ["“Eating out is up 237% this month.”", "Numbers from SQL, never guessed."],
  },
];

const PHILOSOPHY = [
  ["Money is about people.", "Not categories. Not spreadsheets."],
  ["The agent writes. The books stay honest.", "It never invents a number."],
  ["Memory that forgets on purpose.", "Chatter expires. What matters is kept."],
  ["One database.", "The books and the memory, same transaction."],
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 pt-[max(env(safe-area-inset-top),1.25rem)] pb-4">
        <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Logo size={22} className="text-brand-ink" title="Knot" />
          Knot
        </span>
        <Link href="/login" className={buttonClass("ghost", "sm")}>
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-20">
        {/* Hero */}
        <section className="pt-10 pb-14 text-center sm:pt-16">
          <Logo size={64} className="mx-auto text-brand-ink" />
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
            Money you can just talk about.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-lg text-ink-secondary">
            You tie a knot so you don&apos;t forget.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className={buttonClass("primary", "md")}>
              Try it
            </Link>
            <Link href="/demo" className={buttonClass("ghost", "md")}>
              See the race demo
            </Link>
          </div>
        </section>

        {/* Demo video — swap the placeholder for an <iframe> when it's cut */}
        <section className="mb-16">
          <div className="hairline-gold flex aspect-video w-full items-center justify-center rounded-2xl border border-line bg-surface-card">
            <div className="text-center">
              <Logo size={34} className="mx-auto text-brand-ink opacity-60" />
              <p className="mt-3 text-sm text-ink-secondary">Demo video</p>
              <p className="mt-1 text-xs text-ink-muted">Two minutes. Coming soon.</p>
            </div>
          </div>
        </section>

        {/* What it does */}
        <section className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-surface-card p-5">
              <h2 className="text-base font-semibold tracking-tight">{f.title}</h2>
              {f.lines.map((line) => (
                <p key={line} className="mt-1.5 text-sm text-ink-secondary">
                  {line}
                </p>
              ))}
            </div>
          ))}
        </section>

        {/* Philosophy */}
        <section className="mt-16">
          <h2 className="text-[11px] uppercase tracking-wide text-ink-secondary">
            How it thinks
          </h2>
          <dl className="mt-4 divide-y divide-line border-y border-line">
            {PHILOSOPHY.map(([claim, note]) => (
              <div key={claim} className="flex flex-col gap-1 py-4 sm:flex-row sm:gap-8">
                <dt className="font-medium sm:w-1/2">{claim}</dt>
                <dd className="text-sm text-ink-secondary sm:w-1/2">{note}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Built on */}
        <section className="mt-16 text-center">
          <p className="text-[11px] uppercase tracking-wide text-ink-secondary">Built on</p>
          <p className="mx-auto mt-3 max-w-lg text-sm text-ink-secondary">
            One CockroachDB cluster holds the ledger and four memory stores —
            serializable money, vector recall, same transaction.
          </p>
          <div className="mt-8">
            <Link href="/login" className={buttonClass("primary", "md")}>
              Start talking
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-ink-muted">
        Built for the CockroachDB × AWS hackathon.
      </footer>
    </div>
  );
}
