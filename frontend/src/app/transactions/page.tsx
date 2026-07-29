"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LedgerTransaction, inr, listTransactions, voidTransaction } from "@/lib/api";

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
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur px-4 pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">📒 Transactions</h1>
          <Link
            href="/"
            className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 active:bg-zinc-900"
          >
            ← chat
          </Link>
        </div>
      </header>

      <main className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {transactions.length === 0 && (
          <p className="mt-8 text-center text-sm text-zinc-500">No transactions yet.</p>
        )}
        {transactions.map((t) => {
          const isReversal = t.category === "reversal";
          const dead = t.voided || isReversal;
          return (
            <div
              key={t.id}
              className={`rounded-xl border p-3 text-sm ${
                dead ? "border-zinc-900 bg-zinc-950 opacity-60" : "border-zinc-800 bg-zinc-900/60"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={t.voided ? "line-through text-zinc-500" : ""}>
                    {t.description}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {t.category} · {t.source} · {dt(t.occurred_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <span className={`font-medium ${dead ? "text-zinc-500" : ""}`}>
                    {inr(t.amount)}
                  </span>
                  {!dead && (
                    <button
                      onClick={() => onVoid(t)}
                      disabled={busyId === t.id}
                      className="rounded-lg border border-rose-900 bg-rose-950/40 px-2 py-1 text-[11px] text-rose-400 active:bg-rose-950 disabled:opacity-40"
                    >
                      void
                    </button>
                  )}
                  {t.voided && <span className="text-[11px] text-rose-500">voided</span>}
                </div>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
