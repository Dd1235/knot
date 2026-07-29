import type { ReactNode } from "react";
import { TONE_TEXT, type Tone } from "./styles";

export default function Stat({
  label,
  value,
  tone = "neutral",
  size = "md",
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface-card text-center ${
        size === "md" ? "p-3" : "py-1.5"
      }`}
    >
      <p
        className={`truncate tabular-nums font-semibold ${
          size === "md" ? "text-xl" : "text-base"
        } ${TONE_TEXT[tone]}`}
      >
        {value}
      </p>
      <p
        className={`mt-0.5 uppercase tracking-wide text-ink-secondary ${
          size === "md" ? "text-[11px]" : "text-[10px]"
        }`}
      >
        {label}
      </p>
    </div>
  );
}
