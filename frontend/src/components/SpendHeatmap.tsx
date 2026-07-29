"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** A year of spending as a calendar grid — the GitHub contribution graph, but
 * for money going out.
 *
 * Three decisions worth stating:
 *
 * 1. **Intensity is a rank, not a ratio.** Scaling linearly against the max
 *    would let one rent day flatten a whole year to step 1. Cells are bucketed
 *    by quartile over *spending days only*, so the ramp always uses its full
 *    range and a heavy day looks heavy relative to how this person normally
 *    lives, not relative to their worst day.
 *
 * 2. **Investing never darkens a cell.** Money into a SIP or FD has not left
 *    the user's net worth. It gets its own quiet marker instead of heat, so
 *    the graph can't scold someone for saving.
 *
 * 3. **A no-spend day is an absence, not a zero.** It sits on the surface
 *    colour with a hairline, and the streak counter does the celebrating —
 *    tinting it green would collide with income.
 */

export type HeatDay = {
  date: string;
  spend: string;
  invested?: string;
  txns?: number;
};

const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Quartile cut points over spending days only. Zero days are excluded so they
 * don't drag the whole scale down and wash the graph out. */
function quartiles(values: number[]): number[] {
  const spent = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (spent.length < 4) return [0, 0, 0];
  const at = (q: number) => spent[Math.min(spent.length - 1, Math.floor(spent.length * q))];
  return [at(0.25), at(0.5), at(0.75)];
}

function level(amount: number, cuts: number[]): 0 | 1 | 2 | 3 | 4 {
  if (amount <= 0) return 0;
  if (amount <= cuts[0]) return 1;
  if (amount <= cuts[1]) return 2;
  if (amount <= cuts[2]) return 3;
  return 4;
}

const HEAT = [
  "var(--heat-0)",
  "var(--heat-1)",
  "var(--heat-2)",
  "var(--heat-3)",
  "var(--heat-4)",
] as const;

/** Monday-first weekday index; JS getDay() is Sunday-first. */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default function SpendHeatmap({
  days,
  weeks = 26,
  className = "",
}: {
  days: HeatDay[];
  weeks?: number;
  className?: string;
}) {
  const [hover, setHover] = useState<HeatDay | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // On a narrow screen the grid overflows, and the interesting end is the
  // recent one. Open on today rather than on six months ago.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [days]);

  const { columns, cuts, monthLabels, stats } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const amounts = days.map((d) => Number(d.spend));
    const cuts = quartiles(amounts);

    // End on the current week so "today" is the last column, then walk back.
    const last = days.length ? parseDay(days[days.length - 1].date) : new Date();
    const end = new Date(last);
    end.setDate(end.getDate() + (6 - mondayIndex(end))); // to Sunday
    const start = new Date(end);
    start.setDate(start.getDate() - (weeks * 7 - 1));

    const columns: (HeatDay & { level: number; future: boolean })[][] = [];
    const monthLabels: { col: number; label: string }[] = [];
    const cursor = new Date(start);
    let lastMonth = -1;

    for (let w = 0; w < weeks; w++) {
      const col: (HeatDay & { level: number; future: boolean })[] = [];
      for (let d = 0; d < 7; d++) {
        const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
        const row = byDate.get(iso);
        const amount = row ? Number(row.spend) : 0;
        if (cursor.getMonth() !== lastMonth && d === 0) {
          lastMonth = cursor.getMonth();
          monthLabels.push({ col: w, label: MONTHS[lastMonth] });
        }
        col.push({
          date: iso,
          spend: row?.spend ?? "0",
          invested: row?.invested,
          txns: row?.txns,
          level: level(amount, cuts),
          future: cursor > last,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      columns.push(col);
    }

    // Streak: consecutive no-spend days ending at the most recent day on file.
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (Number(days[i].spend) > 0) break;
      streak++;
    }
    const spendingDays = amounts.filter((a) => a > 0).length;
    const stats = {
      streak,
      quietDays: days.length - spendingDays,
    };
    return { columns, cuts, monthLabels, stats };
  }, [days, weeks]);

  const shown = hover;

  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[11px] text-ink-secondary">
          {shown ? (
            <>
              <span className="text-ink-primary">
                {Number(shown.spend) > 0 ? INR.format(Number(shown.spend)) : "Nothing spent"}
              </span>{" "}
              on{" "}
              {parseDay(shown.date).toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
              {shown.txns ? ` · ${shown.txns} payment${shown.txns > 1 ? "s" : ""}` : ""}
              {Number(shown.invested ?? 0) > 0
                ? ` · ${INR.format(Number(shown.invested))} invested`
                : ""}
            </>
          ) : (
            <>
              {stats.quietDays} quiet day{stats.quietDays === 1 ? "" : "s"}
              {stats.streak > 1 ? ` · ${stats.streak}-day streak running` : ""}
            </>
          )}
        </p>
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        <div className="flex gap-[3px]" style={{ minWidth: "min-content" }}>
          {/* Weekday gutter */}
          <div
            className="sticky left-0 z-10 mr-1 flex shrink-0 flex-col gap-[3px] bg-surface-card pr-1 pt-[14px] text-[9px] text-ink-muted"
            aria-hidden
          >
            {WEEKDAYS.map((label, i) => (
              <span key={i} className="flex h-[11px] items-center leading-none">
                {label}
              </span>
            ))}
          </div>

          <div>
            <div className="mb-[3px] flex h-[11px] gap-[3px]">
              {columns.map((_, w) => {
                const label = monthLabels.find((m) => m.col === w);
                return (
                  <span
                    key={w}
                    className="w-[11px] text-[9px] leading-none text-ink-muted"
                    aria-hidden
                  >
                    {label?.label ?? ""}
                  </span>
                );
              })}
            </div>

            <div className="flex gap-[3px]">
              {columns.map((col, w) => (
                <div key={w} className="flex flex-col gap-[3px]">
                  {col.map((cell) => {
                    const invested = Number(cell.invested ?? 0) > 0;
                    return (
                      <div
                        key={cell.date}
                        role="img"
                        aria-label={`${cell.date}: ${
                          Number(cell.spend) > 0
                            ? INR.format(Number(cell.spend))
                            : "no spending"
                        }`}
                        onMouseEnter={() => !cell.future && setHover(cell)}
                        onMouseLeave={() => setHover(null)}
                        className="size-[11px] rounded-[2px] transition-transform hover:scale-125"
                        style={{
                          background: cell.future ? "transparent" : HEAT[cell.level],
                          // A hairline keeps empty days legible as *days* rather
                          // than as gaps in the grid.
                          boxShadow: cell.future
                            ? "none"
                            : cell.level === 0
                              ? "inset 0 0 0 1px var(--line)"
                              : invested
                                ? "inset 0 0 0 1.5px var(--positive)"
                                : "none",
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] text-ink-muted">
        <span className="flex items-center gap-1">
          <span
            className="size-[9px] rounded-[2px]"
            style={{ boxShadow: "inset 0 0 0 1.5px var(--positive)" }}
          />
          invested
        </span>
        <span className="flex items-center gap-1">
          less
          {HEAT.map((c, i) => (
            <span
              key={i}
              className="size-[9px] rounded-[2px]"
              style={{
                background: c,
                boxShadow: i === 0 ? "inset 0 0 0 1px var(--line)" : "none",
              }}
            />
          ))}
          more
          {cuts[2] > 0 ? (
            <span className="ml-1 tabular-nums">(top tier &gt; {INR.format(cuts[2])})</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
