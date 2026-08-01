"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card, { CardTitle } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import Money from "@/components/ui/Money";
import Stat from "@/components/ui/Stat";
import {
  Loan,
  PersonBalance,
  getBalances,
  getLoans,
  repayDebt,
  settleUp,
} from "@/lib/api";
import { CalendarClock, Landmark, Users } from "lucide-react";

function SkeletonCard({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-xl border border-line bg-surface-card ${className}`} />
  );
}

function payoffLabel(monthsLeft: number | null): string {
  if (monthsLeft === null) return "never, at this payment";
  if (monthsLeft === 0) return "cleared";
  const done = new Date();
  done.setMonth(done.getMonth() + monthsLeft);
  const when = done.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  const years = Math.floor(monthsLeft / 12);
  const months = monthsLeft % 12;
  const span =
    years > 0 ? `${years}y${months ? ` ${months}m` : ""}` : `${monthsLeft}m`;
  return `${span} left · ${when}`;
}

/** One loan, and the thing no other app shows: how little of this month's
 * payment is actually paying the loan down. */
function LoanCard({ loan }: { loan: Loan }) {
  const principal = Number(loan.next_principal);
  const interest = Number(loan.next_interest);
  const payment = principal + interest;
  const share = payment > 0 ? (principal / payment) * 100 : 0;
  const cleared = Number(loan.outstanding) <= 0;

  return (
    <Card className={cleared ? "opacity-60" : ""}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <Icon as={Landmark} size={14} className="shrink-0 text-ink-muted" />
          <span className="truncate">{loan.name}</span>
        </h3>
        <span className="shrink-0 text-[11px] text-ink-muted">
          {/* DECIMAL(6,3) arrives as "11.500"; nobody writes a rate that way. */}
          {Number(loan.annual_rate)}% · day {loan.due_day}
        </span>
      </div>

      <p>
        <Money value={loan.outstanding} size="lg" />
        <span className="ml-2 text-xs text-ink-secondary">still owed</span>
      </p>
      <p className="mt-0.5 text-xs text-ink-secondary">
        {payoffLabel(loan.months_remaining)}
      </p>

      {!cleared && (
        <>
          {/* The split bar. An EMI looks like one number and is really two,
              and early on the smaller half is the part that pays it off. */}
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-2"
              style={{ width: `${share}%`, backgroundColor: "var(--positive)" }}
            />
            <div
              className="h-2"
              style={{ width: `${100 - share}%`, backgroundColor: "var(--chart-4)" }}
            />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <span
                aria-hidden
                className="size-2 rounded-xs"
                style={{ backgroundColor: "var(--positive)" }}
              />
              <Money value={loan.next_principal} tone="neutral" /> off the debt
            </span>
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <span
                aria-hidden
                className="size-2 rounded-xs"
                style={{ backgroundColor: "var(--chart-4)" }}
              />
              <Money value={loan.next_interest} tone="neutral" /> interest
            </span>
          </div>
          <p className="mt-2 border-t border-line pt-2 text-[11px] text-ink-secondary">
            Next payment <Money value={String(payment)} tone="neutral" /> — only{" "}
            <span className="text-ink-primary">{Math.round(share)}%</span> of it
            reduces what you owe. The rest is the price of borrowing.
          </p>
        </>
      )}
    </Card>
  );
}

export default function DebtsPage() {
  const [data, setData] = useState<{
    loans: Loan[];
    total_outstanding: string;
    monthly_emi: string;
  } | null>(null);
  const [people, setPeople] = useState<PersonBalance[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    getLoans()
      .then(setData)
      .catch(() => setData({ loans: [], total_outstanding: "0.00", monthly_emi: "0.00" }));
    getBalances()
      .then((b) => setPeople(b.people.filter((p) => Number(p.balance) !== 0)))
      .catch(() => setPeople([]));
  };

  useEffect(refresh, []);

  const onSettle = async (person: string, owedToUser: boolean) => {
    const verb = owedToUser ? `Record that ${person} paid you back in full?` : `Record that you paid ${person} back in full?`;
    if (!window.confirm(verb)) return;
    setBusy(person);
    try {
      await (owedToUser ? settleUp(person) : repayDebt(person));
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const loans = data?.loans ?? [];
  const active = loans.filter((l) => Number(l.outstanding) > 0);
  const owed = (people ?? []).filter((p) => Number(p.balance) < 0);
  const owing = (people ?? []).filter((p) => Number(p.balance) > 0);

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader
        measure="max-w-2xl" title="Debt" back="/app" />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-[max(env(safe-area-inset-bottom),2rem)]">
        {data === null ? (
          <>
            <SkeletonCard className="h-[74px]" />
            <SkeletonCard className="h-40" />
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat
                label="still owed"
                value={<Money value={data.total_outstanding} />}
                tone={Number(data.total_outstanding) > 0 ? "negative" : "neutral"}
              />
              <Stat label="per month" value={<Money value={data.monthly_emi} />} />
            </div>

            {active.length === 0 && loans.length === 0 ? (
              <Card>
                <CardTitle icon={Landmark}>No loans tracked</CardTitle>
                <p className="text-sm text-ink-secondary">
                  Tell the agent about one — &ldquo;I have a 5 lakh car loan at 9% for 5
                  years&rdquo; — and each EMI will post itself, split into what pays the
                  loan down and what it costs to borrow.
                </p>
              </Card>
            ) : (
              loans.map((loan) => <LoanCard key={loan.id} loan={loan} />)
            )}
          </>
        )}

        {/* People, not banks. A negative balance means you owe them. */}
        {people !== null && (owed.length > 0 || owing.length > 0) && (
          <Card>
            <CardTitle icon={Users}>People</CardTitle>
            <div className="space-y-2">
              {owed.map((p) => (
                <div key={p.display_name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-ink-secondary">
                    you owe {p.display_name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="tonal"
                      disabled={busy === p.display_name}
                      onClick={() => onSettle(p.display_name, false)}
                      aria-label={`Repay ${p.display_name}`}
                    >
                      repay
                    </Button>
                    <span className="whitespace-nowrap rounded-full border border-negative-line bg-negative-soft px-2.5 py-1 text-xs tabular-nums text-negative">
                      <Money value={String(Math.abs(Number(p.balance)))} tone="neutral" />
                    </span>
                  </span>
                </div>
              ))}
              {owing.map((p) => (
                <div key={p.display_name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-ink-secondary">
                    {p.display_name} owes you
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="tonal"
                      tone="positive"
                      disabled={busy === p.display_name}
                      onClick={() => onSettle(p.display_name, true)}
                      aria-label={`Settle with ${p.display_name}`}
                    >
                      settle
                    </Button>
                    <span className="whitespace-nowrap rounded-full border border-positive-line bg-positive-soft px-2.5 py-1 text-xs tabular-nums text-positive">
                      <Money value={p.balance} tone="neutral" />
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {active.length > 0 && (
          <p className="flex items-start gap-1.5 px-1 text-[11px] text-ink-secondary">
            <Icon as={CalendarClock} size={12} className="mt-0.5 shrink-0" />
            EMIs post themselves each period. Only the interest counts as spending —
            the principal moves money from one side of your balance sheet to the other,
            which is why your spending total is lower than your bank statement.
          </p>
        )}
      </main>
    </div>
  );
}
