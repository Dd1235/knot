"use client";

import { useCallback, useEffect, useState } from "react";
import { LedgerTransaction, inr, listTransactions, voidTransaction } from "@/lib/api";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Money from "@/components/ui/Money";

const dt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listTransactions(50)
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

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader title="Transactions" back="/app" />

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {transactions.length === 0 ? (
          <p className="mt-8 text-center text-sm text-ink-secondary">
            No transactions yet.
          </p>
        ) : (
          <div className="ruled divide-y divide-line rounded-xl border border-line bg-surface-card">
            {transactions.map((t) => {
              const isReversal = t.category === "reversal";
              const dead = t.voided || isReversal;
              return (
                <div
                  key={t.id}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 text-sm ${
                    dead ? "opacity-55" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className={t.voided ? "text-ink-muted line-through" : ""}>
                      {t.description}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-secondary">
                      {t.category} · {t.source} · {dt(t.occurred_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <Money value={t.amount} tone={dead ? "neutral" : "negative"} />
                    {!dead && (
                      <Button
                        variant="tonal"
                        tone="negative"
                        onClick={() => onVoid(t)}
                        disabled={busyId === t.id}
                        aria-label={`Void ${t.description}`}
                      >
                        void
                      </Button>
                    )}
                    {t.voided && (
                      <span className="text-[11px] text-negative">voided</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
