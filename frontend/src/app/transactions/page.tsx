"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LedgerTransaction,
  TransactionWhy,
  getTransactionWhy,
  inr,
  listTransactions,
  voidTransaction,
} from "@/lib/api";
import AppShell, { PageTitle, ScreenReaderOnly } from "@/components/ui/AppShell";
import Button from "@/components/ui/Button";
import Money from "@/components/ui/Money";
import { GROUP_COLORS } from "@/lib/groups";
import Icon from "@/components/ui/Icon";
import { iconFor, initialFor } from "@/lib/categoryIcons";

/* Every direction needs an entry. Anything missing fell through to `spent`,
 * which is how "borrowed 5,000 from Priya" came to display as money going out. */
const DIRECTION: Record<string, { label: string; sign: string; tone: string }> = {
  spent: { label: "spent", sign: "−", tone: "text-ink-primary" },
  received: { label: "received", sign: "+", tone: "text-positive" },
  lent: { label: "lent", sign: "→", tone: "text-info" },
  settled: { label: "settled", sign: "←", tone: "text-positive" },
  borrowed: { label: "borrowed", sign: "+", tone: "text-info" },
  repaid: { label: "repaid", sign: "−", tone: "text-ink-primary" },
  // Not spending: the money changed shape. Never tinted like an outflow.
  invested: { label: "invested", sign: "→", tone: "text-positive" },
  transfer: { label: "moved", sign: "↔", tone: "text-ink-secondary" },
  refund: { label: "refunded", sign: "+", tone: "text-positive" },
  reversal: { label: "reversal", sign: "↺", tone: "text-ink-muted" },
};

/** One step of the derivation, as a labelled row.
 *
 * The label column is fixed-width so the four steps read as a sequence rather
 * than four unrelated paragraphs — the point of the panel is that these things
 * happened in an order. */
function Step({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[11px]">
      <span className="w-14 shrink-0 pt-px text-ink-muted">{label}</span>
      <div className="min-w-0 flex-1 text-ink-secondary">{children}</div>
    </div>
  );
}

/** Why does this entry exist? — said → recalled → ran → posted.
 *
 * Every part can legitimately be missing: a row posted through the REST
 * endpoint had no tool call, and a spoken turn has no context trace because
 * voice turns persist by a path that does not write one. Each says so, because
 * a blank space would read as "nothing happened" rather than "not recorded". */
