"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Logo from "@/components/ui/Logo";
import Money from "@/components/ui/Money";
import SegmentedNav from "@/components/ui/SegmentedNav";
import Stat from "@/components/ui/Stat";
import {
  AnalyticsSummary,
  DailyFlow,
  PersonBalance,
  AccountBalance,
  Insight,
  RecurringCommitment,
  downloadCsv,
  getAnalytics,
  getBalances,
  getRecurring,
  generateInsights,
  settleUp,
  inr,
} from "@/lib/api";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

// Fixed group → color mapping (never index-cycled). `other` is the residual
// bucket and is deliberately achromatic — no fourth hue clears the all-pairs
// CVD floor on this surface, and a residual must never impersonate a series.
const GROUP_COLORS: Record<string, string> = {
  essentials: "var(--chart-1)",
  discretionary: "var(--chart-2)",
  savings_invest: "var(--chart-3)",
  other: "var(--chart-other)",
};

const GROUP_LABELS: Record<string, string> = {
  savings_invest: "savings & invest",
};

const CADENCE_SHORT: Record<string, string> = {
  monthly: "mo",
  weekly: "wk",
  yearly: "yr",
  daily: "day",
};


const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });

// Round up to a "nice" tick maximum whose half is also presentable.
function niceCeil(v: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = [1, 2, 3, 4, 5, 6, 8, 10].find((s) => n <= s) ?? 10;
  return step * pow;
}

const compact = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(v));

// Bar anchored to the baseline with rounded TOP corners only.
function barPath(x: number, y: number, w: number, h: number, baseline: number): string {
  const r = Math.min(2.5, w / 2, h);
  return [
    `M${x.toFixed(2)},${baseline}`,
    `L${x.toFixed(2)},${(y + r).toFixed(2)}`,
    `Q${x.toFixed(2)},${y.toFixed(2)} ${(x + r).toFixed(2)},${y.toFixed(2)}`,
    `L${(x + w - r).toFixed(2)},${y.toFixed(2)}`,
    `Q${(x + w).toFixed(2)},${y.toFixed(2)} ${(x + w).toFixed(2)},${(y + r).toFixed(2)}`,
    `L${(x + w).toFixed(2)},${baseline}`,
    "Z",
  ].join(" ");
}

