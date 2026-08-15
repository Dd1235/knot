// Drives the product the way a person does. The regression this exists to
// catch — a deleted message list — passed tsc, next build, the token gates
// and every screenshot, because nothing ever sent a message.
import { chromium } from "playwright";

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem("ledger:user", "demo"));
const p = await ctx.newPage();
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "  ok  " : "FAIL  "}${what}`); if (!ok) fails.push(what); };

p.on("pageerror", (e) => fails.push(`page error: ${e}`));
await p.goto("http://localhost:3100/app", { waitUntil: "networkidle", timeout: 60000 });

const TEXT = "filter coffee 37";  // deliberately not one of the example chips
await p.getByRole("textbox", { name: /message/i }).fill(TEXT);
await p.getByRole("button", { name: /^send$/i }).click();

// The user's own words must appear in the conversation.
check(
  await p.getByText(TEXT, { exact: false }).first().isVisible({ timeout: 10000 }).catch(() => false),
  "the message I sent is on screen",
);

// And a reply must arrive and stay.
const reply = p.locator("main").getByText(/./).last();
await p.waitForTimeout(15000);
const mainText = (await p.locator("main").innerText()).trim();
check(mainText.length > TEXT.length + 20, "an assistant reply rendered");
check(mainText.includes(TEXT), "the message survived the reply arriving");
check(!/Just say what happened/.test(mainText), "the empty state is gone once there are messages");

await p.screenshot({ path: "smoke-chat.png", fullPage: true });

// The bug this exists for: the session id survived a reload but its turns did
// not, so you came back to a blank screen while the agent still held the whole
// conversation — and the next thing you said was appended to it invisibly.
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(4000);
const afterReload = (await p.locator("main").innerText()).trim();
check(afterReload.includes(TEXT), "the conversation survives a reload");
check(!/Just say what happened/.test(afterReload), "no empty state over a real conversation");

// And "new conversation" has to visibly do something.
p.once("dialog", (d) => d.accept());
await p.getByRole("button", { name: /new conversation/i }).click();
await p.waitForTimeout(1500);
const afterNew = (await p.locator("main").innerText()).trim();
check(!afterNew.includes(TEXT), "new conversation clears the screen");
check(/Just say what happened/.test(afterNew), "and the empty state comes back");

// Accessibility: the two barriers that broke the primary action.
// 1. Sending used to move the composer from the hero into the footer, which
//    remounts the input and drops focus to <body> — a keyboard user's next
//    keystroke went nowhere.
check(
  await p.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Message"),
  "focus stays in the composer after sending",
);
// 2. The chat had no live region at all, so a screen reader was told nothing.
check(
  await p.evaluate(() => {
    const live = document.querySelector('[role="status"][aria-live="polite"]');
    return !!live && (live.textContent ?? "").length > 10;
  }),
  "the completed reply reaches a live region",
);
check(
  await p.evaluate(() => !!document.querySelector('a[href="#content"]')),
  "a skip link is present",
);

// Voice is the product's distinguishing feature; it used to exist on one page.
await p.goto("http://localhost:3100/insights", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
check(
  await p.getByRole("button", { name: /talk to knot/i }).isVisible().catch(() => false),
  "voice is reachable from a page that is not chat",
);

// The scroll track belongs to the window, not to a centred column.
const scrollerIsFullWidth = await p.evaluate(() => {
  const main = document.querySelector("main");
  return main ? main.clientWidth >= document.documentElement.clientWidth - 40 : false;
});
check(scrollerIsFullWidth, "the scroller spans the window, so its bar is at the edge");
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall good");
await b.close();
process.exit(fails.length ? 1 : 0);
