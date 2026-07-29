"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card, { CardTitle } from "@/components/ui/Card";
import DailySpendChart from "@/components/DailySpendChart";
import Logo from "@/components/ui/Logo";
import Money from "@/components/ui/Money";
import SegmentedNav from "@/components/ui/SegmentedNav";
import SpendHeatmap from "@/components/SpendHeatmap";
import Stat from "@/components/ui/Stat";
import { GROUP_COLORS, GROUP_LABELS } from "@/lib/groups";
import {
  AccountBalance,
  AnalyticsSummary,
  CashFloat,
  DailyFlow,
  Insight,
  PersonBalance,
  RecurringCommitment,
  Rhythm,
  SafeToSpend,
  downloadCsv,
  generateInsights,
  getAnalytics,
  getBalances,
  getCashFloat,
  getRecurring,
  getRhythm,
  getSafeToSpend,
  settleUp,
} from "@/lib/api";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/** Half a year of days for the heatmap — enough columns to show a rhythm,
 * few enough to stay readable on a phone in landscape. */
const HEATMAP_DAYS = 182;

const CADENCE_SHORT: Record<string, string> = {
  monthly: "mo",
  weekly: "wk",
  yearly: "yr",
  daily: "day",
};

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function SkeletonCard({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-xl border border-line bg-surface-card ${className}`} />
  );
}

/** A number the user can act on today, with the arithmetic shown rather than
 * asserted. Every other module on this page is an autopsy. */
function SafeToSpendCard({ data }: { data: SafeToSpend | null }) {
  if (!data) return <SkeletonCard className="h-32" />;
  const available = Number(data.available);
  return (
    <Card className="hairline-gold border-brand-line bg-brand-soft">
      <CardTitle>Safe to spend</CardTitle>
      <p className="mb-1">
        <Money
          value={data.available}
          size="hero"
          tone={available < 0 ? "negative" : "auto"}
        />
      </p>
      {data.next_income ? (
        <p className="text-xs text-ink-secondary">
          until {data.next_income.name.toLowerCase()} in {data.next_income.in_days} day
          {data.next_income.in_days === 1 ? "" : "s"}
          {data.per_day ? (
            <>
              {" · "}
              <span className="text-ink-primary">
                <Money value={data.per_day} tone="neutral" />
              </span>
              /day
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-xs text-ink-secondary">
          Tell the agent when you get paid and this becomes a countdown.
        </p>
      )}
      <p className="mt-2 border-t border-brand-line pt-2 text-[11px] text-ink-secondary">
        <Money value={data.liquid} tone="neutral" /> in accounts −{" "}
        <Money value={data.claimed} tone="neutral" /> already claimed
      </p>
    </Card>
  );
}

/** Merchants ranked by how OFTEN, not how much. 76% of UPI payments are under
 * ₹500 — sorting by rupees renders the user's actual daily life invisible. */
function FrequencyCard({ rhythm }: { rhythm: Rhythm | null }) {
  if (!rhythm) return <SkeletonCard className="h-56" />;
  const top = rhythm.top_merchants.slice(0, 7);
  const maxTimes = top.length ? Math.max(...top.map((m) => m.times)) : 0;
  return (
    <Card>
      <CardTitle>Where you go most</CardTitle>
      {top.length === 0 ? (
        <p className="py-3 text-center text-xs text-ink-secondary">
          Nothing recorded in this window yet.
        </p>
      ) : (
        <div className="space-y-2">
          {top.map((m) => (
            <div key={m.merchant} className="flex items-center gap-2.5 text-sm">
              <span className="w-24 shrink-0 truncate text-ink-secondary" title={m.merchant}>
                {m.merchant}
              </span>
              <div className="h-1.5 min-w-0 flex-1 rounded-full bg-surface-raised">
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${maxTimes > 0 ? Math.max((m.times / maxTimes) * 100, 3) : 0}%`,
                    backgroundColor: GROUP_COLORS[m.grp] ?? GROUP_COLORS.other,
                  }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-ink-primary">
                {m.times}×
              </span>
              <span className="w-20 shrink-0 text-right text-xs">
                <Money value={m.amount} />
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2.5 border-t border-line pt-2 text-[11px] text-ink-secondary">
        {rhythm.transactions} payments over {rhythm.active_days} active days ·{" "}
        {rhythm.per_active_day}/day · {rhythm.no_spend_days} quiet
      </p>
    </Card>
  );
}

/** Today against this weekday's own median. The only module that changes
 * daily for someone making 10–12 payments a day. */
