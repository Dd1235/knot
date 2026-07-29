import type { ReactNode } from "react";
import { TONE_SOFT, type Tone } from "./styles";

export default function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] ${TONE_SOFT[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
