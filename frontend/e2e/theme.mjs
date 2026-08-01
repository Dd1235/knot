// The theme toggle was rewritten onto useSyncExternalStore; prove it still
// flips, persists, and keeps the browser chrome in step with the surface.
import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => localStorage.setItem("ledger:user", "demo"));
const p = await ctx.newPage();
const fails = [];
const check = (ok, w) => { console.log(`${ok ? "  ok  " : "FAIL  "}${w}`); if (!ok) fails.push(w); };

await p.goto("http://localhost:3100/app", { waitUntil: "networkidle" });
const read = () => p.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  chrome: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
  surface: getComputedStyle(document.documentElement).getPropertyValue("--surface-base").trim(),
}));

const before = await read();
await p.getByRole("button", { name: /switch to .* theme/i }).click();
await p.waitForTimeout(400);
const after = await read();
check(before.theme !== after.theme, `theme flipped (${before.theme} -> ${after.theme})`);
check(after.chrome === after.surface, `browser chrome matches the surface (${after.chrome})`);

await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(600);
check((await read()).theme === after.theme, "the choice survives a reload");
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall good");
await b.close();
process.exit(fails.length ? 1 : 0);