function TodayCard({ rhythm, daily }: { rhythm: Rhythm | null; daily: DailyFlow[] }) {
  if (!rhythm || daily.length === 0) return <SkeletonCard className="h-28" />;
  const today = daily[daily.length - 1];
  const spent = Number(today.spend);
  const dow = (new Date(`${today.date}T00:00:00`).getDay() + 6) % 7;
  const row = rhythm.by_weekday.find((w) => w.dow === dow);
  const typical = row ? Number(row.typical) : 0;
  const enough = row && row.days_seen >= 3 && typical > 0;
  const ratio = enough ? spent / typical : null;

  return (
    <Card>
      <CardTitle>Today</CardTitle>
      <p className="mb-1">
        <Money value={today.spend} size="lg" />
        {today.txns > 0 ? (
          <span className="ml-2 text-xs text-ink-secondary">
            {today.txns} payment{today.txns === 1 ? "" : "s"}
          </span>
        ) : null}
      </p>
      {enough ? (
        <p className="text-xs text-ink-secondary">
          you usually do <Money value={row.typical} tone="neutral" /> on a {DOW[dow]}
          {ratio !== null && ratio > 1.35 ? (
            <span className="text-ink-primary"> · running hot</span>
          ) : ratio !== null && ratio < 0.65 ? (
            <span className="text-positive"> · lighter than usual</span>
          ) : null}
        </p>
      ) : (
        <p className="text-xs text-ink-secondary">
          A few more {DOW[dow]}s and this gets a baseline to compare against.
        </p>
      )}
    </Card>
  );
}

/** Cash withdrawn but never accounted for. Structurally impossible for a
 * bank-feed app to answer, and answerable here only because logging it is a
 * sentence of speech rather than a form. */
function CashCard({ cash }: { cash: CashFloat | null }) {
  if (!cash) return <SkeletonCard className="h-24" />;
  const unaccounted = Number(cash.unaccounted);
  if (Number(cash.withdrawn) === 0) return null;
  return (
    <Card>
      <CardTitle>Cash to reconcile</CardTitle>
      <p className="mb-1">
        <Money value={cash.unaccounted} size="lg" />
      </p>
      <p className="text-xs text-ink-secondary">
        <Money value={cash.withdrawn} tone="neutral" /> withdrawn ·{" "}
        <Money value={cash.accounted} tone="neutral" /> logged
      </p>
      {unaccounted > 0 ? (
        <p className="mt-2 border-t border-line pt-2 text-[11px] text-ink-secondary">
          Say “paid 200 cash for vegetables” and this comes down.
        </p>
      ) : null}
    </Card>
  );
}

