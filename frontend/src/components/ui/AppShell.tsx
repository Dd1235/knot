"use client";

import type { ReactNode } from "react";
import AppNav from "./AppNav";

/** The one page frame.
 *
 * The scroller (<main>) spans the window, so the scrollbar sits at the window
 * edge; the CONTENT is what's constrained, in one shared container that the
 * header row also uses. Pages used to hand-sync a `measure` prop against
 * their own <main> width, and the two drifted apart on almost every page —
 * here the same value feeds both, so they can't. */
export default function AppShell({
  children,
  actions,
  footer,
  measure = "max-w-310",
  contentClassName = "py-6",
}: {
  children: ReactNode;
  /** Page-specific header controls (chat: voice, new conversation). */
  actions?: ReactNode;
  /** Rendered below the scroller as a flex sibling (chat: the composer). */
  footer?: ReactNode;
  measure?: string;
  contentClassName?: string;
}) {
  return (
    <div className="flex h-dvh flex-col">
      <AppNav actions={actions} measure={measure} />
      {/* Horizontal padding sits OUTSIDE the measure box, exactly as it does
          in AppNav and the chat footer — all three centre the same box in the
          same padded area, which is what makes their left edges one line. */}
      <main className="flex-1 overflow-y-auto px-6 sm:px-8">
        <div className={`mx-auto w-full ${measure} ${contentClassName}`}>
          {children}
        </div>
      </main>
      {footer}
    </div>
  );
}

/** Page titles left the header when it went global — they are content now,
 * and at content scale: the header names the app, this names the page. */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-[32px] font-bold leading-tight tracking-[-0.02em]">{children}</h1>
  );
}
