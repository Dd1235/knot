#!/usr/bin/env bash
# Design-system guard rails. Every gate must produce no output.
# Run: npm run check:tokens

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
S=src
fail=0

gate() {
  local name="$1"; shift
  local out
  out="$("$@" 2>/dev/null)"
  if [ -n "$out" ]; then
    echo "✗ $name"
    echo "$out" | head -10 | sed 's/^/    /'
    fail=1
  else
    echo "✓ $name"
  fi
}

# 1. Raw Tailwind palette colours — everything must go through tokens.
gate "no raw palette utilities" grep -rnE \
  '\b(bg|text|border|fill|stroke|ring|placeholder|divide|outline|shadow|from|to|via|accent|caret)-(zinc|slate|gray|neutral|stone|emerald|green|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime)-[0-9]{2,3}\b' \
  "$S"

# 2. Raw hex in components. globals.css owns the values; layout.tsx's two
#    themeColor entries are the documented exception (a meta tag cannot take
#    a CSS variable).
# Exceptions: <meta name="theme-color"> takes a literal colour, not a var().
gate "no raw hex in components" sh -c \
  "grep -rnE '#[0-9a-fA-F]{3,8}\b' $S --include='*.tsx' --include='*.ts' \
   | grep -v 'layout.tsx.*prefers-color-scheme' \
   | grep -v 'ThemeToggle.tsx.*theme-color\|ThemeToggle.tsx.*setAttribute'"

# 3. Bare white/black bypass the ink tokens.
gate "no bare white/black" grep -rnE '\b(bg|text|border)-(white|black)\b' "$S"

# 4. Tokens carry the mode difference, not the dark: variant.
gate "no dark: variant" grep -rn 'dark:' "$S" --include='*.tsx'

# 5. Custom properties do not resolve in SVG presentation attributes —
#    marks would silently vanish. Use fill-*/stroke-* classes instead.
gate "no var() in SVG attributes" grep -rnE '(fill|stroke)="var\(' "$S"

# 6. Money RENDERS go through <Money> so tabular figures are guaranteed.
#    inr() survives only where a plain string is required: an accessible name,
#    a live-region announcement, or a native confirm — text for assistive tech,
#    which is the one place a component cannot go.
gate "inr() only inside Money or strings" sh -c \
  "grep -rn 'inr(' $S --include='*.tsx' \
   | grep -v 'ui/Money.tsx' | grep -v 'aria-label' | grep -v 'aria-live' | grep -v 'window.confirm'"

# 7. The old brand name is gone from the UI.
# Scoped to components: "ledger" is also double-entry domain vocabulary.
gate "no 'Ledger' in UI" sh -c \
  "grep -rnw 'Ledger' $S --include='*.tsx' | grep -v 'LedgerTransaction'"

exit $fail
