"""Annotation gating: the bar for saying anything at all lives in code.

Left to the model, ~93% of rows got annotated with things like "1 time this
month" — true, and useless. These tests pin the thresholds that took it to
~21%, which is where a note reads as a signal rather than wallpaper.
"""

from app.memory.writer import _worth_saying


def base(**over) -> dict:
    packet = {
        "merchant": "chai",
        "amount": "15",
        "category": "food",
        "times_this_month": 1,
        "times_this_week": 1,
        "first_time_here": False,
        "transactions_today": 1,
        "spend_today": "15",
        "_merchant_annotated_recently": False,
        "_day_total_already": False,
    }
    packet.update(over)
    return packet


def test_an_unremarkable_transaction_says_nothing():
    assert _worth_saying(base()) == []


def test_no_context_says_nothing():
    assert _worth_saying({}) == []


def test_a_repeated_merchant_becomes_a_habit_worth_noting():
    assert _worth_saying(base(times_this_month=2)) == []
    assert "recurrence" in _worth_saying(base(times_this_month=3))


def test_one_note_per_merchant_per_week():
    """Otherwise a daily habit annotates every row and the column is wallpaper."""
    busy = base(times_this_month=6, transactions_today=9)
    assert _worth_saying(busy) != []
    assert _worth_saying({**busy, "_merchant_annotated_recently": True}) == []


def test_outliers_need_a_real_baseline_not_a_ratio_alone():
    assert "outlier" in _worth_saying(base(times_typical=2.5))
    assert "outlier" in _worth_saying(base(times_typical=0.3))
    # Ordinary variation is not a story.
    assert _worth_saying(base(times_typical=1.2)) == []


def test_running_total_needs_a_busy_day_and_fires_once():
    assert _worth_saying(base(transactions_today=4)) == []
    assert "day_total" in _worth_saying(base(transactions_today=9))
    assert _worth_saying(base(transactions_today=9, _day_total_already=True)) == []
