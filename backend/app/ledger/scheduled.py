"""Everything that should have posted itself by now.

Recurring commitments and EMIs are described to the user as posting on their
own each period, and that was only true if the user typed: the catch-up ran
from `/chat` alone. Someone who only spoke never triggered it, so their rent,
salary, SIP and EMI silently never posted.

There is no scheduler — the deadline does not justify one, and a cron that
walks every user is worse than a catch-up that runs when the user shows up.
So this runs on any authenticated activity, text or voice, and stays cheap
because `_periods_due` returns nothing once a period is already posted.
"""

from app.ledger import loans, recurring
from app.tasks import fire_and_forget


def catch_up(user_handle: str) -> None:
    """Fire-and-forget: post anything whose period has arrived."""
    fire_and_forget(recurring.post_due(user_handle), "recurring-post")
    fire_and_forget(loans.post_due(user_handle), "emi-post")
