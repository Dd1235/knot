"use client";

import { useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface RaceResult {
  scenario: string;
  attempts: number;
  committed: number;
  rejected: number;
  errors: number;
  serialization_retries: number;
  priya_balance: string;
  ledger_sum: string;
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
      <p className={`text-2xl font-semibold ${accent ?? "text-zinc-100"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
    </div>
  );
}

export default function DemoPage() {
  const [result, setResult] = useState<RaceResult | null>(null);
  const [busy, setBusy] = useState(false);

  const fire = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/demo/race`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency: 10 }),
      });
      setResult(await res.json());
    } finally {
      setBusy(false);
    }
  };

  const balanced = result && Number(result.ledger_sum) === 0 && result.committed === 1;

  return (
    <div className="flex h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur px-4 pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">⚡ Race Demo</h1>
          <Link
            href="/"
            className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 active:bg-zinc-900"
          >
            ← chat
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6 space-y-5 max-w-lg w-full mx-auto">
        <div className="space-y-2 text-sm text-zinc-400">
          <p>
            <span className="text-zinc-200 font-medium">The scenario:</span> Priya owes you
            ₹500. Ten settlement requests for the full amount hit the API at the exact same
            moment — a double-tap, a retried webhook, two devices.
          </p>
          <p>
            Under weak isolation this is <em>write skew</em>: every request reads
            &quot;₹500 outstanding&quot;, validates, and commits — you get &quot;paid back&quot;
            ₹5,000. Under CockroachDB&apos;s serializable isolation, exactly one can win.
          </p>
        </div>

        <button
          onClick={fire}
          disabled={busy}
          className="w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-semibold active:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "10 settlements racing…" : "🏁 Fire 10 concurrent settlements"}
        </button>

        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="attempts" value={result.attempts} />
              <Stat label="committed" value={result.committed} accent="text-emerald-400" />
              <Stat label="cleanly rejected" value={result.rejected} accent="text-amber-400" />
              <Stat
                label="serialization retries"
                value={result.serialization_retries}
                accent="text-sky-400"
              />
            </div>
            <div
              className={`rounded-xl border p-4 text-center ${
                balanced
                  ? "border-emerald-800 bg-emerald-950/40"
                  : "border-rose-800 bg-rose-950/40"
              }`}
            >
              <p className="text-3xl font-bold tracking-tight">
                {balanced ? "₹0.00" : `₹${result.ledger_sum}`}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {balanced
                  ? "ledger sum — every debit met its credit. Priya's balance: ₹" +
                    Number(result.priya_balance).toFixed(2)
                  : "INVARIANT VIOLATED"}
              </p>
            </div>
            <p className="text-center text-xs text-zinc-500">
              {result.committed} settlement committed · {result.rejected} rejected after
              CockroachDB serialized the race{" "}
              {result.serialization_retries > 0 &&
                `· ${result.serialization_retries} × 40001 retries handled`}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
