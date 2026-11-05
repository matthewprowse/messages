"""Tests for the per-sender cap in ai.triage_signals: one outside sender cannot make the model read more than
SENDER_DAILY_CAP of their messages a day, the rest get a cheap visible verdict, starred and Always senders are never
capped, and the count starts again each UTC day."""

import unittest
from datetime import datetime, timezone

from ai.triage_signals import SenderCaps, UserContext, capped_outcome, sender_key


def msg(n, sender="flood@spam.example", user="u1", **kw):
    return {"id": f"m{n}", "user_id": user, "thread_id": f"t{n}", "sender_address": sender, "subject": f"Hello {n}", **kw}


DAY = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)


class Caps(unittest.TestCase):
    def test_a_flooding_sender_is_read_up_to_the_cap_and_the_rest_are_capped(self):
        caps = SenderCaps(cap=3)
        keep, over = caps.split([msg(i) for i in range(5)] + [msg(9, sender="client@firm.example")], {"u1": UserContext()}, DAY)
        self.assertEqual([m["id"] for m in keep], ["m0", "m1", "m2", "m9"])
        self.assertEqual([m["id"] for m in over], ["m3", "m4"])
        keep, over = caps.split([msg(10)], {"u1": UserContext()}, DAY)
        self.assertEqual((keep, [m["id"] for m in over]), ([], ["m10"]), "the count carries across batches")

    def test_the_count_starts_again_on_a_new_utc_day(self):
        caps = SenderCaps(cap=1)
        caps.split([msg(1)], {"u1": UserContext()}, DAY)
        self.assertEqual(len(caps.split([msg(2)], {"u1": UserContext()}, DAY)[1]), 1)
        self.assertEqual(len(caps.split([msg(3)], {"u1": UserContext()}, datetime(2026, 11, 4, 0, 1, tzinfo=timezone.utc))[0]), 1)

    def test_starred_contacts_and_always_senders_are_never_capped(self):
        caps = SenderCaps(cap=1)
        ctx = {"u1": UserContext(vip_contacts={"c1"}, always=["boss.example"])}
        notes = [msg(i, sender_contact_id="c1") for i in range(3)] + [msg(10 + i, sender="ceo@boss.example") for i in range(3)]
        keep, over = caps.split(notes, ctx, DAY)
        self.assertEqual((len(keep), over), (6, []))

    def test_each_user_has_their_own_count_and_the_blind_index_wins_over_the_address(self):
        caps = SenderCaps(cap=1)
        keep, over = caps.split([msg(1), msg(2, user="u2")], {}, DAY)
        self.assertEqual((len(keep), over), (2, []))
        self.assertEqual(sender_key(msg(1, sender_index="ix")), ("u1", "ix"))
        self.assertEqual(sender_key(msg(1, sender="A@B.example")), ("u1", "a@b.example"))
        self.assertEqual(sender_key({"user_id": "u1", "thread_id": "t9"}), ("u1", "thread:t9"))

    def test_a_capped_message_stays_visible_and_unjudged(self):
        out = capped_outcome(msg(1))
        self.assertEqual((out["priority"], out["junk"], out["needs_reply"], out["summary"]), ("normal", False, False, "Hello 1"))



class WiderCaps(unittest.TestCase):
    def test_a_sender_changing_addresses_on_one_domain_shares_that_domains_cap(self):
        caps = SenderCaps(cap=10, domain_cap=2, stranger_cap=100)
        keep, over = caps.split([msg(i, sender=f"user{i}@spam.example") for i in range(4)], {"u1": UserContext()}, DAY)
        self.assertEqual(([m["id"] for m in keep], [m["id"] for m in over]), (["m0", "m1"], ["m2", "m3"]))

    def test_a_shared_mailbox_domain_has_no_domain_cap(self):
        caps = SenderCaps(cap=10, domain_cap=1, stranger_cap=100)
        keep, over = caps.split([msg(i, sender=f"person{i}@gmail.com") for i in range(3)], {"u1": UserContext()}, DAY)
        self.assertEqual((len(keep), over), (3, []))

    def test_strangers_share_one_cap_and_contacts_do_not(self):
        caps = SenderCaps(cap=10, domain_cap=10, stranger_cap=2)
        notes = [msg(i, sender=f"s{i}@d{i}.example") for i in range(3)] + [msg(10, sender="known@d9.example", sender_contact_id="c1")]
        keep, over = caps.split(notes, {"u1": UserContext()}, DAY)
        self.assertEqual(([m["id"] for m in keep], [m["id"] for m in over]), (["m0", "m1", "m10"], ["m2"]))

if __name__ == "__main__":
    unittest.main()
