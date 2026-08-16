"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import AppNav from "./AppNav";
import VoiceOverlay from "./VoiceOverlay";
import VoiceLink from "./VoiceLink";

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
      {/* The first two things a keyboard reaches, on every page.
       *
       * The voice button in the header is the eleventh tab stop on desktop —
       * behind the wordmark and eight nav links — and the skip link jumps over
       * the header entirely, so a screen-reader user taking it never met voice
       * at all. "Click the voice button" is not an answer for someone who
       * cannot see where the button is.
       *
       * A single-letter shortcut would have been worse than useless here:
       * screen readers run pages in browse mode and capture bare character
       * keys for their own quick-navigation, so the keystroke never reaches
       * the page. Tab is the one thing that behaves identically in every
       * screen reader, every mode and every browser — and WCAG 2.1.4 has
       * nothing to say about it. */}
      <nav
        aria-label="Quick actions"
        className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:left-4 focus-within:top-4 focus-within:z-50 focus-within:flex focus-within:gap-2"
      >
        <a
          href="#content"
          className="rounded-lg bg-surface-card px-4 py-2 text-sm text-ink-primary shadow-lg"
        >
          Skip to content
        </a>
        <VoiceLink />
      </nav>
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
 * and at content scale: the header names the app, this names the page. They
 * speak the wordmark's serif — the one brand echo inside the product. The
 * data below them stays in the sans. */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-display text-[34px] font-normal leading-tight tracking-[0.005em]">
      {children}
    </h1>
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
