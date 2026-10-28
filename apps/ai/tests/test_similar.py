import base64
import random
import unittest

from ai.crypto import is_sealed_bytes
from ai.embed import Embeddings
from ai.fields import BODY
from ai.seal_embeddings import parse_vector, run as seal_run
from ai.similar import SimilarIndex, dot, nearest, open_vector, pack, seal_vector, unit, unpack
from ai.vault import Vault
from tests.test_vault import KEYS, MASTER_B64, wrapped_row


def vec(*head: float, size: int = 8) -> list[float]:
    return list(head) + [0.0] * (size - len(head))


class Db:
    """message_embeddings rows kept in a list, with just enough of PostgREST's filtering."""

    def __init__(self, rows=None, pairs=None):
        self.rows = rows or []
        self.pairs = pairs or {}
        self.calls: list[tuple] = []

    def first(self, table, params):
        if table == "user_keys":
            return wrapped_row("u")
        rows = self.select(table, {**params, "limit": "1"})
        return rows[0] if rows else None

    def select(self, table, params):
        self.calls.append(("select", table, params.get("offset")))
        rows = [r for r in self.rows if r["user_id"] == params["user_id"][3:]] if "user_id" in params else list(self.rows)
        if "message_id" in params and params["message_id"].startswith("eq."):
            rows = [r for r in rows if r["message_id"] == params["message_id"][3:]]
        if params.get("embedding_data") == "not.is.null":
            rows = [r for r in rows if r.get("embedding_data")]
        if params.get("embedding_data") == "is.null":
            rows = [r for r in rows if not r.get("embedding_data")]
        if params.get("embedding") == "not.is.null":
            rows = [r for r in rows if r.get("embedding")]
        if params.get("message_id", "").startswith("gt."):
            rows = [r for r in rows if r["message_id"] > params["message_id"][3:]]
        rows.sort(key=lambda r: r["message_id"])
        start = int(params.get("offset") or 0)
        return rows[start : start + int(params["limit"])]

    def rpc(self, function, args):
        self.calls.append(("rpc", function, args))
        assert function == "reply_pairs"
        return [self.pairs[i] for i in args["p_ids"] if i in self.pairs]

    def upsert(self, table, rows, on_conflict):
        self.calls.append(("upsert", table, rows))
        for new in rows:
            for r in self.rows:
                if r["message_id"] == new["message_id"]:
                    r.update(new)
                    break
            else:
                self.rows.append(dict(new))


def stored(mid, thread, vector):
    return {"message_id": mid, "user_id": "u", "sent_at": "t", "embedding_data": seal_vector(KEYS, vector), "messages": {"thread_id": thread}}


class Vectors(unittest.TestCase):
    def test_seal_round_trip_is_binary_sealed_and_unreadable(self):
        v = [0.25, -0.5, 1.0]
        sealed = seal_vector(KEYS, v)
        raw = base64.b64decode(sealed)
        self.assertTrue(is_sealed_bytes(raw))
        self.assertNotIn(pack(v), raw)
        self.assertEqual(list(open_vector(KEYS, sealed)), v)
        self.assertEqual(list(unpack(pack(v))), v)

    def test_a_vector_sealed_for_another_field_does_not_open(self):
        from ai.crypto import encrypt_bytes

        moved = base64.b64encode(encrypt_bytes(KEYS, BODY, pack([1.0]))).decode()
        with self.assertRaises(Exception):
            open_vector(KEYS, moved)

    def test_cosine_nearest_skips_the_current_thread(self):
        items = [("a", "t1", unit(vec(1, 0))), ("b", "t2", unit(vec(0.9, 0.1))), ("c", "t3", unit(vec(0, 1))), ("d", None, unit(vec(0.5, 0.5)))]
        got = nearest(items, vec(2, 0), "t1", 2)
        self.assertEqual([m for m, _ in got], ["b", "d"])
        self.assertAlmostEqual(got[0][1], 0.9 / (0.82 ** 0.5), places=5)
        self.assertEqual([m for m, _ in nearest(items, vec(2, 0), None, 1)], ["a"])

    def test_matches_a_brute_force_cosine(self):
        rnd = random.Random(1)
        raw = [[rnd.uniform(-1, 1) for _ in range(16)] for _ in range(50)]
        q = [rnd.uniform(-1, 1) for _ in range(16)]
        items = [(str(i), None, unit(v)) for i, v in enumerate(raw)]

        def cos(a, b):
            return sum(x * y for x, y in zip(a, b)) / ((sum(x * x for x in a) ** 0.5) * (sum(y * y for y in b) ** 0.5))

        want = sorted(range(50), key=lambda i: -cos(raw[i], q))[:5]
        self.assertEqual([int(m) for m, _ in nearest(items, q, None, 5)], want)

    def test_zero_vector_is_safe(self):
        self.assertEqual(dot(unit([0.0, 0.0]), [1.0, 1.0]), 0.0)


