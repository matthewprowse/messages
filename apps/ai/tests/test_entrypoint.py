"""The AI worker's entry point must compile and import. The other tests never import ai/__main__.py, so a syntax error
there (a comment that swallowed the end of the jobs list once did) left the whole worker unable to start while every test passed."""

import importlib
import py_compile
import unittest
from pathlib import Path


class EntryPoint(unittest.TestCase):
    def test_main_compiles(self):
        py_compile.compile(str(Path(__file__).resolve().parents[1] / "ai" / "__main__.py"), doraise=True)

    def test_main_imports_and_has_a_main(self):
        module = importlib.import_module("ai.__main__")
        self.assertTrue(callable(getattr(module, "main", None)))


if __name__ == "__main__":
    unittest.main()
