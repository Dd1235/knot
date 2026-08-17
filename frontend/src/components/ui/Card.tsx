import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Icon from "./Icon";

/** Density is part of the hierarchy, not just colour.
 *
 * Every card used to be `p-3`, so a headline number and a nine-row table
 * carried identical weight and the eye had nowhere to land. `hero` gives a
 * single figure room to breathe; `quiet` drops the border so a supporting rail
 * groups by surface instead of drawing nine more boxes. */
const PAD = { hero: "p-4 lg:p-5", default: "p-3", tight: "p-3 lg:p-2.5" } as const;

export default function Card({
  children,
  className = "",
  ruled = false,
  pad = "default",
  quiet = false,
}: {
  children: ReactNode;
  className?: string;
  ruled?: boolean;
  pad?: keyof typeof PAD;
  quiet?: boolean;
}) {
  return (
    <div
      className={`rounded-xl ${
        quiet
          ? "border border-transparent bg-surface-raised/60"
          : "elevated bg-surface-card"
      } ${PAD[pad]} ${ruled ? "ruled" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  icon: Glyph,
}: {
  children: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <h2 className="eyebrow mb-2.5 flex items-center gap-1.5 text-ink-muted">
      {Glyph && <Icon as={Glyph} size={12} className="text-ink-muted/70" />}
      {children}
    </h2>
  );
}
