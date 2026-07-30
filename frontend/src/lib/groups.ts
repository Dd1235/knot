/** Spending-group colours and labels, shared by every surface.
 *
 * Colour follows the entity (the group), never the row index or rank — a
 * filter that changes what's on screen must not repaint the survivors.
 * `other` is deliberately achromatic: it is the residual bucket and must
 * never read as a category in its own right.
 *
 * `debt` is the fifth assigned hue and the palette is now full: measured in
 * OKLab, no sRGB colour at this lightness separates by 15 from all of blue,
 * violet, green, the warm spend neutral and brand gold simultaneously. Teal
 * lands 11 from blue and 13 from green — above the 8 floor but below the ideal.
 * That is legal here and only here, because every group bar carries its label
 * adjacent to it, so identity is never colour-alone. A sixth category must
 * fold into `other` rather than invent a hue.
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
  debt: "var(--chart-4)",
  other: "var(--chart-other)",
};

export const GROUP_LABELS: Record<string, string> = {
  essentials: "essentials",
  discretionary: "discretionary",
  savings_invest: "savings & invest",
  income: "income",
  debt: "debt service",
  other: "other",
};
