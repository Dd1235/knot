"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import Card, { CardTitle } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import Money from "@/components/ui/Money";
import Stat from "@/components/ui/Stat";
import { Holding, Portfolio, getHoldings } from "@/lib/api";
import { Bitcoin, ChartCandlestick, Coins, Percent, Sparkles, TrendingUp } from "lucide-react";

const KIND_ICON = {
  stocks: TrendingUp,
  mutual_funds: ChartCandlestick,
  etf: ChartCandlestick,
  elss: Percent,
  bonds: Percent,
  gold: Sparkles,
  crypto: Bitcoin,
} as const;

const UNITS = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 });

function SkeletonCard({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-xl border border-line bg-surface-card ${className}`} />
  );
}

function since(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "priced today";
  if (days === 1) return "priced yesterday";
  return `priced ${days} days ago`;
}

/** One holding. Cost basis is always known; current value is only as fresh as
 * the last price the user stated, and the row says which. */
function HoldingRow({ h }: { h: Holding }) {
  const glyph = KIND_ICON[h.kind as keyof typeof KIND_ICON] ?? Coins;
  const gain = h.unrealised === null ? null : Number(h.unrealised);
  const pct =
    gain === null || Number(h.cost_basis) === 0
      ? null
      : (gain / Number(h.cost_basis)) * 100;

  return (
    <div className="flex items-start gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
      <span
        aria-hidden
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: "color-mix(in oklab, var(--positive) 16%, transparent)" }}
      >
        <Icon as={glyph} size={15} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{h.display_name || h.symbol}</p>
        <p className="mt-0.5 text-[11px] text-ink-secondary">
          {UNITS.format(Number(h.units))} @ <Money value={h.avg_cost} tone="neutral" /> avg
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm">
          <Money value={h.priced ? h.market_value! : h.cost_basis} />
        </p>
        {gain !== null ? (
          <p
            className={`text-[11px] tabular-nums ${
              gain > 0 ? "text-positive" : gain < 0 ? "text-negative" : "text-ink-secondary"
            }`}
          >
            {gain > 0 ? "+" : ""}
            {pct !== null ? `${pct.toFixed(1)}%` : ""}{" "}
            <span className="text-ink-muted">{since(h.last_price_at)}</span>
          </p>
        ) : (
          <p className="text-[11px] text-ink-muted">at cost · no price yet</p>
        )}
      </div>
    </div>
  );
}

export default function InvestmentsPage() {
  const [p, setP] = useState<Portfolio | null>(null);

  useEffect(() => {
    getHoldings()
      .then(setP)
      .catch(() =>
        setP({
          holdings: [],
          cost_basis: "0.00",
          market_value: "0.00",
          unrealised: "0.00",
          realised_gain: "0.00",
          unitemised: "0.00",
          all_priced: false,
        }),
      );
  }, []);

  const unrealised = p ? Number(p.unrealised) : 0;
  const realised = p ? Number(p.realised_gain) : 0;
  const unitemised = p ? Number(p.unitemised) : 0;

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader title="Investments" back="/app" />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-[max(env(safe-area-inset-bottom),2rem)]">
        {p === null ? (
          <>
            <SkeletonCard className="h-[74px]" />
            <SkeletonCard className="h-56" />
          </>
        ) : p.holdings.length === 0 && unitemised === 0 ? (
          <Card>
            <CardTitle icon={TrendingUp}>Nothing tracked yet</CardTitle>
            <p className="text-sm text-ink-secondary">
              Say what you bought — &ldquo;10 Reliance at 1,380&rdquo; — and it&apos;s tracked
              by units and average cost. Tell it a price later (&ldquo;Reliance is at
              1,450&rdquo;) and this page shows what it&apos;s worth now.
            </p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="put in" value={<Money value={p.cost_basis} />} />
              <Stat
                label="worth now"
                value={<Money value={p.market_value} />}
                tone={unrealised > 0 ? "positive" : unrealised < 0 ? "negative" : "neutral"}
              />
            </div>

            {/* The delta is the only number here that isn't on another screen. */}
            <Card pad="hero">
              <CardTitle icon={TrendingUp}>Unrealised</CardTitle>
              <p>
                <Money
                  value={p.unrealised}
                  size="hero"
                  signed
                  tone={unrealised > 0 ? "positive" : unrealised < 0 ? "negative" : "neutral"}
                />
              </p>
              <p className="mt-1 text-xs text-ink-secondary">
                {Number(p.cost_basis) > 0
                  ? `${((unrealised / Number(p.cost_basis)) * 100).toFixed(1)}% on what you put in`
                  : "nothing invested yet"}
                {!p.all_priced && p.holdings.length > 0 ? (
                  <> · some holdings carried at cost until you state a price</>
                ) : null}
              </p>
              {realised !== 0 && (
                <p className="mt-2 border-t border-line pt-2 text-[11px] text-ink-secondary">
                  <Money value={p.realised_gain} tone="neutral" signed /> realised on sales so
                  far — money you actually took off the table.
                </p>
              )}
            </Card>

            {p.holdings.length > 0 && (
              <Card>
                <CardTitle icon={Coins}>Holdings</CardTitle>
                {p.holdings.map((h) => (
                  <HoldingRow key={h.symbol} h={h} />
                ))}
              </Card>
            )}

            {unitemised > 0 && (
              <Card quiet>
                <CardTitle icon={Coins}>Not itemised</CardTitle>
                <p className="mb-1">
                  <Money value={p.unitemised} size="lg" />
                </p>
                <p className="text-xs text-ink-secondary">
                  Invested as a rupee amount rather than units — SIPs, FDs, anything bought
                  by category. It counts toward net worth but has no units behind it, so it
                  can&apos;t be valued or itemised here.
                </p>
              </Card>
            )}

            <p className="px-1 text-[11px] text-ink-secondary">
              Cost is a weighted average across your buys, and selling never changes it.
              Prices are whatever you last said — there&apos;s no market feed, which is why
              nothing here can be stale without telling you so.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
