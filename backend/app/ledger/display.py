"""Display currency, for what the agent says.

The ledger stores rupees and always will — see `currency.ts` on the frontend
for the same argument. This is the mirror of that file on the server side, and
it exists for one reason: when someone switches the display to dollars, the
figures the agent *speaks* have to match the figures on screen, or the product
is telling them two different things about the same money.

Two rules keep this from corrupting anything:

1. **Nothing here is ever stored.** Conversion happens at the tool boundary —
   incoming amounts convert to rupees before they reach the ledger, outgoing
   amounts convert to the display unit after they leave it. `transaction_legs`
   never learns another currency exists.
2. **The model never converts.** It receives amounts already labelled with
   their unit and repeats them. A model asked to multiply by 0.0115 in its head
   will eventually get it wrong, in front of someone.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

TWO_PLACES = Decimal("0.01")

# Symbol and minor-unit width per currency. Mirrors CURRENCIES in
# frontend/src/lib/currency.ts — JPY has no minor unit, so forcing two decimals
# there looks wrong in speech as well as on screen.
SPEC: dict[str, tuple[str, int]] = {
    "INR": ("₹", 2),
    "USD": ("$", 2),
    "EUR": ("€", 2),
    "GBP": ("£", 2),
    "AED": ("AED ", 2),
    "SGD": ("S$", 2),
    "AUD": ("A$", 2),
    "CAD": ("C$", 2),
    "JPY": ("¥", 0),
}


@dataclass(frozen=True)
class Currency:
    """What one rupee is worth in the unit the user is reading.

    `per_rupee` matches the frontend's `perRupee`: multiply rupees by it to get
    the display amount. INR is 1 by definition.
    """

    code: str = "INR"
    per_rupee: Decimal = Decimal(1)

    @property
    def is_rupees(self) -> bool:
        return self.code == "INR" or self.per_rupee == 1

    @classmethod
    def parse(cls, raw: dict | None) -> "Currency":
        """Build from whatever the client sent, falling back to rupees.

        Deliberately forgiving: a malformed currency must never take down a
        turn, it must just mean "no conversion".
        """
        if not raw:
            return cls()
        code = str(raw.get("code") or "INR").upper()
        if code not in SPEC:
            return cls()
        try:
            per_rupee = Decimal(str(raw.get("per_rupee")))
        except Exception:
            return cls()
        if per_rupee <= 0:
            return cls()
        return cls(code=code, per_rupee=per_rupee)


def to_display(rupees: Decimal | str | int | float, currency: Currency) -> str:
    """A rupee figure as a labelled string in the user's unit.

    Returns a string rather than a number on purpose: the label and the value
    travel together, so the model cannot pair a figure with the wrong unit.
    """
    amount = Decimal(str(rupees)) * currency.per_rupee
    symbol, places = SPEC.get(currency.code, ("₹", 2))
    quantum = Decimal(1) if places == 0 else TWO_PLACES
    return f"{symbol}{amount.quantize(quantum, ROUND_HALF_UP)}"


def to_rupees(amount: Decimal | str | int | float, currency: Currency) -> Decimal:
    """An amount the user stated, in rupees, ready for the ledger."""
    value = Decimal(str(amount))
    if currency.is_rupees:
        return value.quantize(TWO_PLACES, ROUND_HALF_UP)
    return (value / currency.per_rupee).quantize(TWO_PLACES, ROUND_HALF_UP)


def money_fields(row: dict, keys: tuple[str, ...], currency: Currency) -> dict:
    """Label named rupee fields of a dict, returning a copy.

    Labels even when the currency IS rupees. Bare numbers are exactly what let
    the agent say "dollars" about a rupee figure — if the unit only appears in
    the non-default case, the default case stays lossy and the bug comes back
    the moment someone reads a figure without one.
    """
    out = dict(row)
    for key in keys:
        if out.get(key) is not None:
            out[key] = to_display(out[key], currency)
    return out
