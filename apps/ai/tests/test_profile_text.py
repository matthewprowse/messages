"""The profile's About and Important People are sealed by the web app; the AI worker opens them, and still reads the
plain text written before that."""

import unittest

from ai.crypto import derive_user_keys
from ai.fields import PROFILE_ABOUT, PROFILE_PEOPLE
from ai.triage_context import ContextMixin
from ai.vault import Vault

KEYS = derive_user_keys(bytes(range(32)))


def vault():
    v = Vault(object(), None, True)
    v.keys_for = lambda user_id: KEYS
    return v


class Db:
    def __init__(self, profile):
        self.profile = profile

    def first(self, table, params):
        return self.profile

    def select(self, table, params):
        return []


class ProfileText(unittest.TestCase):
    def test_about_and_important_people_open_whether_sealed_or_plain(self):
        v = vault()
        sealed = {"display_name": "Matt", "about": v.seal("u", PROFILE_ABOUT, "Estate agent"), "important_people": v.seal("u", PROFILE_PEOPLE, "Sam, my partner")}
        plain = {"display_name": "Matt", "about": "Estate agent", "important_people": "Sam, my partner"}
        self.assertTrue(sealed["about"].startswith("e1:"))
        for profile in (sealed, plain):
            host = ContextMixin()
            host.db, host.vault = Db(profile), v
            ctx = host._user_context("u")
            self.assertEqual((ctx.about, ctx.important_people), ("Estate agent", "Sam, my partner"))


if __name__ == "__main__":
    unittest.main()
