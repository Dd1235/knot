export interface SegmentItem<T extends string> {
  id: T;
  label: string;
}

/** Tabs with real tablist semantics — the styling and the accessibility fix
 * arrive together. */
export default function SegmentedNav<T extends string>({
  items,
  value,
  onChange,
  label,
  className = "",
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  return (
    /* A group of pressed buttons, not a tablist. These are filters — they
       control no tabpanel, and they were announced as tabs while behaving as
       buttons: no aria-controls, no roving tabindex, arrow keys inert. A
       promise the widget could not keep is worse than a plain button.
       Also a div, not a nav: an overriding role silently costs the landmark. */
    <div role="group" aria-label={label} className={`flex gap-1 ${className}`}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
              active
                ? "bg-brand text-ink-on-brand font-medium"
                : "border border-line text-ink-secondary hover:bg-surface-raised hover:text-ink-primary active:bg-surface-raised"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
