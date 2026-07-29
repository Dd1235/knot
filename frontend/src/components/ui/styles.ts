export const inputClass =
  "w-full rounded-xl border border-line bg-surface-card px-4 py-3 text-sm text-ink-primary " +
  "outline-none placeholder:text-ink-muted focus:border-brand-line";

export type Tone = "neutral" | "brand" | "positive" | "negative" | "warning" | "info";

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink-primary",
  brand: "text-brand-ink",
  positive: "text-positive",
  negative: "text-negative",
  warning: "text-warning",
  info: "text-info",
};

export const TONE_SOFT: Record<Tone, string> = {
  neutral: "border-line bg-surface-raised text-ink-secondary",
  brand: "border-brand-line bg-brand-soft text-brand-ink",
  positive: "border-positive-line bg-positive-soft text-positive",
  negative: "border-negative-line bg-negative-soft text-negative",
  warning: "border-warning-line bg-warning-soft text-warning",
  info: "border-info-line bg-info-soft text-info",
};
