"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./Logo";
import CurrencyToggle from "./CurrencyToggle";
import ThemeToggle from "./ThemeToggle";
import SignOutButton from "./SignOutButton";

export const DESTINATIONS = [
  { href: "/insights", name: "insights", label: "Spending insights" },
  { href: "/transactions", name: "ledger", label: "All transactions" },
  { href: "/investments", name: "investments", label: "Investments" },
  { href: "/debts", name: "debt", label: "Loans and debts" },
  { href: "/memory", name: "memory", label: "Memory inspector" },
  { href: "/sessions", name: "history", label: "Past conversations" },
  { href: "/architecture", name: "how it works", label: "How it works" },
  { href: "/demo", name: "race demo", label: "Concurrency demo" },
] as const;

/** The one header, on every page: brand left, sections beside it, controls
 * right. The nav is deliberately NOT centred in the window — it hangs off the
 * brand block so the whole bar reads as one left-anchored application chrome,
 * with only the controls pushed to the far edge.
 *
 * Not sticky: it sits OUTSIDE the page scroller, so it never scrolls anyway.
 * z-20 because the currency popover lives in this subtree and must paint over
 * the z-10 sticky date rows inside the transactions scroller. */
export default function AppNav({
  actions,
  measure = "max-w-310",
}: {
  actions?: ReactNode;
  measure?: string;
}) {
  const pathname = usePathname();

  const links = DESTINATIONS.map((d) => {
    const active = pathname === d.href;
    return (
      <Link
        key={d.href}
        href={d.href}
        aria-label={d.label}
        aria-current={active ? "page" : undefined}
        className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
          active
            ? "bg-surface-raised text-ink-primary"
            : "text-ink-secondary hover:bg-surface-raised hover:text-ink-primary"
        }`}
      >
        {d.name}
      </Link>
    );
  });

  return (
    <header className="hairline-gold relative z-20 border-b border-line bg-surface-base px-6 pt-[env(safe-area-inset-top)] sm:px-8">
      <div className={`mx-auto w-full ${measure}`}>
        <div className="flex h-16 items-center gap-6">
          <Link href="/app" aria-label="Knot — chat" className="shrink-0">
            <Wordmark size={24} />
          </Link>
          <nav aria-label="Sections" className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
            {links}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {actions}
            <CurrencyToggle />
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        {/* Below lg the row can't hold eight sections and the controls, so the
            nav drops to its own swipeable line — one <nav> in the tree at a
            time, so screen readers never meet the same landmark twice. */}
        <nav aria-label="Sections" className="-mx-1 flex gap-0.5 overflow-x-auto pb-2 lg:hidden">
          {links}
        </nav>
      </div>
    </header>
  );
}
