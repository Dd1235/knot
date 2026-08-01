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

const TEXT = "chai 15";
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
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall good");
await b.close();
process.exit(fails.length ? 1 : 0);
