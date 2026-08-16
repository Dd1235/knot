import type { ButtonHTMLAttributes, ReactNode } from "react";
import { TONE_SOFT, type Tone } from "./styles";

type Variant = "primary" | "ghost" | "tonal";
type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm font-medium",
  // Landing-page CTAs only. In the app the primary action is never this loud.
  lg: "px-6 py-3 text-[15px] font-medium",
};

/** Gold is a fill exactly once per screen — the single primary action. */
export function buttonClass(
  variant: Variant = "ghost",
  size: Size = "sm",
  tone: Tone = "neutral",
): string {
  const base = `inline-flex items-center justify-center gap-1.5 rounded-lg ${SIZE[size]} transition-colors disabled:opacity-40`;
  if (variant === "primary") {
    return `${base} bg-brand text-ink-on-brand font-semibold hover:brightness-105 active:brightness-95`;
  }
  if (variant === "tonal") {
    return `${base} border ${TONE_SOFT[tone]} hover:brightness-110`;
  }
  return `${base} border border-line text-ink-secondary hover:bg-surface-raised hover:text-ink-primary active:bg-surface-raised`;
}

type BaseProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  tone?: Tone;
};

/** Icon-only buttons must carry an aria-label — enforced by the type, since
 * emoji controls previously shipped with no accessible name. */
type ButtonProps = BaseProps &
  ({ children: ReactNode } | { "aria-label": string; children?: ReactNode });

export default function Button({
  variant = "ghost",
  size = "sm",
  tone = "neutral",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${buttonClass(variant, size, tone)} ${className}`}
      {...rest}
    />
  );
}
