/** Spending-group colours and labels, shared by every surface.
 *
 * Colour follows the entity (the group), never the row index or rank — a
 * filter that changes what's on screen must not repaint the survivors.
 * `other` is deliberately achromatic: it is the residual bucket and must
 * never read as a category in its own right.
 *
 * savings_invest and income share the positive green on purpose. The two
 * were previously distinct greens 4.9 apart in OKLab — indistinguishable in
 * dark mode while claiming to mean different things. They now say the one
 * thing they have in common: money that stayed yours. */

export const GROUP_COLORS: Record<string, string> = {
  essentials: "var(--chart-1)",
  discretionary: "var(--chart-2)",
  savings_invest: "var(--positive)",
  income: "var(--positive)",
  other: "var(--chart-other)",
};

export const GROUP_LABELS: Record<string, string> = {
  essentials: "essentials",
  discretionary: "discretionary",
  savings_invest: "savings & invest",
  income: "income",
  other: "other",
};
