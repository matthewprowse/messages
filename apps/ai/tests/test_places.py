"""Tests for ai/places.py: the AI worker names a sealed value's place exactly as packages/crypto/src/places.ts does,
so a value the connectors seal opens for the web app and the sync worker."""

import unittest

from ai import places


class Places(unittest.TestCase):
    def test_a_place_is_table_dot_column(self):
        self.assertEqual(places.place_of("outbox", "body"), "outbox.body")

    def test_the_connectors_columns_are_named_as_the_sync_worker_names_them(self):
        self.assertEqual(places.CONTACT_NAME, "contacts.display_name")
        self.assertEqual(places.THREAD_GROUP_NAME, "threads.group_name")
        self.assertEqual(places.MESSAGE_BODY, "messages.body_text")
        self.assertEqual(places.MESSAGE_PREVIEW, "messages.preview")
        self.assertEqual(places.ATTACHMENT_FILENAME, "attachments.filename")
        self.assertEqual((places.TASK_TITLE, places.TASK_NOTES, places.TASK_LIST_NAME), ("tasks.title", "tasks.notes", "tasks.list_name"))


if __name__ == "__main__":
    unittest.main()
