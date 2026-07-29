import type { LucideIcon } from "lucide-react";

/** One place that decides how an icon looks.
 *
 * Lucide draws on a 24px grid with currentColor strokes and no fill, the same
 * contract `Logo.tsx` already follows — so icons take their colour from the
 * surrounding text class. They must never be given a custom property through
 * an SVG presentation attribute: those do not resolve, and the mark silently
 * vanishes. The token gate enforces this (and caught this very comment).
 *
 * Stroke width is scaled with size rather than fixed. At 14px a 2px stroke is
 * heavy enough to close up the counters and read as a blob; at 32px it looks
 * spindly next to text. Keeping optical weight constant across sizes is most
 * of what separates a real icon set from a pile of glyphs.
 */
export default function Icon({
  as: Glyph,
  size = 16,
  className = "",
  title,
}: {
  as: LucideIcon;
  size?: number;
  className?: string;
  /** Give this only when the icon is the sole label; otherwise it is decorative
   * and must stay hidden so a screen reader does not read it twice. */
  title?: string;
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={size <= 14 ? 2.25 : size >= 28 ? 1.5 : 1.9}
      absoluteStrokeWidth
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    />
  );
}
