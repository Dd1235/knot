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
    /* A div, not a nav: role="tablist" overrides the element's implicit role,
       so a <nav> here announced as a tablist and the navigation landmark was
       silently lost. These are filters, not navigation, so the landmark was
       never the right claim anyway. */
    <div role="tablist" aria-label={label} className={`flex gap-1 ${className}`}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
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