class Index(unittest.TestCase):
    def setUp(self):
        self.db = Db(
            [stored("a", "t1", vec(1, 0)), stored("b", "t2", vec(0.9, 0.1)), stored("c", "t3", vec(0, 1))],
            {
                "a": {"inbound_message_id": "a", "thread_id": "t1", "reply_text": "ra"},
                "b": {"inbound_message_id": "b", "thread_id": "t2", "reply_text": "rb"},
            },
        )
        self.vault = Vault(self.db, MASTER_B64, True)

    def test_replies_are_the_nearest_with_their_reply_and_score(self):
        rows = SimilarIndex(self.db, self.vault).replies("u", vec(1, 0), "t1", 3)
        self.assertEqual([r["inbound_message_id"] for r in rows], ["b"])  # t1 excluded, c has no reply
        self.assertGreater(rows[0]["similarity"], 0.9)
        [call] = [c for c in self.db.calls if c[0] == "rpc"]
        self.assertEqual(call[2]["p_ids"], ["b", "c"])  # nothing readable ever sent to the database

    def test_vectors_are_cached_then_reloaded(self):
        index = SimilarIndex(self.db, self.vault)
        index.replies("u", vec(1, 0), None, 3)
        index.replies("u", vec(1, 0), None, 3)
        self.assertEqual(len([c for c in self.db.calls if c[0] == "select"]), 1)
        expired = SimilarIndex(self.db, self.vault, cache_s=0)
        expired.replies("u", vec(1, 0), None, 3)
        expired.replies("u", vec(1, 0), None, 3)
        self.assertEqual(len([c for c in self.db.calls if c[0] == "select"]), 3)

    def test_most_recent_limit_and_paging(self):
        many = [stored(f"{i:04d}", "t", vec(1, i)) for i in range(25)]
        db = Db(many)
        index = SimilarIndex(db, Vault(db, MASTER_B64, True), max_vectors=12)
        self.assertEqual(len(index._items("u")), 12)

    def test_no_key_means_no_results(self):
        class NoKeys(Db):
            def first(self, table, params):
                return None

        db = NoKeys([stored("a", "t1", vec(1, 0))])
        self.assertEqual(SimilarIndex(db, Vault(db, MASTER_B64, True)).replies("u", vec(1, 0), None, 3), [])

    def test_unopenable_vectors_are_skipped(self):
        bad = stored("x", "t9", vec(1, 0))
        bad["embedding_data"] = base64.b64encode(b"junk").decode()
        db = Db([bad, stored("a", "t1", vec(1, 0))])
        self.assertEqual([m for m, _, _ in SimilarIndex(db, Vault(db, MASTER_B64, True))._items("u")], ["a"])


class Gem:
    def embed(self, model, texts, usage):
        return [[1.0] + [0.0] * 767 for _ in texts]


class Queue(Db):
    def select(self, table, params):
        if table == "message_embeddings" and params.get("embedding_data") == "is.null":
            self.calls.append(("queue", table))
            return [{"message_id": "m1", "user_id": "u", "sent_at": "t", "messages": {"account_id": "a", "subject": "Hi", "body_text": "x", "body_html": None}}]
        return super().select(table, params)


class EmbeddingStorage(unittest.TestCase):
    def test_a_queued_message_is_embedded_and_saved_sealed(self):
        db = Queue()
        store = Embeddings(db, Gem(), "e", Vault(db, MASTER_B64, True))
        self.assertEqual(store.run_once(), 1)
        [up] = [c for c in db.calls if c[0] == "upsert"]
        [row] = up[2]
        self.assertEqual(set(row), {"message_id", "user_id", "sent_at", "embedding_data"})
        self.assertEqual(list(open_vector(KEYS, row["embedding_data"]))[:2], [1.0, 0.0])
        self.assertEqual(store.stored("u", "m1")[:2], [1.0, 0.0])

    def test_a_user_without_a_key_is_not_embedded(self):
        class NoKeys(Queue):
            def first(self, table, params):
                return None

        db = NoKeys()
        store = Embeddings(db, Gem(), "e", Vault(db, MASTER_B64, True))
        self.assertEqual(store.run_once(), 0)
        self.assertFalse([c for c in db.calls if c[0] == "upsert"])


class SealBackfill(unittest.TestCase):
    def rows(self):
        return [
            {"message_id": "m1", "user_id": "u", "sent_at": "t", "embedding": "[1,0,0.5]"},
            {"message_id": "m2", "user_id": "u", "sent_at": "t", "embedding": "[0,1,0]", "embedding_data": "already"},
            {"message_id": "m3", "user_id": "u", "sent_at": "t", "embedding": "not a vector"},
        ]

    def test_dry_run_writes_nothing(self):
        db = Db(self.rows())
        counts = seal_run(db, Vault(db, MASTER_B64, True), apply=False)
        self.assertEqual((counts["found"], counts["sealed"], counts["bad"]), (2, 1, 1))
        self.assertFalse([c for c in db.calls if c[0] == "upsert"])

    def test_apply_seals_the_old_vector_and_keeps_it(self):
        db = Db(self.rows())
        counts = seal_run(db, Vault(db, MASTER_B64, True), apply=True)
        self.assertEqual(counts["sealed"], 1)
        m1 = db.rows[0]
        self.assertEqual(list(open_vector(KEYS, m1["embedding_data"])), [1.0, 0.0, 0.5])
        self.assertEqual(m1["embedding"], "[1,0,0.5]")  # the old column is left for the migration to drop
        self.assertEqual(seal_run(db, Vault(db, MASTER_B64, True), apply=True)["sealed"], 0)  # repeatable

    def test_parse_vector(self):
        self.assertEqual(parse_vector("[0.5,-1]"), [0.5, -1.0])
        self.assertIsNone(parse_vector("x"))
        self.assertIsNone(parse_vector("[]"))


if __name__ == "__main__":
    unittest.main()
