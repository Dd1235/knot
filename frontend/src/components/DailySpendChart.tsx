"use client";

import { useEffect, useId, useRef, useState } from "react";
import Money from "@/components/ui/Money";
import { DailyFlow, inr } from "@/lib/api";

/** Daily spend as thin bars. Height is a prop because the desktop dashboard
 * gives this chart a full hero row, where 180px reads as a sparkline. */
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

export default function DailySpendChart({
  daily,
  height = 180,
  reference,
  referenceLabel,
}: {
  daily: DailyFlow[];
  height?: number;
  /** A per-day figure to draw as a rule across the plot — the number the bars
   * should be read against. Without it a bar chart only says "this day was
   * taller than that one", which is not a question anyone has. */
  reference?: number;
  referenceLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const chartId = useId();

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

  const H = height;
  const PAD_L = 32;
  const PAD_R = 2;
  const TOP = 34; // headroom so the tooltip fits above the tallest bar
  const BOTTOM = 18;
  const baseline = H - BOTTOM;
  const plotH = baseline - TOP;
  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const n = daily.length;
  const slot = n > 0 ? plotW / n : 0;
  // The gap scales with the slot instead of sitting at a fixed 2px: at 7 days
  // that made hairline gaps between slabs, and at 90 it made bars thinner than
  // the gaps between them. Bars are the data; the gap is only separation.
  const barW = Math.max(slot - Math.min(3, slot * 0.22), 1.5);

  const refValue = reference && reference > 0 ? reference : null;
  // The rule must fit inside the axis or it silently clips off the top.
  const yMax = allZero ? 0 : niceCeil(Math.max(rawMax, refValue ?? 0));
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
            {/* The rule the bars are read against. Dashed so it reads as a
                target rather than as data, and labelled at the right where it
                cannot collide with the y-axis ticks. */}
            {!allZero && refValue !== null && refValue <= yMax && (
              <>
                <line
                  x1={PAD_L}
                  x2={width - PAD_R}
                  y1={barTop(refValue)}
                  y2={barTop(refValue)}
                  className="stroke-brand"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.55}
                />
                {referenceLabel && width > 260 && (
                  <>
                    {/* Backed, and anchored left. Anchored right it sat exactly
                        where the tallest bar usually is — the label was drawn
                        over the data it was meant to explain. */}
                    <rect
                      x={PAD_L + 2}
                      y={barTop(refValue) - 13}
                      width={referenceLabel.length * 5.1 + 8}
                      height={12}
                      rx={3}
                      className="fill-surface-card"
                    />
                    <text
                      x={PAD_L + 6}
                      y={barTop(refValue) - 4}
                      fontSize={9}
                      className="fill-brand-ink tabular-nums"
                    >
                      {referenceLabel}
                    </text>
                  </>
                )}
              </>
            )}
            {/* the column under the cursor, so the guide is not only a tooltip */}
            {hover !== null && !allZero && (
              <line
                x1={colX(hover) + 1 + barW / 2}
                x2={colX(hover) + 1 + barW / 2}
                y1={TOP}
                y2={baseline}
                className="stroke-brand"
                strokeWidth={1}
                opacity={0.22}
              />
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
                    className={hover === i ? "fill-brand" : "fill-chart-spend"}
                    opacity={hover === null || hover === i ? 1 : 0.45}
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

          {/* Hover/tap layer. Pointer targets stay per-column, but the KEYBOARD
              target is the group: ninety sibling buttons meant ninety Tab
              presses to cross one chart, and at 90 days on a phone each was
              under 3px wide. One stop, arrow keys to move, and the focused
              day is announced through the status line below. */}
          {!allZero && n > 0 && (
            <div
              role="listbox"
              tabIndex={0}
              aria-label={`Daily spend, ${n} days. Use arrow keys to read each day.`}
              aria-activedescendant={hover !== null ? `${chartId}-day-${hover}` : undefined}
              className="absolute flex rounded-sm"
              style={{ left: PAD_L, width: plotW, top: TOP, height: plotH }}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover((h) => (h === null ? n - 1 : h))}
              onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                setHover((h) => {
                  const from = h === null ? n - 1 : h;
                  return Math.min(n - 1, Math.max(0, from + (e.key === "ArrowRight" ? 1 : -1)));
                });
              }}
            >
              {daily.map((d, i) => (
                <div
                  key={d.date}
                  id={`${chartId}-day-${i}`}
                  role="option"
                  // Focusable programmatically, never in the tab order — the
                  // listbox above owns the single stop and moves selection.
                  tabIndex={-1}
                  aria-selected={hover === i}
                  aria-label={`${shortDate(d.date)}: ${inr(d.spend)}`}
                  className="h-full flex-1"
                  onMouseEnter={() => setHover(i)}
                  onTouchStart={() => setHover(hover === i ? null : i)}
                />
              ))}
            </div>
          )}

          {/* Persistent, so a repeated polite update actually announces. */}
          {/* One line on purpose: the money-render gate reads line by line, and
              this is assistive-tech text rather than a visible figure. */}
          <p role="status" aria-live="polite" className="sr-only">{hover !== null && daily[hover] ? `${shortDate(daily[hover].date)}: ${inr(daily[hover].spend)}` : ""}</p>

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
