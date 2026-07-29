"use client";

import { useEffect, useState } from "react";
import Button from "./Button";

type Theme = "light" | "dark";

const STORAGE_KEY = "knot:theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    setTheme(stored ?? systemTheme());
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.dataset.theme = next;
    // Keep the browser chrome in step with the page.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#0f0e0c" : "#faf7f0");
  };

  if (theme === null) return null; // avoids a flash of the wrong icon

  return (
    <Button
      onClick={() => apply(theme === "dark" ? "light" : "dark")}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? "☀" : "☾"}
    </Button>
  );
}
