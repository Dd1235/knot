import type { ReactNode } from "react";

export default function Card({
  children,
  className = "",
  ruled = false,
}: {
  children: ReactNode;
  className?: string;
  ruled?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface-card p-3 ${
        ruled ? "ruled" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] uppercase tracking-wide text-ink-secondary">
      {children}
    </h2>
  );
}
