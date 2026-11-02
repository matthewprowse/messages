"""The default draft tone and the signature note in the draft prompt (drafts_prompt.build_prompt).

A tone chosen in Settings starts a fresh draft but loses to a tone picked for one draft; an email whose sender has a signature is
told not to write one; a chat never is."""

import unittest

from ai.drafts_prompt import DEFAULT_TONES, SIGNATURE_NOTE, build_prompt

BASE = dict(me="Matt", about="", rules=[], examples=[], recent=[], them="Sam", relationship="", style_note="", conversation=[("Sam", "Can you send the quote?")], instruction=None)


class DraftToneTests(unittest.TestCase):
    def test_default_tone_is_used_for_a_plain_draft(self):
        for tone, text in DEFAULT_TONES.items():
            self.assertIn(f"Tone: {text}", build_prompt(**BASE, tone="default", draft_tone=tone))
        self.assertIn("Tone: Their usual voice for this person.", build_prompt(**BASE, tone="default", draft_tone=None))
        self.assertIn("Tone: Their usual voice for this person.", build_prompt(**BASE, tone="default", draft_tone="loud"))

    def test_a_tone_picked_for_one_draft_wins(self):
        p = build_prompt(**BASE, tone="casual", draft_tone="formal")
        self.assertIn("More casual", p)
        self.assertNotIn(DEFAULT_TONES["formal"], p)

    def test_edits_keep_their_text_and_ignore_the_default(self):
        p = build_prompt(**BASE, tone="edit", edit="hi sam", draft_tone="formal")
        self.assertNotIn(DEFAULT_TONES["formal"], p)

    def test_signature_note_only_for_email_drafts(self):
        self.assertIn(SIGNATURE_NOTE, build_prompt(**BASE, tone="default", has_signature=True))
        self.assertNotIn(SIGNATURE_NOTE, build_prompt(**BASE, tone="default", has_signature=False))
        self.assertNotIn(SIGNATURE_NOTE, build_prompt(**BASE, tone="default", has_signature=True, channel="whatsapp"))


if __name__ == "__main__":
    unittest.main()