function UpcomingCard({ safe }: { safe: SafeToSpend | null }) {
  if (!safe) return <SkeletonCard className="h-32" />;
  if (safe.upcoming.length === 0) return null;
  return (
    <Card>
      <CardTitle>Due next</CardTitle>
      <div className="space-y-1.5">
        {safe.upcoming.map((d) => (
          <div key={`${d.name}-${d.due_on}`} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink-secondary">{d.name}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="text-[11px] tabular-nums text-ink-muted">
                {d.in_days === 0 ? "today" : `${d.in_days}d`}
              </span>
              <Money value={d.amount} />
            </span>
          </div>
        ))}
      </div>
    </Card>
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
  const [insightsBusy, setInsightsBusy] = useState(true);
  const [recurring, setRecurring] = useState<{
    commitments: RecurringCommitment[];
    monthly_total: string;
  } | null>(null);
  const [people, setPeople] = useState<PersonBalance[] | null>(null);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [rhythm, setRhythm] = useState<Rhythm | null>(null);
  const [safe, setSafe] = useState<SafeToSpend | null>(null);
  const [cash, setCash] = useState<CashFloat | null>(null);
  const [heat, setHeat] = useState<DailyFlow[] | null>(null);
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
    getRhythm(days)
      .then((r) => {
        if (!stale) setRhythm(r);
      })
      .catch(() => {});
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

  const onSettle = async (person: string) => {
    if (!window.confirm(`Record that ${person} paid you back in full?`)) return;
    setSettling(person);
    try {
      await settleUp(person);
      await refreshBalances();
    } finally {
      setSettling(null);
    }
  };

  const fetchInsights = (refresh: boolean) =>
    generateInsights(days, refresh)
      .then((r) => setInsights(r.insights))
      .catch(() => setInsights([]))
      .finally(() => setInsightsBusy(false));

  // Only the user-initiated path flips the flag; on mount it starts true.
  const loadInsights = (refresh: boolean) => {
    setInsightsBusy(true);
    fetchInsights(refresh);
  };

  useEffect(() => {
    fetchInsights(false);
    getRecurring()
      .then(setRecurring)
      .catch(() => setRecurring({ commitments: [], monthly_total: "0.00" }));
    getBalances()
      .then((b) => {
        setPeople(b.people.filter((p) => Number(p.balance) !== 0));
        setAccounts(b.accounts);
      })
      .catch(() => setPeople([]));
    getSafeToSpend()
      .then(setSafe)
      .catch(() => {});
    getCashFloat()
      .then(setCash)
      .catch(() => {});
    // The heatmap spans half a year regardless of the period selector, so it
    // is fetched once rather than on every period change.
    getAnalytics(HEATMAP_DAYS)
      .then((s) => setHeat(s.daily))
      .catch(() => setHeat([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const inAccounts = String(
    accounts.filter((a) => a.type === "asset").reduce((sum, a) => sum + Number(a.balance), 0),
  );

  /* The AI card lives here, outside every loading branch — it has its own
   * fetch and its own lifecycle, and used to unmount the moment the analytics
   * request resolved. */
  const aiCard =
    insights === null || insights.length > 0 || insightsBusy ? (
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
          <p className="py-2 text-center text-xs text-ink-secondary">reading your books…</p>
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
    ) : null;

  const groupsCard = (
    <Card>
      <CardTitle>Spending groups</CardTitle>
      {!summary || summary.by_group.length === 0 ? (
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
  );

  const categoriesCard = (
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
                    backgroundColor: GROUP_COLORS[c.grp] ?? GROUP_COLORS.other,
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
  );

  const peopleCard =
    people === null ? (
      <SkeletonCard className="h-24" />
    ) : people.length === 0 ? null : (
      <Card>
        <CardTitle>Who owes who</CardTitle>
        <div className="space-y-2">
          {people.map((p) => {
            const owed = Number(p.balance) > 0;
            return (
              <div key={p.display_name} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink-secondary">{p.display_name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {owed && (
                    <Button
                      variant="tonal"
                      tone="positive"
                      disabled={settling === p.display_name}
                      onClick={() => onSettle(p.display_name)}
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
                    {owed ? "owes you" : "you owe"} <Money value={p.balance} tone="neutral" />
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    );

  const recurringCard =
    recurring === null ? (
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
    );

  const heatmapCard = (
    <Card>
      <CardTitle>Half a year of spending</CardTitle>
      {heat === null ? (
        <div className="h-24 animate-pulse rounded-lg bg-surface-raised" />
      ) : (
        <SpendHeatmap days={heat} weeks={26} />
      )}
    </Card>
  );

  const statsRow = (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {loading || !summary ? (
        <>
          <SkeletonCard className="h-[74px]" />
          <SkeletonCard className="h-[74px]" />
          <SkeletonCard className="h-[74px]" />
          <SkeletonCard className="h-[74px]" />
        </>
      ) : (
        <>
          <Stat label="spent" value={<Money value={summary.total_spend} />} />
          <Stat label="income" value={<Money value={summary.total_income} />} />
          <Stat
            label="invested"
            value={<Money value={summary.total_invested} />}
            tone={Number(summary.total_invested) > 0 ? "positive" : "neutral"}
          />
          <Stat
            label="net cashflow"
            value={<Money value={summary.net_cashflow} signed />}
            tone={net > 0 ? "positive" : net < 0 ? "negative" : "neutral"}
          />
        </>
      )}
    </div>
  );

  /* Net worth barely moves and changes no decision — one quiet row, not a
   * hero tile. */
  const positionRow = summary ? (
    <Card>
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        {[
          { label: "net worth", value: summary.net_worth.net_worth },
          { label: "assets", value: summary.net_worth.assets },
          { label: "liabilities", value: summary.net_worth.liabilities },
          { label: "in accounts", value: inAccounts },
        ].map((row) => (
          <div key={row.label} className="flex items-baseline gap-1.5">
            <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{row.label}</dt>
            <dd>
              <Money value={row.value} />
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  ) : null;

  const exportRow = (
    <>
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
    </>
  );

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

      <main className="mx-auto w-full max-w-lg flex-1 overflow-y-auto px-4 py-4 lg:max-w-[1400px] lg:px-6">
        {!loading && !summary ? (
          <p className="mt-10 text-center text-sm text-ink-secondary">
            Couldn&apos;t load insights — check the connection and switch periods to retry.
          </p>
        ) : (
          <>
            {/* Phone: one column, most actionable first. Desktop: an 8/4 split
                with everything you can act on today held in the right rail. */}
            <div className="space-y-3 lg:grid lg:grid-cols-12 lg:items-start lg:gap-4 lg:space-y-0">
              <div className="space-y-3 lg:col-span-8">
                <div className="lg:hidden">
                  <SafeToSpendCard data={safe} />
                </div>
                <div className="lg:hidden">{aiCard}</div>

                {statsRow}
                {heatmapCard}

                <Card>
                  <CardTitle>Daily spend · last {days} days</CardTitle>
                  {loading || !summary ? (
                    <div className="h-[180px] animate-pulse rounded-lg bg-surface-raised lg:h-[240px]" />
                  ) : (
                    <>
                      <div className="lg:hidden">
                        <DailySpendChart daily={summary.daily} />
                      </div>
                      <div className="hidden lg:block">
                        <DailySpendChart daily={summary.daily} height={240} />
                      </div>
                    </>
                  )}
                </Card>

                <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
                  <FrequencyCard rhythm={rhythm} />
                  <div className="space-y-3">
                    <TodayCard rhythm={rhythm} daily={summary?.daily ?? []} />
                    {groupsCard}
                  </div>
                </div>

                {categoriesCard}
                {positionRow}
                <div className="lg:hidden">{exportRow}</div>
              </div>

              <aside className="space-y-3 lg:col-span-4 lg:sticky lg:top-0">
                <div className="hidden lg:block">
                  <SafeToSpendCard data={safe} />
                </div>
                <div className="hidden lg:block">{aiCard}</div>
                <UpcomingCard safe={safe} />
                {peopleCard}
                <CashCard cash={cash} />
                {recurringCard}
                <div className="hidden lg:block">{exportRow}</div>
              </aside>
            </div>
          </>
        )}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </main>
    </div>
  );
}
