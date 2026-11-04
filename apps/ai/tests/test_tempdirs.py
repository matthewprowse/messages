"""Tests for ai.connectors.tempdirs: a connector's own stale temporary folders are removed at startup, while recent ones
(another process may be using them), other names and files are left alone."""

import os
import tempfile
import time
import unittest

from ai.connectors.tempdirs import sweep_stale


class StaleFolders(unittest.TestCase):
    def test_only_old_folders_with_the_prefix_are_removed(self):
        with tempfile.TemporaryDirectory() as root:
            old, fresh, other = (os.path.join(root, n) for n in ("konva-icloud-old", "konva-icloud-new", "something-else"))
            for path in (old, fresh, other):
                os.mkdir(path)
                with open(os.path.join(path, "me.cookiejar"), "w") as f:
                    f.write("x")
            with open(os.path.join(root, "konva-icloud-file"), "w") as f:
                f.write("x")
            now = time.time()
            for path in (old, other, os.path.join(old, "me.cookiejar"), os.path.join(other, "me.cookiejar")):
                os.utime(path, (now - 7 * 3600, now - 7 * 3600))
            self.assertEqual(sweep_stale("konva-icloud-", root, now=now), 1)
            self.assertEqual(sorted(os.listdir(root)), ["konva-icloud-file", "konva-icloud-new", "something-else"])

    def test_a_folder_whose_files_were_rewritten_recently_is_in_use(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "konva-ig-x")
            os.mkdir(path)
            with open(os.path.join(path, "f"), "w") as f:
                f.write("x")
            now = time.time()
            os.utime(path, (now - 7 * 3600, now - 7 * 3600))
            self.assertEqual(sweep_stale("konva-ig-", root, now=now), 0)
            self.assertTrue(os.path.isdir(path))

    def test_a_missing_temp_folder_is_not_an_error(self):
        self.assertEqual(sweep_stale("konva-ig-", "/nonexistent/konva-test"), 0)


if __name__ == "__main__":
    unittest.main()
