"use client";

import { useEffect, useState } from "react";

/** Tools that make something permanent. A reply alone never ties the knot —
 * the cinch means a write committed, and it must never lie about that. */
export const WRITE_TOOLS = new Set([
  "record_transaction",
  "settle_up",
  "void_transaction",
  "set_opening_balance",
  "track_recurring",
  "stop_recurring",
  "remember_fact",
  "learn_rule",
]);

const EVENT = "knot:cinch";

/** Something became permanent — tie the knot in the header. */
export function cinchKnot(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** Non-zero for ~900ms after each cinch. The value increments per event, so
 * it can double as a React key: a second write mid-animation restarts the
 * tie instead of being swallowed. */
export function useKnotCinch(): number {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let count = 0;
    const onCinch = () => {
      count += 1;
      setPulse(count);
      clearTimeout(timer);
      timer = setTimeout(() => setPulse(0), 900);
    };
    window.addEventListener(EVENT, onCinch);
    return () => {
      window.removeEventListener(EVENT, onCinch);
      clearTimeout(timer);
    };
  }, []);
  return pulse;
}
