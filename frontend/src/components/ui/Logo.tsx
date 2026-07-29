/** The Knot mark: an overhand knot — you tie one so you don't forget, which is
 * exactly what this agent does with your money.
 *
 * Over/under is expressed by GAPS in the under-strand, not masks or clip paths
 * (both are unreliable in favicons). Geometry sits inside the 4→28 safe box so
 * the same art survives Android's circular maskable crop. */
export default function Logo({
  size = 20,
  className = "",
  state = "idle",
  title,
}: {
  size?: number;
  className?: string;
  state?: "idle" | "thinking";
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      className={`${state === "thinking" ? "knot-tying" : ""} ${className}`}
    >
      {title && <title>{title}</title>}
      {/* Loop with two tails crossing below it: the over-strand runs
          uninterrupted, the under-strand is broken by a gap at the crossing. */}
      <path d="M26 27 C 20 24, 12 22, 10.5 17 C 6.5 11, 9.5 5, 16 5 C 22.5 5, 25.5 11, 21.5 17" />
      <path d="M21.5 17 C 20.6 19, 19 20.4, 17 21.4" />
      <path d="M12.4 23 C 10 24.6, 8 25.9, 6 27" />
    </svg>
  );
}

/** Full lockup: mark + wordmark, used in the app header and on the login page. */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Logo size={size} className="text-brand-ink" />
      <span className="font-semibold tracking-tight">Knot</span>
    </span>
  );
}
