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

/** Six weeks, starting from the Monday of this week.
 *
 * This used to render the current calendar month, which meant that from about
 * the 6th onward it was blank: every monthly commitment had already passed
 * this month and its next occurrence fell in the next one, which the grid
 * refused to draw. A commitment calendar that is empty for three weeks out of
 * four is answering the wrong question — "what does this month look like" —
 * when the one that matters is "what is coming". */
const WEEKS = 6;
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function CommitmentCalendar({
  outgoing,
  incoming,
}: {
  outgoing: DueItem[];
  incoming: DueItem[];
}) {
  const [picked, setPicked] = useState<string | null>(null);

  const { cells, byDay, todayKey, spanLabel } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayIndex(now));

    const cells: Date[] = Array.from({ length: WEEKS * 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
    const first = cells[0];
    const last = cells[cells.length - 1];

    // Keyed by ISO date now, not day-of-month: the window spans two months, so
    // "the 5th" is ambiguous and would have collided.
    const byDay = new Map<string, { out: DueItem[]; in: DueItem[] }>();
    const within = (d: Date) => d >= first && d <= last;
    const add = (item: DueItem, key: "out" | "in") => {
      const due = new Date(`${item.due_on}T00:00:00`);
      if (!within(due)) return;
      const k = iso(due);
      if (!byDay.has(k)) byDay.set(k, { out: [], in: [] });
      byDay.get(k)![key].push(item);
    };
    outgoing.forEach((o) => add(o, "out"));
    incoming.forEach((i) => add(i, "in"));

    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { month: "long" });
    const spanLabel =
      first.getMonth() === last.getMonth()
        ? `${fmt(first)} ${last.getFullYear()}`
        : `${fmt(first)} – ${fmt(last)} ${last.getFullYear()}`;

    return { cells, byDay, todayKey: iso(now), spanLabel };
  }, [outgoing, incoming]);

  const shown = picked !== null ? byDay.get(picked) : undefined;

  return (
    <div>
      <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-muted">{spanLabel}</p>

      <div className="grid grid-cols-7 gap-1" aria-hidden>
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="text-center text-[9px] text-ink-muted">
            {d}
          </span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((date) => {
          const key = iso(date);
          const events = byDay.get(key);
          const isToday = key === todayKey;
          const isPicked = key === picked;
          const past = key < todayKey;
          const day = date.getDate();
          return (
            <button
              key={key}
              type="button"
              onClick={() => setPicked(isPicked ? null : events ? key : null)}
              aria-label={
                events
                  ? `${date.toLocaleDateString("en-IN", { day: "numeric", month: "long" })}: ${[
                      ...events.out,
                      ...events.in,
                    ]
                      .map((e) => e.name)
                      .join(", ")}`
                  : `${date.toLocaleDateString("en-IN", { day: "numeric", month: "long" })}, nothing due`
              }
              className={`flex aspect-square flex-col items-center justify-center rounded-md text-[11px] tabular-nums transition-colors ${
                isPicked
                  ? "bg-surface-raised text-ink-primary"
                  : isToday
                    ? "border border-brand-line text-ink-primary"
                    : events
                      ? "text-ink-primary hover:bg-surface-raised"
                      : past
                        ? "text-ink-muted/45"
                        : "text-ink-muted"
              }`}
            >
              {/* The 1st names its month, so a window spanning two of them
                  still reads unambiguously without a second header. */}
              {day === 1 ? date.toLocaleDateString("en-IN", { month: "short" }) : day}
              <span className="mt-0.5 flex h-1 gap-0.5">
                {/* A subscription and an EMI both leave on a date, but only one
                    of them can be cancelled — so debt gets its own mark rather
                    than disappearing into the same dot. A square, not a colour:
                    shape survives greyscale and colour blindness. */}
                {events?.out.some((e) => e.kind === "emi") ? (
                  <span
                    className="size-1 rounded-[1px]"
                    style={{ backgroundColor: "var(--chart-4)" }}
                  />
                ) : null}
                {events?.out.some((e) => e.kind !== "emi") ? (
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
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-ink-secondary">{item.name}</span>
                  {item.kind === "emi" && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-muted">
                      emi
                    </span>
                  )}
                </span>
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
