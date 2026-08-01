"use client";

import { useSyncExternalStore } from "react";
import Button from "./Button";
import Icon from "./Icon";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const STORAGE_KEY = "knot:theme";
const EVENT = "knot:theme-changed";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/* The theme already lives in two places outside React — localStorage, and the
 * `data-theme` stamp layout.tsx writes before first paint. Mirroring it into
 * state via an effect cost a second render on every mount purely to catch up
 * with something the DOM already knew. Subscribing reads the truth directly. */
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const readTheme = (): Theme =>
  (document.documentElement.dataset.theme as Theme | undefined) ??
  (localStorage.getItem(STORAGE_KEY) as Theme | null) ??
  systemTheme();

// There is no theme on the server, and guessing one produces a visible flip on
// hydration. Rendering nothing until the client knows is the honest option.
const serverTheme = () => null;

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);

  const apply = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.dataset.theme = next;
    // Read the token rather than repeating its value. The hardcoded pair here
    // was already stale after the last palette change, and browser chrome
    // sitting a shade off the page is the kind of thing nobody names but
    // everybody notices. `dataset.theme` is set above, so the computed value
    // is already the new theme's.
    const meta = document.querySelector('meta[name="theme-color"]');
    const surface = getComputedStyle(document.documentElement)
      .getPropertyValue("--surface-base")
      .trim();
    if (meta && surface) meta.setAttribute("content", surface);
    window.dispatchEvent(new Event(EVENT));
  };

  if (theme === null) return null;

  return (
    <Button
      onClick={() => apply(theme === "dark" ? "light" : "dark")}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      <Icon as={theme === "dark" ? Sun : Moon} size={15} />
    </Button>
  );
}
