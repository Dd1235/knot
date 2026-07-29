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
        "seen_here_last_month": 4,
        "same_amount_months": 0,
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


def test_a_settled_habit_is_not_news():
    """The user knows where they eat. 29 visits this month says nothing."""
    assert _worth_saying(base(times_this_month=29, seen_here_last_month=27)) == []


def test_a_habit_that_just_formed_is_news():
    assert "frequency" in _worth_saying(
        base(times_this_month=3, seen_here_last_month=0))
    # Two visits is not yet a habit, however new.
    assert _worth_saying(base(times_this_month=2, seen_here_last_month=0)) == []


def test_a_subscription_repeats_across_months_not_across_mornings():
    """Counting same-amount charges alone called a 38-rupee bus fare a
    subscription, because it is the same 38 rupees every morning."""
    assert "recurrence" in _worth_saying(base(same_amount_months=2))
    assert _worth_saying(base(same_amount_months=1)) == []


def test_one_note_per_merchant_per_week():
    """Otherwise a daily habit annotates every row and the column is wallpaper."""
    busy = base(times_this_month=6, transactions_today=9)
    assert _worth_saying(busy) != []
    assert _worth_saying({**busy, "_merchant_annotated_recently": True}) == []


def test_a_price_is_compared_to_the_same_merchant_not_the_category():
    """Against a category median, an 859-rupee bakery run read as "higher than
    typical shopping (286)" — a bakery is not every shop you have visited."""
    assert "outlier" in _worth_saying(base(times_usual=2.5))
    assert "outlier" in _worth_saying(base(times_usual=0.3))
    # Ordinary variation is not a story.
    assert _worth_saying(base(times_usual=1.2)) == []


def test_running_total_needs_a_busy_day_and_fires_once():
    assert _worth_saying(base(transactions_today=4)) == []
    assert "day_total" in _worth_saying(base(transactions_today=9))
    assert _worth_saying(base(transactions_today=9, _day_total_already=True)) == []


def test_the_model_only_sees_numbers_its_gate_opened_for():
    """Gating the kind was not enough — the model kept reaching past it for the
    dullest number in the packet."""
    from app.memory.writer import _narrow

    packet = base(times_this_month=29, spend_today="4000", same_amount_months=3,
                  usually_here="286", times_usual=3.1)
    narrow = _narrow(packet, ["recurrence"])
    assert "same_amount_months" in narrow
    assert "times_this_month" not in narrow   # the boring one it kept grabbing
    assert "spend_today" not in narrow
    assert set(narrow) >= {"merchant", "amount"}
