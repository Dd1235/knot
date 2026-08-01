"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card, { CardTitle } from "@/components/ui/Card";
import Link from "next/link";
import DailySpendChart from "@/components/DailySpendChart";
import Logo from "@/components/ui/Logo";
import Money from "@/components/ui/Money";
import SegmentedNav from "@/components/ui/SegmentedNav";
import SpendHeatmap from "@/components/SpendHeatmap";
import CommitmentCalendar from "@/components/CommitmentCalendar";
import Stat from "@/components/ui/Stat";
import Icon from "@/components/ui/Icon";
import {
  ArrowLeftRight,
  Gauge,
  Plus,
  Landmark,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  Download,
  Layers,
  RefreshCw,
  Repeat,
  Store,
  Sun,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { GROUP_COLORS, GROUP_LABELS } from "@/lib/groups";
import {
  AccountBalance,
  AnalyticsSummary,
  CashFloat,
  DailyFlow,
  Insight,
  DueItem,
  LimitsResponse,
  Loan,
  PersonBalance,
  RecurringCommitment,
  Rhythm,
  SafeToSpend,
  downloadCsv,
  generateInsights,
  getAnalytics,
  getBalances,
  getCashFloat,
  clearLimit,
  getLimits,
  getUpcoming,
  setLimit,
  getLoans,
  getRecurring,
  getRhythm,
  getSafeToSpend,
  repayDebt,
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

/** Adding a limit without asking the agent for it. Groups only — a limit per
 *  category would be a form, and the agent is genuinely better at "keep me
 *  under 10k for food" than a dropdown of thirty-three options. */
function NewLimit({
  onSave,
  onCancel,
}: {
  onSave: (amount: number, scope: string, target: string) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState("total");

  const submit = () => {
    const value = Number(amount);
    if (value > 0) onSave(value, target === "total" ? "total" : "group", target === "total" ? "" : target);
  };

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      <div className="flex flex-wrap gap-1">
        {["total", "essentials", "discretionary", "debt"].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTarget(t)}
            className={`rounded-lg px-2 py-1 text-[11px] transition-colors ${
              target === t
                ? "bg-brand font-medium text-ink-on-brand"
                : "border border-line text-ink-secondary hover:bg-surface-raised"
            }`}
          >
            {t === "total" ? "everything" : GROUP_LABELS[t] ?? t}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          inputMode="decimal"
          placeholder="amount per month"
          aria-label="Monthly limit amount"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-2 py-1 text-sm tabular-nums outline-none focus:border-brand-line"
        />
        <Button variant="tonal" tone="brand" onClick={submit}>
          set
        </Button>
        <Button onClick={onCancel} aria-label="Cancel">
          <Icon as={X} size={14} />
        </Button>
      </div>
    </div>
  );
}

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
    <Card pad="hero" className="hairline-gold border-brand-line bg-brand-soft">
      <CardTitle icon={Wallet}>Safe to spend</CardTitle>
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
      <CardTitle icon={Store}>Where you go most</CardTitle>
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
      <CardTitle icon={Sun}>Today</CardTitle>
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
    <Card quiet>
      <CardTitle icon={ArrowLeftRight}>Cash to reconcile</CardTitle>
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
    <Card quiet>
      <CardTitle icon={CalendarClock}>Due next</CardTitle>
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
  const [due, setDue] = useState<{ outgoing: DueItem[]; incoming: DueItem[] } | null>(null);
  const [caps, setCaps] = useState<LimitsResponse | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [debt, setDebt] = useState<{
    loans: Loan[];
    total_outstanding: string;
    monthly_emi: string;
  } | null>(null);
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

  const onSettle = async (person: string, owed: boolean) => {
    const question = owed
      ? `Record that ${person} paid you back in full?`
      : `Record that you paid ${person} back in full?`;
    if (!window.confirm(question)) return;
    setSettling(person);
    try {
      await (owed ? settleUp(person) : repayDebt(person));
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
    getLoans()
      .then(setDebt)
      .catch(() => {});
    getLimits()
      .then(setCaps)
      .catch(() => {});
    getUpcoming()
      .then(setDue)
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
            <Icon as={RefreshCw} size={13} className={insightsBusy ? "animate-spin" : ""} />
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
      <CardTitle icon={Layers}>Spending groups</CardTitle>
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
      <CardTitle icon={ChartColumn}>Top categories</CardTitle>
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
      <Card quiet>
        <CardTitle icon={Users}>Who owes who</CardTitle>
        <div className="space-y-2">
          {people.map((p) => {
            const owed = Number(p.balance) > 0;
            return (
              <div key={p.display_name} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink-secondary">{p.display_name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="tonal"
                    tone={owed ? "positive" : "neutral"}
                    disabled={settling === p.display_name}
                    onClick={() => onSettle(p.display_name, owed)}
                    aria-label={
                      owed
                        ? `Settle up with ${p.display_name}`
                        : `Record repaying ${p.display_name}`
                    }
                  >
                    {owed ? "settle" : "repay"}
                  </Button>
                  <span
                    className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs tabular-nums ${
                      owed
                        ? "border-positive-line bg-positive-soft text-positive"
                        : "border-negative-line bg-negative-soft text-negative"
                    }`}
                  >
                    {/* The label already carries the direction, so the number
                        must not repeat it as a minus sign. */}
                    {owed ? "owes you" : "you owe"}{" "}
                    <Money value={Math.abs(Number(p.balance))} tone="neutral" />
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
      <Card quiet>
        <CardTitle icon={Repeat}>Recurring</CardTitle>
        {recurring.commitments.length === 0 ? (
          <p className="py-3 text-center text-xs text-ink-secondary">
            Tell the agent about subscriptions — e.g. “I pay 649 for Netflix monthly.”
          </p>
        ) : (
          <>
            {due && (due.outgoing.length > 0 || due.incoming.length > 0) ? (
              <div className="mb-3 border-b border-line pb-3">
                <CommitmentCalendar outgoing={due.outgoing} incoming={due.incoming} />
              </div>
            ) : null}
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

  /* Colour the derivative, not the level. Half a limit spent is a crisis on
   * the 5th and unremarkable on the 25th, so the bar shows where you are
   * against the calendar rather than against the total. */
  const saveLimit = async (scope: string, target: string) => {
    const amount = Number(draft);
    if (!(amount > 0)) return setEditing(null);
    setCaps(await setLimit(amount, scope, target).catch(() => caps));
    setEditing(null);
  };

  const removeLimit = async (scope: string, target: string) => {
    setCaps(await clearLimit(scope, target).catch(() => caps));
  };

  const limitsCard =
    caps === null ? null : (
      <Card>
        <CardTitle icon={Gauge}>Monthly limits</CardTitle>
        {caps.limits.length === 0 && editing !== "new" && (
          <p className="mb-2 text-xs text-ink-secondary">
            No caps set. Add one here, or just say &ldquo;keep me under 10k for
            food&rdquo;.
          </p>
        )}
        <div className="space-y-3">
          {caps.limits.map((l) => {
            const tone =
              l.verdict === "over" || l.verdict === "urgent"
                ? "var(--negative)"
                : l.verdict === "ahead"
                  ? "var(--warning)"
                  : "var(--positive)";
            const elapsed = (caps.day / caps.days_in_month) * 100;
            return (
              <div key={`${l.scope}-${l.target}`}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-ink-secondary">
                    {l.scope === "total" ? "everything" : GROUP_LABELS[l.target] ?? l.target}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1.5 text-xs">
                    <Money value={l.spent} tone="neutral" />
                    <span className="text-ink-muted">of</span>
                    {editing === `${l.scope}:${l.target}` ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => saveLimit(l.scope, l.target)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveLimit(l.scope, l.target);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        inputMode="decimal"
                        aria-label={`Limit for ${l.target || "everything"}`}
                        className="w-20 rounded border border-brand-line bg-surface-raised px-1.5 py-0.5 text-right tabular-nums outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(String(Number(l.limit)));
                          setEditing(`${l.scope}:${l.target}`);
                        }}
                        className="rounded px-1 underline decoration-dotted underline-offset-2 hover:bg-surface-raised"
                        aria-label={`Change the limit for ${l.target || "everything"}`}
                      >
                        <Money value={l.limit} tone="neutral" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeLimit(l.scope, l.target)}
                      aria-label={`Remove the limit for ${l.target || "everything"}`}
                      className="text-ink-muted transition-colors hover:text-negative"
                    >
                      <Icon as={X} size={12} />
                    </button>
                  </span>
                </div>
                <div className="relative mt-1 h-2 rounded-full bg-surface-raised">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${Math.min(l.share, 100)}%`, backgroundColor: tone }}
                  />
                  {/* Where the calendar has got to. Being left of this line is
                      the whole definition of on track. */}
                  <span
                    aria-hidden
                    className="absolute top-[-2px] h-3 w-px bg-ink-secondary"
                    style={{ left: `${elapsed}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-ink-secondary">
                  {l.verdict === "over" ? (
                    <span className="text-negative">
                      over, {caps.days_left} day{caps.days_left === 1 ? "" : "s"} left
                    </span>
                  ) : (l.verdict === "urgent" || l.verdict === "ahead") && l.projected ? (
                    <>
                      on for <Money value={l.projected} tone="neutral" /> — ahead of
                      the month
                    </>
                  ) : (
                    <>
                      <Money value={l.left} tone="neutral" /> left ·{" "}
                      {caps.days_left} day{caps.days_left === 1 ? "" : "s"}
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>

        {editing === "new" ? (
          <NewLimit
            onCancel={() => setEditing(null)}
            onSave={async (amount, scope, target) => {
              setCaps(await setLimit(amount, scope, target).catch(() => caps));
              setEditing(null);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-1.5 text-[11px] text-ink-secondary transition-colors hover:bg-surface-raised hover:text-ink-primary"
          >
            <Icon as={Plus} size={12} />
            add a limit
          </button>
        )}
      </Card>
    );

  /* Debt earns rail space only when there is some. The number that matters is
   * not the balance, it is how little of the next payment reduces it. */
  const debtCard =
    debt === null || debt.loans.filter((l) => Number(l.outstanding) > 0).length === 0 ? null : (
      <Card quiet>
        <CardTitle icon={Landmark}>Debt</CardTitle>
        <p className="mb-1">
          <Money value={debt.total_outstanding} size="lg" />
          <span className="ml-2 text-xs text-ink-secondary">owed</span>
        </p>
        {(() => {
          const live = debt.loans.filter((l) => Number(l.outstanding) > 0);
          const principal = live.reduce((n, l) => n + Number(l.next_principal), 0);
          const interest = live.reduce((n, l) => n + Number(l.next_interest), 0);
          const share = principal + interest > 0 ? (principal / (principal + interest)) * 100 : 0;
          return (
            <p className="text-xs text-ink-secondary">
              <Money value={debt.monthly_emi} tone="neutral" />/month, of which{" "}
              <span className="text-ink-primary">{Math.round(share)}%</span> actually
              pays it down
            </p>
          );
        })()}
        <Link
          href="/debts"
          className="mt-2 inline-block border-t border-line pt-2 text-[11px] text-brand-ink"
        >
          See every loan
        </Link>
      </Card>
    );

  const heatmapCard = (
    <Card>
      <CardTitle icon={CalendarDays}>Half a year of spending</CardTitle>
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
        <span className="inline-flex items-center justify-center gap-2">
          <Icon as={Download} size={15} />
          {exporting ? "Exporting…" : "Export CSV (90d)"}
        </span>
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
                {limitsCard}
                <CashCard cash={cash} />
                {debtCard}
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
