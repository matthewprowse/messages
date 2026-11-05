"""The REST client's error handling: an answer that is not rows must raise, never be read as rows."""

import json
import unittest
from unittest import mock

from ai import supabase
from ai.http import Response
from ai.supabase import Supabase, SupabaseError


def answer(status: int, body: object) -> Response:
    return Response(status, {}, json.dumps(body).encode())


class StatusTests(unittest.TestCase):
    def setUp(self):
        self.db = Supabase("https://example.supabase.co", "key")

    def test_ambiguous_embed_raises(self):
        # PostgREST answers 300 when an embed matches two links (outbox has thread_id and for_thread_id). Read as
        # rows, the error body's keys came back as strings and the Instagram sync failed with an AttributeError.
        body = {"code": "PGRST201", "details": [], "hint": "", "message": ""}
        with mock.patch.object(supabase.POOL, "request", return_value=answer(300, body)):
            with self.assertRaises(SupabaseError) as caught:
                self.db.select("outbox", {"select": "id,threads(id)"})
        self.assertEqual(caught.exception.code, "PGRST201")

    def test_rows_come_back(self):
        with mock.patch.object(supabase.POOL, "request", return_value=answer(200, [{"id": "a"}])):
            self.assertEqual(self.db.select("outbox", {"select": "id"}), [{"id": "a"}])


if __name__ == "__main__":
    unittest.main()
