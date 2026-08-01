import {
  ArrowLeftRight,
  Banknote,
  Bitcoin,
  BookOpen,
  Bus,
  ChartCandlestick,
  Clapperboard,
  Coffee,
  CreditCard,
  Gift,
  HandCoins,
  Handshake,
  House,
  Landmark,
  Laptop,
  type LucideIcon,
  Percent,
  PiggyBank,
  Pill,
  Plane,
  Repeat,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  TrendingUp,
  Utensils,
  Wallet,
  Wifi,
  Zap,
} from "lucide-react";

/** One icon per category.
 *
 * Shape carries identity here, not hue: it survives greyscale, colour
 * blindness and forced-colours mode, and it stays legible at the twelfth
 * category where hue #12 of a categorical ramp does not.
 *
 * The emoji set this replaces had five categories sharing 📈 and five sharing
 * 🔒 — half the investment vocabulary was indistinguishable, which defeats the
 * point of an icon. Every entry below is a distinct mark.
 */
const ICONS: Record<string, LucideIcon> = {
  // essentials
  rent: House,
  groceries: ShoppingCart,
  utilities: Zap,
  transport: Bus,
  phone: Smartphone,
  internet: Wifi,
  medical: Pill,
  education: BookOpen,
  emi: Landmark,
  insurance: ShieldCheck,

  // discretionary
  food: Utensils,
  coffee: Coffee,
  entertainment: Clapperboard,
  shopping: ShoppingBag,
  subscriptions: Repeat,
  travel: Plane,
  gifts: Gift,

  // savings & investments — each instrument gets its own mark
  sip: Repeat,
  mutual_funds: ChartCandlestick,
  stocks: TrendingUp,
  fd: Landmark,
  rd: PiggyBank,
  savings: PiggyBank,
  nps: ShieldCheck,
  ppf: ShieldCheck,
  elss: Percent,
  gold: Sparkles,
  crypto: Bitcoin,
  bonds: Percent,

  // income
  salary: Banknote,
  freelance: Laptop,
  interest: Percent,
  cashback: HandCoins,
  dividends: HandCoins,

  // movement between the user's own accounts, and between people
  withdrawal: CreditCard,
  opening_balance: Wallet,
  settlement: Handshake,
  repayment: Handshake,
  transfer: ArrowLeftRight,
  loan: Landmark,
};

export function iconFor(category: string): LucideIcon | null {
  return ICONS[(category ?? "").trim().toLowerCase()] ?? null;
}

/** No icon beats a wrong icon: an unmapped category falls back to the
 * merchant's initial, which at least identifies the row. */
export function initialFor(category: string, description = ""): string {
  const initial = (description || category || "?").trim()[0];
  return (initial ?? "?").toUpperCase();
}
