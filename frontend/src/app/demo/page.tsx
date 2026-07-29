"use client";

import { useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Money from "@/components/ui/Money";
import Stat from "@/components/ui/Stat";

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
      <AppHeader title="Race demo" back="/app" />

      <main className="mx-auto w-full max-w-lg flex-1 space-y-5 overflow-y-auto px-4 py-6 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <div className="space-y-2 text-sm text-ink-secondary">
          <p>
            <span className="font-medium text-ink-primary">The scenario:</span> Priya
            owes you ₹500. Ten settlement requests for the full amount hit the API at
            the exact same moment — a double-tap, a retried webhook, two devices.
          </p>
          <p>
            Under weak isolation this is <em>write skew</em>: every request reads
            &quot;₹500 outstanding&quot;, validates, and commits — you get &quot;paid
            back&quot; ₹5,000. Under CockroachDB&apos;s serializable isolation, exactly
            one can win.
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={fire}
          disabled={busy}
          className="w-full py-3.5"
        >
          {busy ? "10 settlements racing…" : "Fire 10 concurrent settlements"}
        </Button>

        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="attempts" value={result.attempts} />
              <Stat label="committed" value={result.committed} tone="positive" />
              <Stat label="cleanly rejected" value={result.rejected} tone="warning" />
              <Stat
                label="serialization retries"
                value={result.serialization_retries}
                tone="info"
              />
            </div>
            <div
              className={`rounded-xl border p-4 text-center ${
                balanced
                  ? "border-positive-line bg-positive-soft"
                  : "border-negative-line bg-negative-soft"
              }`}
            >
              <Money
                value={result.ledger_sum}
                size="hero"
                tone={balanced ? "positive" : "negative"}
              />
              <p className="mt-1 text-xs text-ink-secondary">
                {balanced
                  ? `ledger sum — every debit met its credit. Priya's balance: ₹${Number(
                      result.priya_balance,
                    ).toFixed(2)}`
                  : "INVARIANT VIOLATED"}
              </p>
            </div>
            <p className="text-center text-xs text-ink-secondary">
              {result.committed} settlement committed · {result.rejected} rejected after
              CockroachDB serialized the race
              {result.serialization_retries > 0 &&
                ` · ${result.serialization_retries} × 40001 retries handled`}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
