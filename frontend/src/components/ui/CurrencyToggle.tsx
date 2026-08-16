"use client";

import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import Icon from "./Icon";
import { CURRENCIES, readCurrency, setCurrency, useCurrency } from "@/lib/currency";
import { Coins } from "lucide-react";

/** Display currency, next to the theme toggle.
 *
 * It sits in the header rather than behind a settings page because it is a
 * view preference, like light/dark — you flip it to read the screen you are
 * already looking at, not as part of configuring the app.
 *
 * The rate is editable and stated by the user. Defaults are approximate and
 * labelled as such: a wrong number presented confidently is worse than an
 * obviously-editable one.
 */
export default function CurrencyToggle() {
  const currency = useCurrency();
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onAway = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onAway);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onAway);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const pick = (code: string) => {
    setCurrency(code);
    if (code === "INR") setOpen(false);
  };

  const applyRate = () => {
    const perUnit = Number(rate);
    if (perUnit > 0) setCurrency(currency.code, 1 / perUnit);
    setOpen(false);
  };

  return (
    <div className="relative" ref={boxRef}>
      <Button
        onClick={() => {
          // Seed the rate field as the panel opens rather than reacting to it
          // having opened — the value is known at the moment of the click.
          if (!open) setRate(currency.perRupee === 1 ? "" : String(1 / currency.perRupee));
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-label="Display currency"
        title={`Showing amounts in ${currency.code}`}
      >
        <span className="inline-flex items-center gap-1">
          <Icon as={Coins} size={14} />
          {currency.code}
        </span>
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-xl border border-line bg-surface-card p-2 shadow-lg">
          <p className="mb-1.5 px-1 text-[11px] uppercase tracking-wide text-ink-muted">
            Show amounts in
          </p>
          <div className="grid grid-cols-3 gap-1">
            {Object.keys(CURRENCIES).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => pick(code)}
                className={`rounded-lg px-2 py-1.5 text-xs transition-colors ${
                  currency.code === code
                    ? "bg-brand font-medium text-ink-on-brand"
                    : "border border-line text-ink-secondary hover:bg-surface-raised"
                }`}
              >
                {code}
              </button>
            ))}
          </div>

          {currency.code !== "INR" && (
            <div className="mt-2 border-t border-line pt-2">
              <label htmlFor="fx-rate" className="block px-1 text-[11px] text-ink-secondary">
                1 {currency.code} = how many rupees
              </label>
              <div className="mt-1 flex gap-1">
                <input
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyRate()}
                  id="fx-rate"
                  inputMode="decimal"
                  className="w-full rounded-lg border border-line bg-surface-raised px-2 py-1 text-base tabular-nums focus:border-brand-line sm:text-sm"
                />
                <Button variant="tonal" tone="brand" onClick={applyRate}>
                  set
                </Button>
              </div>
              <p className="mt-1.5 px-1 text-[10px] text-ink-muted">
                Rupees per {currency.code}. Your books stay in ₹ — this only changes how
                they are shown, so set the rate you actually got.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** For non-React callers that need the current rate (CSV, aria-labels). */
export { readCurrency };
