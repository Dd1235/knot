"use client";

import { useEffect, useState } from "react";

/** Display currency.
 *
 * The ledger stores rupees and always will — every amount ever recorded is in
 * INR, and rewriting history to a different unit would be a lie about what
 * happened. So this converts at display time only, using a rate the user
 * states, exactly the way instrument prices work: no API key, no rate limit,
 * nothing to go stale without saying so.
 *
 * Swapping the symbol without converting was the tempting shortcut and the
 * wrong one — ₹1,700 shown as $1,700 is not a formatting choice, it is a
 * false statement about how much money there is.
 */

export type Currency = {
  code: string;
  locale: string;
  /** How many rupees one unit is worth. INR is 1 by definition. */
  perRupee: number;
};

export const CURRENCIES: Record<string, Omit<Currency, "perRupee"> & { defaultRate: number }> = {
  INR: { code: "INR", locale: "en-IN", defaultRate: 1 },
  USD: { code: "USD", locale: "en-US", defaultRate: 1 / 87 },
  EUR: { code: "EUR", locale: "en-IE", defaultRate: 1 / 95 },
  GBP: { code: "GBP", locale: "en-GB", defaultRate: 1 / 111 },
  AED: { code: "AED", locale: "en-AE", defaultRate: 1 / 23.7 },
  SGD: { code: "SGD", locale: "en-SG", defaultRate: 1 / 65 },
  AUD: { code: "AUD", locale: "en-AU", defaultRate: 1 / 57 },
  CAD: { code: "CAD", locale: "en-CA", defaultRate: 1 / 63 },
  JPY: { code: "JPY", locale: "ja-JP", defaultRate: 1 / 0.58 },
};

const KEY_CODE = "knot:currency";
const KEY_RATE = "knot:currency-rate";
const EVENT = "knot:currency-changed";

export function readCurrency(): Currency {
  if (typeof window === "undefined") return { code: "INR", locale: "en-IN", perRupee: 1 };
  const code = localStorage.getItem(KEY_CODE) ?? "INR";
  const spec = CURRENCIES[code] ?? CURRENCIES.INR;
  const stored = Number(localStorage.getItem(KEY_RATE));
  return {
    code: spec.code,
    locale: spec.locale,
    perRupee: code === "INR" ? 1 : stored > 0 ? stored : spec.defaultRate,
  };
}

export function setCurrency(code: string, perRupee?: number): void {
  localStorage.setItem(KEY_CODE, code);
  if (perRupee && perRupee > 0) localStorage.setItem(KEY_RATE, String(perRupee));
  else localStorage.removeItem(KEY_RATE);
  // Money is rendered in dozens of places that never re-mount on a settings
  // change, so the switch has to be broadcast rather than passed down.
  window.dispatchEvent(new Event(EVENT));
}

/** Subscribes to changes, so every amount on screen updates at once. */
export function useCurrency(): Currency {
  const [currency, setState] = useState<Currency>(() => ({
    code: "INR",
    locale: "en-IN",
    perRupee: 1,
  }));

  useEffect(() => {
    const sync = () => setState(readCurrency());
    sync();
    window.addEventListener(EVENT, sync);
    // Another tab changing it should not leave this one showing stale money.
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return currency;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatterFor(currency: Currency): Intl.NumberFormat {
  const key = `${currency.locale}:${currency.code}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(currency.locale, {
      style: "currency",
      currency: currency.code,
      // Yen has no minor unit; forcing two decimals there looks wrong.
      minimumFractionDigits: currency.code === "JPY" ? 0 : 2,
      maximumFractionDigits: currency.code === "JPY" ? 0 : 2,
    });
    formatters.set(key, f);
  }
  return f;
}

export const convert = (rupees: number, currency: Currency): number =>
  currency.perRupee === 1 ? rupees : rupees * currency.perRupee;
