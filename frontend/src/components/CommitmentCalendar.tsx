"use client";

import { useMemo, useState } from "react";
import Money from "@/components/ui/Money";
import { DueItem } from "@/lib/api";

/** The month, with what lands on which day.
 *
 * "day 5" as a bare integer is a fact about a database row, not an answer to
 * "when does my money leave". Laid out against the calendar you can see the
 * clustering — most Indian salaried commitments land in the first week, which
 * is exactly why the middle of the month feels richer than it is.
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** Monday-first; JS getDay() is Sunday-first. */
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

export default function CommitmentCalendar({
  outgoing,
  incoming,
}: {
  outgoing: DueItem[];
  incoming: DueItem[];
}) {
  const [picked, setPicked] = useState<number | null>(null);

  const { cells, byDay, today, monthLabel } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = mondayIndex(new Date(year, month, 1));

    const byDay = new Map<number, { out: DueItem[]; in: DueItem[] }>();
    const add = (item: DueItem, key: "out" | "in") => {
      const due = new Date(`${item.due_on}T00:00:00`);
      // Only this month; the horizon can reach into the next one.
      if (due.getMonth() !== month || due.getFullYear() !== year) return;
      const day = due.getDate();
      if (!byDay.has(day)) byDay.set(day, { out: [], in: [] });
      byDay.get(day)![key].push(item);
    };
    outgoing.forEach((o) => add(o, "out"));
    incoming.forEach((i) => add(i, "in"));

    const cells: (number | null)[] = [
      ...Array(lead).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    return {
      cells,
      byDay,
      today: now.getDate(),
      monthLabel: now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    };
  }, [outgoing, incoming]);

  const shown = picked !== null ? byDay.get(picked) : undefined;

  return (
    <div>
      <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-muted">{monthLabel}</p>

      <div className="grid grid-cols-7 gap-1" aria-hidden>
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="text-center text-[9px] text-ink-muted">
            {d}
          </span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <span key={`pad-${i}`} />;
          const events = byDay.get(day);
          const isToday = day === today;
          const isPicked = day === picked;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setPicked(isPicked ? null : events ? day : null)}
              aria-label={
                events
                  ? `${day}: ${[...events.out, ...events.in].map((e) => e.name).join(", ")}`
                  : `${day}, nothing due`
              }
              className={`flex aspect-square flex-col items-center justify-center rounded-md text-[11px] tabular-nums transition-colors ${
                isPicked
                  ? "bg-surface-raised text-ink-primary"
                  : isToday
                    ? "border border-brand-line text-ink-primary"
                    : events
                      ? "text-ink-primary hover:bg-surface-raised"
                      : "text-ink-muted"
              }`}
            >
              {day}
              {/* Dots, not amounts: the grid answers "when", and the row below
                  answers "how much". Numbers in cells this small are noise. */}
              <span className="mt-0.5 flex h-1 gap-0.5">
                {events?.out.length ? (
                  <span
                    className="size-1 rounded-full"
                    style={{ backgroundColor: "var(--chart-spend)" }}
                  />
                ) : null}
                {events?.in.length ? (
                  <span
                    className="size-1 rounded-full"
                    style={{ backgroundColor: "var(--positive)" }}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {shown ? (
        <div className="mt-3 space-y-1 border-t border-line pt-2">
          {[...shown.in, ...shown.out].map((item) => {
            const inbound = shown.in.includes(item);
            return (
              <div
                key={`${item.name}-${item.due_on}`}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="min-w-0 truncate text-ink-secondary">{item.name}</span>
                <span className={inbound ? "text-positive" : ""}>
                  {inbound ? "+" : "−"}
                  <Money value={item.amount} tone="neutral" />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink-secondary">
          Tap a marked day to see what lands on it.
        </p>
      )}
    </div>
  );
}