function DailySpendChart({ daily }: { daily: DailyFlow[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = daily.map((d) => Number(d.spend));
  const rawMax = values.length ? Math.max(...values) : 0;
  const allZero = rawMax <= 0;

  const H = 180;
  const PAD_L = 32;
  const PAD_R = 2;
  const TOP = 34; // headroom so the tooltip fits above the tallest bar
  const BOTTOM = 18;
  const baseline = H - BOTTOM;
  const plotH = baseline - TOP;
  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const n = daily.length;
  const slot = n > 0 ? plotW / n : 0;
  const barW = Math.max(slot - 2, 1); // 2px gap between bars

  const yMax = allZero ? 0 : niceCeil(rawMax);
  const barH = (v: number) => (v <= 0 || yMax === 0 ? 0 : Math.max((v / yMax) * plotH, 1));
  const barTop = (v: number) => baseline - barH(v);
  const colX = (i: number) => PAD_L + i * slot;

  const maxIdx = allZero ? -1 : values.indexOf(rawMax);

  // X labels: first, last, ~2 evenly spaced.
  const last = n - 1;
  const labelIdx =
    n <= 1
      ? [0]
      : Array.from(
          new Set([0, Math.round(last / 3), Math.round((2 * last) / 3), last])
        ).sort((a, b) => a - b);

  const tooltipLeft =
    hover === null ? 0 : Math.min(Math.max(colX(hover) + slot / 2, 48), Math.max(width - 48, 48));

  const maxLabel = allZero ? "" : compact(yMax);
  const midLabel = allZero ? "" : compact(yMax / 2);
  const showMid = !allZero && midLabel !== maxLabel && midLabel !== "0";

  return (
    <div ref={containerRef} className="relative" style={{ height: H }}>
      {width > 0 && (
        <>
          <svg width={width} height={H} className="block">
            {/* gridlines: hairlines at max + mid only; the baseline is its own stroke */}
            {!allZero && (
              <>
                <line x1={PAD_L} x2={width - PAD_R} y1={TOP} y2={TOP} className="stroke-chart-grid" strokeWidth={1} />
                <line
                  x1={PAD_L}
                  x2={width - PAD_R}
                  y1={TOP + plotH / 2}
                  y2={TOP + plotH / 2}
                  className="stroke-chart-grid"
                  strokeWidth={1}
                />
              </>
            )}
            {/* bars */}
            {!allZero &&
              daily.map((d, i) => {
                const h = barH(values[i]);
                if (h <= 0) return null;
                return (
                  <path
                    key={d.date}
                    d={barPath(colX(i) + 1, barTop(values[i]), barW, h, baseline)}
                    className="fill-chart-spend"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                );
              })}
            {/* baseline */}
            <line x1={PAD_L} x2={width - PAD_R} y1={baseline} y2={baseline} className="stroke-chart-axis" strokeWidth={1} />
            {/* one y-axis: 3 tick labels max */}
            <text x={PAD_L - 6} y={baseline} dy="3.5" textAnchor="end" fontSize={10} className="fill-chart-tick tabular-nums">
              0
            </text>
            {showMid && (
              <text
                x={PAD_L - 6}
                y={TOP + plotH / 2}
                dy="3.5"
                textAnchor="end"
                fontSize={10}
                className="fill-chart-tick tabular-nums"
              >
                {midLabel}
              </text>
            )}
            {!allZero && (
              <text x={PAD_L - 6} y={TOP} dy="3.5" textAnchor="end" fontSize={10} className="fill-chart-tick tabular-nums">
                {maxLabel}
              </text>
            )}
            {/* x labels */}
            {labelIdx.map((i) => (
              <text
                key={i}
                x={i === 0 ? colX(i) + 1 : i === last ? colX(i) + slot - 1 : colX(i) + slot / 2}
                y={H - 4}
                textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}
                fontSize={10}
                className="fill-chart-tick tabular-nums"
              >
                {shortDate(daily[i].date)}
              </text>
            ))}
            {/* direct-label ONLY the max bar */}
            {maxIdx >= 0 && hover === null && (
              <text
                x={Math.min(Math.max(colX(maxIdx) + slot / 2, PAD_L + 12), width - 14)}
                y={barTop(rawMax) - 4}
                textAnchor="middle"
                fontSize={10}
                className="fill-chart-label tabular-nums"
              >
                {`₹${compact(rawMax)}`}
              </text>
            )}
          </svg>

          {allZero && (
            <p className="absolute inset-x-0 top-[45%] -translate-y-1/2 text-center text-xs text-ink-secondary">
              No spends in this period.
            </p>
          )}

          {/* hover/tap layer — the hit target is the full column height */}
          {!allZero && n > 0 && (
            <div
              className="absolute flex"
              style={{ left: PAD_L, width: plotW, top: TOP, height: plotH }}
              onMouseLeave={() => setHover(null)}
            >
              {daily.map((d, i) => (
                <button
                  key={d.date}
                  type="button"
                  aria-label={`${shortDate(d.date)}: ${inr(d.spend)}`}
                  className="h-full flex-1 cursor-default"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onTouchStart={() => setHover(hover === i ? null : i)}
                />
              ))}
            </div>
          )}

          {hover !== null && daily[hover] && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line-strong bg-surface-raised px-2 py-1 text-[11px] text-ink-primary tabular-nums"
              style={{ left: tooltipLeft, top: barTop(values[hover]) - 6 }}
            >
              {shortDate(daily[hover].date)} — <Money value={values[hover]} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[11px] uppercase tracking-wide text-ink-secondary">{children}</p>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-line bg-surface-card p-3">{children}</div>;
}

function SkeletonCard({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-xl border border-line bg-surface-card ${className}`} />
  );
}

export default function InsightsPage() {
  const [days, setDays] = useState<Period>(30);
  // Result of the last completed fetch; loading is derived, never set synchronously.
  const [result, setResult] = useState<{
    days: number;
    summary: AnalyticsSummary | null;
  } | null>(null);
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [recurring, setRecurring] = useState<{
    commitments: RecurringCommitment[];
    monthly_total: string;
  } | null>(null);
  const [people, setPeople] = useState<PersonBalance[] | null>(null);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [settling, setSettling] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  useEffect(() => {
    let stale = false;
    getAnalytics(days)
      .then((s) => {
        if (!stale) setResult({ days, summary: s });
      })
      .catch(() => {
        if (!stale) setResult({ days, summary: null });
      });
    return () => {
      stale = true;
    };
  }, [days]);

  const loading = result === null || result.days !== days;
  const summary = loading ? null : result.summary;

  const refreshBalances = () =>
    getBalances()
      .then((b) => {
        setPeople(b.people.filter((p) => Number(p.balance) !== 0));
        setAccounts(b.accounts);
      })
      .catch(() => {});

  const onSettle = async (person: string, balance: string) => {
    if (!window.confirm(`Record that ${person} paid you back in full?`)) return;
    setSettling(person);
    try {
      await settleUp(person);
      await refreshBalances();
    } finally {
      setSettling(null);
    }
  };

  const loadInsights = (refresh: boolean) => {
    setInsightsBusy(true);
    generateInsights(days, refresh)
      .then((r) => setInsights(r.insights))
      .catch(() => setInsights([]))
      .finally(() => setInsightsBusy(false));
  };

  useEffect(() => {
    loadInsights(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getRecurring()
      .then(setRecurring)
      .catch(() => setRecurring({ commitments: [], monthly_total: "0.00" }));
    getBalances()
      .then((b) => {
        setPeople(b.people.filter((p) => Number(p.balance) !== 0));
        setAccounts(b.accounts);
      })
      .catch(() => setPeople([]));
  }, []);

  const onExport = async () => {
    setExporting(true);
    setExportError(false);
    try {
      await downloadCsv(90);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  const net = summary ? Number(summary.net_cashflow) : 0;
  const maxGroup = summary?.by_group.length
    ? Math.max(...summary.by_group.map((g) => Number(g.amount)))
    : 0;
  const categories = summary?.by_category.slice(0, 8) ?? [];
  const maxCategory = categories.length
    ? Math.max(...categories.map((c) => Number(c.amount)))
    : 0;

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader title="Insights" back="/app">
        <SegmentedNav
          items={PERIODS.map((p) => ({ id: String(p), label: `${p} days` }))}
          value={String(days)}
          onChange={(id) => setDays(Number(id) as Period)}
          label="Time period"
          className="pb-2"
        />
      </AppHeader>

      <main className="mx-auto w-full max-w-lg flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {loading ? (
          <>
            {(insights === null || insights.length > 0 || insightsBusy) && (
              <div className="hairline-gold rounded-xl border border-brand-line bg-brand-soft p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-brand-ink">
                    <Logo size={13} state={insightsBusy ? "thinking" : "idle"} />
                    What I notice
                  </h2>
                  <Button
                    onClick={() => loadInsights(true)}
                    disabled={insightsBusy}
                    aria-label="Regenerate insights"
                  >
                    ↻
                  </Button>
                </div>
                {insights === null || insightsBusy ? (
                  <p className="py-2 text-center text-xs text-ink-secondary">
                    reading your books…
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {insights.map((it, i) => (
                      <li key={i} className="flex gap-2 text-sm text-ink-primary">
                        <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
                        <span>{it.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <SkeletonCard className="h-[74px]" />
              <SkeletonCard className="h-[74px]" />
              <SkeletonCard className="h-[74px]" />
              <SkeletonCard className="h-[74px]" />
            </div>
            <SkeletonCard className="h-56" />
            <SkeletonCard className="h-36" />
            <SkeletonCard className="h-40" />
          </>
        ) : !summary ? (
          <p className="mt-10 text-center text-sm text-ink-secondary">
            Couldn&apos;t load insights — check the connection and switch periods to retry.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="spent" value={<Money value={summary.total_spend} />} />
              <Stat label="income" value={<Money value={summary.total_income} />} />
              <Stat
                label="net cashflow"
                value={<Money value={summary.net_cashflow} signed />}
                tone={net > 0 ? "positive" : net < 0 ? "negative" : "neutral"}
              />
              <Stat label="net worth" value={<Money value={summary.net_worth.net_worth} />} />
            </div>

            <Card>
              <CardTitle>Position</CardTitle>
              <dl className="divide-y divide-line text-sm">
                {[
                  { label: "assets", value: summary.net_worth.assets },
                  { label: "liabilities", value: summary.net_worth.liabilities },
                  {
                    // Every spendable account, not just the one named "cash" —
                    // an opening balance usually lands in "bank".
                    label: "in accounts",
                    value: String(
                      accounts
                        .filter((a) => a.type === "asset")
                        .reduce((sum, a) => sum + Number(a.balance), 0),
                    ),
                  },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between py-1.5">
                    <dt className="text-ink-secondary">{row.label}</dt>
                    <dd>
                      <Money value={row.value} />
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>

            <Card>
              <CardTitle>Daily spend · last {summary.window_days} days</CardTitle>
              <DailySpendChart daily={summary.daily} />
            </Card>

            <Card>
              <CardTitle>Spending groups</CardTitle>
              {summary.by_group.length === 0 ? (
                <p className="py-3 text-center text-xs text-ink-secondary">
                  No spending yet in this window.
                </p>
              ) : (
                <div className="space-y-3">
                  {summary.by_group.map((g) => (
                    <div key={g.grp}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-ink-secondary">
                          {GROUP_LABELS[g.grp] ?? g.grp}
                        </span>
                        <span className="shrink-0">
                          <Money value={g.amount} />{" "}
                          <span className="text-[11px] text-ink-secondary">
                            {Math.round(g.pct_of_spend * 10) / 10}%
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-surface-raised">
                        <div
                          className="h-2 rounded-full"
                          style={{
                            width: `${maxGroup > 0 ? Math.max((Number(g.amount) / maxGroup) * 100, 2) : 0}%`,
                            backgroundColor: GROUP_COLORS[g.grp] ?? GROUP_COLORS.other,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardTitle>Top categories</CardTitle>
              {categories.length === 0 ? (
                <p className="py-3 text-center text-xs text-ink-secondary">
                  Nothing spent yet — record a transaction in chat.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {categories.map((c) => (
                    <div key={c.category} className="flex items-center gap-2.5 text-sm">
                      <span className="w-24 shrink-0 truncate text-ink-secondary">{c.category}</span>
                      <div className="h-1 min-w-0 flex-1 rounded-full bg-surface-raised">
                        <div
                          className="h-1 rounded-full"
                          style={{
                            width: `${maxCategory > 0 ? Math.max((Number(c.amount) / maxCategory) * 100, 2) : 0}%`,
                            backgroundColor: "var(--chart-spend)",
                          }}
                        />
                      </div>
                      <span className="shrink-0 text-right">
                        <Money value={c.amount} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}

        {recurring === null ? (
          <SkeletonCard className="h-28" />
        ) : (
          <Card>
            <CardTitle>Recurring</CardTitle>
            {recurring.commitments.length === 0 ? (
              <p className="py-3 text-center text-xs text-ink-secondary">
                Tell the agent about subscriptions — e.g. “I pay 649 for Netflix monthly.”
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {recurring.commitments.map((c) => (
                    <div
                      key={c.id}
                      className={`flex items-center justify-between gap-3 text-sm ${
                        c.active ? "" : "opacity-50"
                      }`}
                    >
                      <span className="min-w-0 truncate text-ink-secondary">{c.name}</span>
                      <span className="shrink-0">
                        <Money value={c.amount} />
                        <span className="text-[11px] text-ink-secondary">
                          /{CADENCE_SHORT[c.cadence] ?? c.cadence} · day {c.due_day}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 border-t border-line pt-2 text-right text-xs text-ink-secondary">
                  ≈ <Money value={recurring.monthly_total} tone="neutral" />
                  /month committed
                </p>
              </>
            )}
          </Card>
        )}

        {people === null ? (
          <SkeletonCard className="h-24" />
        ) : (
          <Card>
            <CardTitle>Receivables</CardTitle>
            {people.length === 0 ? (
              <p className="py-3 text-center text-xs text-ink-secondary">
                All settled — no one owes anyone.
              </p>
            ) : (
              <div className="space-y-2">
                {people.map((p) => {
                  const owed = Number(p.balance) > 0;
                  return (
                    <div
                      key={p.display_name}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 truncate text-ink-secondary">{p.display_name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {owed && (
                          <Button
                            variant="tonal"
                            tone="positive"
                            disabled={settling === p.display_name}
                            onClick={() => onSettle(p.display_name, p.balance)}
                            aria-label={`Settle up with ${p.display_name}`}
                          >
                            settle
                          </Button>
                        )}
                        <span
                          className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs tabular-nums ${
                            owed
                              ? "border-positive-line bg-positive-soft text-positive"
                              : "border-negative-line bg-negative-soft text-negative"
                          }`}
                        >
                          {owed ? "owes you" : "you owe"}{" "}
                          <Money value={p.balance} tone="neutral" />
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        <button
          onClick={onExport}
          disabled={exporting}
          className="w-full rounded-xl border border-line bg-surface-card py-3 text-sm text-ink-secondary active:bg-surface-card disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "⬇ Export CSV (90d)"}
        </button>
        {exportError && (
          <p className="text-center text-xs text-negative">Export failed — try again.</p>
        )}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </main>
    </div>
  );
}
