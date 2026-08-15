"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import AppNav from "./AppNav";
import VoiceOverlay from "./VoiceOverlay";

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
  /* App Router client navigation moves neither focus nor announcement, so a
   * screen-reader user gets no signal that the page changed. The document
   * title is already per-route (each route has its own metadata layout), so
   * announcing it is both accurate and free. */
  const pathname = usePathname();
  const [routeAnnouncement, setRouteAnnouncement] = useState("");
  useEffect(() => {
    // A frame after navigation, so the new route's <title> has been applied.
    const t = setTimeout(() => setRouteAnnouncement(document.title), 120);
    return () => clearTimeout(t);
  }, [pathname]);

  return (
    <div className="flex h-dvh flex-col">
      <ScreenReaderOnly role="status" aria-live="polite">
        {routeAnnouncement}
      </ScreenReaderOnly>
      {/* AppNav puts ~12 tab stops before the content on every page, and it is
          the same 12 on each one. Hidden until focused, so it costs a sighted
          user nothing and a keyboard user eleven keystrokes per navigation. */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface-card focus:px-4 focus:py-2 focus:text-sm focus:text-ink-primary focus:shadow-lg"
      >
        Skip to content
      </a>
      <AppNav actions={actions} measure={measure} />
      {/* Horizontal padding sits OUTSIDE the measure box, exactly as it does
          in AppNav and the chat footer — all three centre the same box in the
          same padded area, which is what makes their left edges one line. */}
      <main id="content" tabIndex={-1} className="flex-1 overflow-y-auto px-6 sm:px-8">
        <div className={`mx-auto w-full ${measure} ${contentClassName}`}>
          {children}
        </div>
      </main>
      {footer}
      {/* Rendered by the shell, so it opens over any page. */}
      <VoiceOverlay />
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

/** In the accessibility tree, absent from the page.
 *
 * `sr-only` rather than `hidden`: display:none removes a node from the
 * accessibility tree entirely, which is the opposite of what a screen-reader
 * heading or live region is for. */
export function ScreenReaderOnly({
  children,
  as: Tag = "span",
  ...rest
}: {
  children: ReactNode;
  as?: "span" | "h1" | "h2" | "p" | "div";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className="sr-only" {...rest}>
      {children}
    </Tag>
  );
}
