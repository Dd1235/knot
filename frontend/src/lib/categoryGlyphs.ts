/** A glyph per category, and the rule for falling back.
 *
 * Shape carries identity here, not hue. It survives greyscale, colour
 * blindness and forced-colours mode, and — the reason it replaced the
 * coloured spine — it stays legible at the twelfth category, where hue #12
 * of a categorical ramp does not.
 */

const GLYPHS: Record<string, string> = {
  food: "🍽",
  coffee: "☕",
  groceries: "🛒",
  transport: "🛺",
  rent: "🏠",
  utilities: "💡",
  phone: "📱",
  internet: "🌐",
  medical: "💊",
  education: "📚",
  emi: "🏦",
  entertainment: "🎬",
  shopping: "🛍",
  subscriptions: "🔁",
  travel: "✈️",
  gifts: "🎁",
  salary: "💰",
  freelance: "💼",
  interest: "📈",
  cashback: "↩️",
  withdrawal: "🏧",
  opening_balance: "🪙",
  sip: "📈",
  mutual_funds: "📈",
  stocks: "📈",
  fd: "🔒",
  rd: "🔒",
  nps: "🔒",
  ppf: "🔒",
  elss: "📈",
  gold: "🥇",
  crypto: "₿",
  bonds: "🔒",
  savings: "🐖",
};

export function glyphFor(category: string, description = ""): string {
  const hit = GLYPHS[(category ?? "").toLowerCase()];
  if (hit) return hit;
  // No glyph beats a wrong glyph: fall back to the merchant's initial.
  const initial = (description || category || "?").trim()[0];
  return (initial ?? "?").toUpperCase();
}
