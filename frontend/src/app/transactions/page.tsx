"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LedgerTransaction, inr, listTransactions, voidTransaction } from "@/lib/api";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Money from "@/components/ui/Money";
import { GROUP_COLORS, GROUP_LABELS } from "@/lib/groups";

const DIRECTION: Record<string, { label: string; sign: string; tone: string }> = {
  spent: { label: "spent", sign: "−", tone: "text-ink-primary" },
  received: { label: "received", sign: "+", tone: "text-positive" },
  lent: { label: "lent", sign: "→", tone: "text-info" },
  settled: { label: "settled", sign: "←", tone: "text-positive" },
  reversal: { label: "reversal", sign: "↺", tone: "text-ink-muted" },
};

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

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
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
      .filter((t) => t.direction === "spent" && !t.voided)
      .reduce((sum, t) => sum + Number(t.amount), 0);

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader title="Transactions" back="/app">
        <div className="pb-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search description, category or person…"
            aria-label="Search transactions"
            className="w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand-line"
          />
        </div>
      </AppHeader>

      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {days.length === 0 ? (
          <p className="mt-10 text-center text-sm text-ink-secondary">
            {transactions.length === 0
              ? "Nothing recorded yet — tell the agent about a payment."
              : "No transactions match that search."}
          </p>
        ) : (
          days.map(([day, rows]) => (
            <section key={day} className="mb-5">
              <div className="mb-1.5 flex items-baseline justify-between px-1">
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
                  return (
                    <div
                      key={t.id}
                      className={`group flex items-center gap-3 px-3 py-2.5 ${
                        dead ? "opacity-55" : ""
                      }`}
                    >
                      {/* Colour follows the spending group, never the row index */}
                      <span
                        aria-hidden
                        className="h-8 w-1 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            GROUP_COLORS[t.grp] ?? GROUP_COLORS.other,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-sm ${
                            t.voided ? "text-ink-muted line-through" : ""
                          }`}
                        >
                          {t.description}
                          {t.people && (
                            <span className="text-ink-secondary"> · {t.people}</span>
                          )}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-ink-secondary">
                          {t.category} · {GROUP_LABELS[t.grp] ?? t.grp} · {timeOf(t.occurred_at)}
                          {t.source === "voice" && " · 🎙"}
                          {t.raw_input && (
                            <span className="text-ink-muted"> · “{t.raw_input}”</span>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`text-sm ${dir.tone}`}>
                          <span className="text-ink-muted">{dir.sign}</span>
                          <Money value={t.amount} tone="neutral" />
                        </span>
                        {!dead ? (
                          <Button
                            variant="tonal"
                            tone="negative"
                            onClick={() => onVoid(t)}
                            disabled={busyId === t.id}
                            aria-label={`Void ${t.description}`}
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
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
