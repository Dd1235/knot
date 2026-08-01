"use client";

import { TONE_TEXT, type Tone } from "./styles";
import { convert, formatterFor, useCurrency } from "@/lib/currency";

const SIZE = {
  inline: "",
  lg: "text-xl font-semibold",
  hero: "text-4xl font-semibold tracking-tight",
} as const;

/** Money as a *figure*, not a string: the symbol and the minor unit are demoted
 * to 0.62em secondary ink so the number reads as the number. Tabular figures
 * always, so columns of amounts line up. */
export default function Money({
  value,
  size = "inline",
  tone = "auto",
  signed = false,
  className = "",
}: {
  value: string | number;
  size?: keyof typeof SIZE;
  tone?: Tone | "auto";
  signed?: boolean;
  className?: string;
}) {
  // The ledger is in rupees; this converts for display only, at a rate the
  // user states. Every Money on screen re-renders together when it changes.
  const currency = useCurrency();
  const amount = convert(Number(value), currency);
  const resolved: Tone =
    tone === "auto"
      ? amount < 0
        ? "negative"
        : amount > 0 && signed
          ? "positive"
          : "neutral"
      : tone;

  const parts = formatterFor(currency).formatToParts(signed ? amount : Math.abs(amount));

  return (
    <span
      className={`tabular-nums whitespace-nowrap ${SIZE[size]} ${TONE_TEXT[resolved]} ${className}`}
    >
      {parts.map((part, i) => {
        if (part.type === "currency" || part.type === "decimal" || part.type === "fraction") {
          return (
            <span key={i} className="text-[0.62em] opacity-70">
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </span>
  );
}