function WhyPanel({
  id,
  name,
  onLoaded,
}: {
  id: string;
  name: string;
  onLoaded: (message: string) => void;
}) {
  const [why, setWhy] = useState<TransactionWhy | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getTransactionWhy(id)
      .then((w) => {
        if (!live) return;
        setWhy(w);
        onLoaded(`Showing why ${name} exists: ${w.posted.length} legs.`);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, name, onLoaded]);

  if (failed) {
    return (
      <p className="px-3 pb-2.5 pl-14 text-[11px] text-ink-muted" role="alert">
        Couldn’t load where this came from.
      </p>
    );
  }
  if (!why) {
    return (
      <div className="px-3 pb-2.5 pl-14">
        <div className="h-16 animate-pulse rounded-lg bg-surface-raised" />
      </div>
    );
  }

  const rules = why.recalled.rules ?? [];
  const facts = why.recalled.facts ?? [];
  const episodes = why.recalled.episodes ?? [];
  const nothingRecalled = rules.length + facts.length + episodes.length === 0;

  return (
    <div className="space-y-2 border-t border-line bg-surface-raised px-3 py-2.5 pl-14">
      <Step label="you said">
        {why.said ? (
          <span className="text-ink-primary">“{why.said}”</span>
        ) : (
          <span className="text-ink-muted">not recorded — posted without a sentence</span>
        )}
      </Step>

      <Step label="recalled">
        {nothingRecalled ? (
          <span className="text-ink-muted">nothing — this turn needed no memory</span>
        ) : (
          <ul className="space-y-0.5">
            {rules.map((r, i) => (
              <li key={`r${i}`}>
                <span className="text-ink-muted">rule</span> {r.rule.instruction}
              </li>
            ))}
            {facts.map((f, i) => (
              <li key={`f${i}`}>
                <span className="text-ink-muted">{f.kind}</span> {f.fact}
              </li>
            ))}
            {episodes.map((e, i) => (
              <li key={`e${i}`}>
                <span className="text-ink-muted">{e.kind}</span> {e.summary}
              </li>
            ))}
          </ul>
        )}
      </Step>

      <Step label="ran">
        {why.ran ? (
          <>
            <span className="font-mono text-brand-ink">{why.ran.tool}</span>
            <span className="text-ink-muted"> · {why.ran.latency_ms}ms</span>
            {/* Wraps rather than truncates: the arguments are the evidence.
                Clipping them cut off exactly the one that came from a recalled
                rule instead of from the sentence, which is the whole point. */}
            <div className="mt-0.5 break-all font-mono text-[10px] text-ink-muted">
              {JSON.stringify(why.ran.args)}
            </div>
          </>
        ) : (
          <span className="text-ink-muted">no tool call — posted directly to the ledger</span>
        )}
      </Step>

      {/* The invariant, per entry. Every other screen claims the books balance;
          this is the one place you can watch a single entry do it. */}
      <Step label="posted">
        <ul className="space-y-0.5 tabular-nums">
          {why.posted.map((leg, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="truncate">{leg.account}</span>
              <Money value={leg.amount} tone="neutral" />
            </li>
          ))}
          <li className="flex justify-between gap-3 border-t border-line pt-0.5">
            <span className="text-ink-muted">sum</span>
            <Money
              value={why.transaction.leg_sum}
              tone={Number(why.transaction.leg_sum) === 0 ? "positive" : "negative"}
            />
          </li>
        </ul>
      </Step>

    </div>
  );
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

/** Below this, a row is part of the background texture of a day rather than
 * an event. Most UPI payments are small — 76% are under ₹500 — so if every
 * one of them shouts, nothing does. */
const MINOR_AMOUNT = 100;

/** `recurring` writes "Netflix (auto, 2026-07)" into the description. That is
 * plumbing leaking into the UI: strip it and show a badge instead. */
function cleanName(description: string): { name: string; auto: boolean } {
  const m = description.match(/^(.*?)\s*\(auto,\s*[\d-]+\)$/);
  return m ? { name: m[1], auto: true } : { name: description, auto: false };
}

/** The user's own words, but only when they add something. Seeded and
 * short-form entries produce a raw_input of "saloon 375", which just repeats
 * the row and then truncates mid-word. */
function saidSomething(raw: string, description: string): boolean {
  if (!raw) return false;
  const stripped = raw.toLowerCase().replace(description.toLowerCase(), "");
  return /[a-z]{3,}/.test(stripped);
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-line px-1 py-px text-[10px] uppercase tracking-wide text-ink-muted">
      {children}
    </span>
  );
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  // One open at a time: the panel is tall, and two expanded rows lose the
  // ordering that makes the ledger readable.
  const [whyId, setWhyId] = useState<string | null>(null);
  /* Rendered empty from the start. A live region inserted at the same moment
     as its text is announced unreliably; a stable one that changes is not. */
  const [announcement, setAnnouncement] = useState("");
  const [filter, setFilter] = useState("");

  const refresh = useCallback(() => {
    listTransactions(100)
      .then((r) => setTransactions(r.transactions))
      .catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const onVoid = async (txn: LedgerTransaction) => {
    if (!window.confirm(`Void "${txn.description}" (${inr(txn.amount)})?`)) return;
    setBusyId(txn.id);
    try {
      await voidTransaction(txn.id, "voided from transactions page");
      setAnnouncement(`Voided ${txn.description}. A reversing entry was added.`);
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  // Grouped by day, so a long list reads as a diary rather than a dump.
  const days = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = q
      ? transactions.filter((t) =>
          `${t.description} ${t.category} ${t.people ?? ""}`.toLowerCase().includes(q),
        )
      : transactions;
    const buckets = new Map<string, LedgerTransaction[]>();
    for (const t of matched) {
      const key = dayLabel(t.occurred_at);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(t);
    }
    return [...buckets.entries()];
  }, [transactions, filter]);

  const dayTotal = (rows: LedgerTransaction[]) =>
    rows
      .filter((t) => t.direction === "spent" && !t.voided)  // not invested, not moved
      .reduce((sum, t) => sum + Number(t.amount), 0);

  return (
    <AppShell>
      <div className="flex max-w-3xl flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <PageTitle>Transactions</PageTitle>
      <ScreenReaderOnly role="status" aria-live="polite">
        {announcement}
      </ScreenReaderOnly>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search description, category or person…"
          aria-label="Search transactions"
          className="w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-base placeholder:text-ink-muted focus:border-brand-line sm:max-w-xs sm:text-sm"
        />
      </div>

      <div className="mt-5 max-w-3xl">
        {days.length === 0 ? (
          <p className="mt-10 text-center text-sm text-ink-secondary">
            {transactions.length === 0
              ? "Nothing recorded yet — tell the agent about a payment."
              : "No transactions match that search."}
          </p>
        ) : (
          days.map(([day, rows]) => (
            <section key={day} className="mb-5">
              <div className="sticky top-0 z-10 mb-1.5 flex items-baseline justify-between bg-surface-base px-1 py-1">
                <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
                  {day}
                </h2>
                {dayTotal(rows) > 0 && (
                  <span className="text-[11px] text-ink-secondary">
                    <Money value={dayTotal(rows)} tone="neutral" /> spent
                  </span>
                )}
              </div>

              <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-card">
                {rows.map((t) => {
                  const dir = DIRECTION[t.direction] ?? DIRECTION.spent;
                  const dead = t.voided || t.direction === "reversal";
                  const { name, auto } = cleanName(t.description);
                  const minor = Number(t.amount) < MINOR_AMOUNT && t.direction === "spent";
                  return (
                    <div key={t.id} className={dead ? "opacity-55" : ""}>
                    <div
                      className={`group flex items-start gap-3 px-3 ${
                        minor ? "py-1.5" : "py-2.5"
                      }`}
                    >
                      {/* Identity is a glyph, not a hue: shape survives
                          greyscale, colour blindness and a twelfth category.
                          The tint behind it is the group, kept very low
                          contrast so it never competes with the amount. */}
                      <span
                        aria-hidden
                        className={`flex shrink-0 items-center justify-center rounded-full ${
                          minor ? "size-6 text-[11px]" : "size-8 text-sm"
                        }`}
                        style={{
                          backgroundColor: `color-mix(in oklab, ${
                            GROUP_COLORS[t.grp] ?? GROUP_COLORS.other
                          } 16%, transparent)`,
                        }}
                      >
                        {(() => {
                          const Glyph = iconFor(t.category);
                          return Glyph ? (
                            <Icon as={Glyph} size={minor ? 12 : 15} />
                          ) : (
                            <span className="font-medium">
                              {initialFor(t.category, t.description)}
                            </span>
                          );
                        })()}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p
                          className={`flex items-center gap-1.5 truncate ${
                            minor ? "text-[13px] text-ink-secondary" : "text-sm"
                          } ${t.voided ? "text-ink-muted line-through" : ""}`}
                        >
                          <span className="truncate">{name}</span>
                          {t.people && (
                            <span className="shrink-0 text-ink-secondary">· {t.people}</span>
                          )}
                          {/* No `voice` badge: speech is how this app is
                              meant to be used, so badging it marks every row
                              and therefore none. `auto` is worth saying —
                              nobody typed that one. */}
                          {auto && <Badge>auto</Badge>}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                          {t.category} · {timeOf(t.occurred_at)}
                          {saidSomething(t.raw_input, name) && (
                            <span> · “{t.raw_input}”</span>
                          )}
                        </p>
                        {/* Written free, on the LLM call the memory writer
                            already makes. Present on a minority of rows by
                            design — if it were on all of them it would be
                            wallpaper. */}
                        {t.annotation && !dead && (
                          <p className="mt-1 flex items-start gap-1.5 text-[11px] text-ink-secondary">
                            <span aria-hidden className="mt-1 size-1 shrink-0 rounded-full bg-brand" />
                            <span>{t.annotation}</span>
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`${minor ? "text-[13px]" : "text-sm"} ${dir.tone}`}>
                          <span className="text-ink-muted">{dir.sign}</span>
                          <Money value={t.amount} tone="neutral" />
                        </span>
                        {/* Kept on voided rows too: a reversal is exactly the
                            entry you most want to be able to interrogate. */}
                        <Button
                          variant="ghost"
                          onClick={() => setWhyId(whyId === t.id ? null : t.id)}
                          aria-expanded={whyId === t.id}
                          aria-controls={`why-${t.id}`}
                          aria-label={`Why is ${name} here?`}
                          className={`transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
                            whyId === t.id ? "opacity-100" : "opacity-0"
                          }`}
                        >
                          why
                        </Button>
                        {!dead ? (
                          <Button
                            variant="tonal"
                            tone="negative"
                            onClick={() => onVoid(t)}
                            disabled={busyId === t.id}
                            aria-label={`Void ${name}`}
                            className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            void
                          </Button>
                        ) : (
                          <span className="text-[11px] text-ink-muted">
                            {t.voided ? "voided" : dir.label}
                          </span>
                        )}
                      </div>
                    </div>
                    <div id={`why-${t.id}`}>
                      {whyId === t.id && <WhyPanel id={t.id} name={name} onLoaded={setAnnouncement} />}
                    </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </AppShell>
  );
}
