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
      className={`elevated rounded-xl bg-surface-card text-center ${
        size === "md" ? "p-3.5" : "py-1.5"
      }`}
    >
      <p
        className={`truncate tabular-nums font-semibold tracking-[-0.01em] ${
          size === "md" ? "text-[26px] leading-none" : "text-base"
        } ${TONE_TEXT[tone]}`}
      >
        {value}
      </p>
      <p
        className={`uppercase text-ink-muted ${
          size === "md" ? "eyebrow mt-2" : "mt-0.5 text-[10px] tracking-wide"
        }`}
      >
        {label}
      </p>
    </div>
  );
}
