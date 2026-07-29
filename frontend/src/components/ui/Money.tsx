import { TONE_TEXT, type Tone } from "./styles";

const FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const SIZE = {
  inline: "",
  lg: "text-xl font-semibold",
  hero: "text-4xl font-semibold tracking-tight",
} as const;

/** Money as a *figure*, not a string: the ₹ and the paise are demoted to 0.62em
 * secondary ink so the rupees read as the number. Tabular figures always, so
 * columns of amounts line up. */
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
  const amount = Number(value);
  const resolved: Tone =
    tone === "auto"
      ? amount < 0
        ? "negative"
        : amount > 0 && signed
          ? "positive"
          : "neutral"
      : tone;

  const parts = FORMATTER.formatToParts(signed ? amount : Math.abs(amount));

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
