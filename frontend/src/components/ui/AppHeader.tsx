import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "./Button";

/** The sticky page header, previously copy-pasted byte-identically into five
 * pages. `children` is the sub-row slot (balance pills, tabs, stat grid). */
export default function AppHeader({
  title,
  back,
  actions,
  children,
  gold = false,
}: {
  title: ReactNode;
  back?: string;
  actions?: ReactNode;
  children?: ReactNode;
  gold?: boolean;
}) {
  return (
    <header
      className={`sticky top-0 z-10 border-b border-line bg-surface-base/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur ${
        gold ? "hairline-gold" : ""
      }`}
    >
      <div className="flex h-14 items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 truncate text-lg font-semibold tracking-tight">
          {title}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {back && (
            <Link href={back} className={buttonClass("ghost", "sm")}>
              ← chat
            </Link>
          )}
        </div>
      </div>
      {children}
    </header>
  );
}
