"""Tests for ai.similar and the embedding pipeline: sealed vector round trips, nearest-neighbour search by cosine, the
vector cache, queued messages being embedded and saved sealed, and the seal_embeddings backfill."""

import base64
import random
import unittest
import unittest.mock

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

    def loads(self, db=None):
        """How many times the vectors were read: each read asks for every page at once, so its first page counts."""
        return len([c for c in (db or self.db).calls if c[0] == "select" and c[2] == "0"])

    def test_vectors_are_cached_then_reloaded(self):
        index = SimilarIndex(self.db, self.vault)
        index.replies("u", vec(1, 0), None, 3)
        index.replies("u", vec(1, 0), None, 3)
        self.assertEqual(self.loads(), 1)
        expired = SimilarIndex(self.db, self.vault, cache_s=0, stale_s=0)
        expired.replies("u", vec(1, 0), None, 3)
        expired.replies("u", vec(1, 0), None, 3)
        self.assertEqual(self.loads(), 3)

    def test_an_expired_entry_is_searched_while_it_is_read_again(self):
        import threading

        index = SimilarIndex(self.db, self.vault, cache_s=0)
        first = index._items("u")
        gate = threading.Event()
        load = index._load
        index._load = lambda user: (gate.wait(5), load(user))[1]  # the background read holds until released
        self.assertIs(index._items("u"), first)  # answered at once from the expired entry, not after the read
        self.assertIn("u", index._loading)
        self.assertIs(index._items("u"), first)
        gate.set()
        reading = index._loading.get("u")
        if reading is not None:
            reading.result(timeout=5)
        self.assertEqual(self.loads(), 2)  # one read in the background, however many asked meanwhile

    def test_one_read_is_shared_by_everyone_waiting_for_it(self):
        import threading

        index = SimilarIndex(self.db, self.vault)
        gate = threading.Event()
        load = index._load
        index._load = lambda user: (gate.wait(5), load(user))[1]
        got: list = []
        threads = [threading.Thread(target=lambda: got.append(index._items("u"))) for _ in range(3)]
        for t in threads:
            t.start()
        gate.set()
        for t in threads:
            t.join(5)
        self.assertEqual(len(got), 3)
        self.assertEqual(self.loads(), 1)

    def test_pages_are_read_at_the_same_time(self):
        import threading

        many = [stored(f"{i:04d}", "t", vec(1, i)) for i in range(25)]
        both = threading.Barrier(3, timeout=5)  # each of the three pages waits until all three were asked for

        class Slow(Db):
            def select(self, table, params):
                both.wait()
                return super().select(table, params)

        db = Slow(many)
        with unittest.mock.patch("ai.similar.PAGE", 10):
            items = SimilarIndex(db, Vault(db, MASTER_B64, True), max_vectors=25)._items("u")
        self.assertEqual([m for m, _, _ in items], [f"{i:04d}" for i in range(25)])  # in order, none twice

    def test_forget_drops_only_that_users_entry(self):
        index = SimilarIndex(self.db, self.vault)
        index.replies("u", vec(1, 0), None, 3)
        index.forget("u")
        index.replies("u", vec(1, 0), None, 3)
        self.assertEqual(self.loads(), 2)

    def test_defaults_keep_worst_case_memory_under_200_mb(self):
        from ai.similar import CACHE_S, MAX_USERS, MAX_VECTORS

        self.assertGreaterEqual(MAX_VECTORS, 2000)
        self.assertGreaterEqual(CACHE_S, 40 * 60)
        self.assertLess(MAX_USERS * MAX_VECTORS * 768 * 4, 200 * 1024 * 1024)

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
            return [{"message_id": "m1", "user_id": "u", "sent_at": "t", "messages": {"account_id": "a", "thread_id": "t7", "subject": "Hi", "body_text": "x", "body_html": None}}]
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

    def test_saving_an_embedding_adds_to_the_cache_instead_of_dropping_it(self):
        db = Queue()
        store = Embeddings(db, Gem(), "e", Vault(db, MASTER_B64, True))
        store.index._items("u")
        loads = len([c for c in db.calls if c[0] == "select"])
        forgotten = []
        store.index.forget = forgotten.append
        store.run_once()
        self.assertEqual(forgotten, [])
        ids = [m for m, _, _ in store.index._items("u")]
        self.assertEqual(ids[0], "m1")  # newest first
        self.assertEqual([t for m, t, _ in store.index._items("u") if m == "m1"], ["t7"])
        self.assertEqual(len([c for c in db.calls if c[0] == "select" and c[1] == "message_embeddings"]), loads)  # no second load

    def test_add_replaces_an_entry_for_the_same_message_and_ignores_an_uncached_user(self):
        db = Db([stored("a", "t1", vec(1, 0))])
        index = SimilarIndex(db, Vault(db, MASTER_B64, True))
        index.add("u", [("z", "t2", vec(0, 1))])  # not cached: nothing to update
        self.assertEqual(len(index._items("u")), 1)
        index.add("u", [("a", "t1", vec(0, 1)), ("b", "t3", vec(1, 0))])
        self.assertEqual([m for m, _, _ in index._items("u")], ["a", "b"])

    def test_a_message_without_its_conversation_drops_the_cache(self):
        db = Queue()
        store = Embeddings(db, Gem(), "e", Vault(db, MASTER_B64, True))
        forgotten = []
        store.index.forget = forgotten.append
        store._save([{"id": "m9", "user_id": "u", "sent_at": "t"}], [[1.0] + [0.0] * 767])
        self.assertEqual(forgotten, ["u"])

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
