"""tls.py: libraries that build their own TLS context get the fallback bundle when this Python has no certificates."""

import os
import ssl
import tempfile
import unittest
from unittest import mock

from ai import tls


class DefaultForLibraries(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        os.environ.pop("SSL_CERT_FILE", None)
        self.bundle = tempfile.NamedTemporaryFile(suffix=".pem", delete=False)
        self.bundle.close()

    def tearDown(self):
        self.env.stop()
        os.unlink(self.bundle.name)

    def empty_store(self):
        ctx = mock.Mock()
        ctx.cert_store_stats.return_value = {"x509_ca": 0}
        return mock.patch.object(ssl, "create_default_context", return_value=ctx)

    def test_an_empty_store_points_python_at_the_bundle(self):
        with self.empty_store(), mock.patch.object(tls, "_FALLBACK_BUNDLES", ["/nowhere.pem", self.bundle.name]):
            self.assertEqual(tls.default_for_libraries(), self.bundle.name)
        self.assertEqual(os.environ["SSL_CERT_FILE"], self.bundle.name)

    def test_a_chosen_bundle_is_left_alone(self):
        os.environ["SSL_CERT_FILE"] = "/mine.pem"
        with self.empty_store(), mock.patch.object(tls, "_FALLBACK_BUNDLES", [self.bundle.name]):
            self.assertIsNone(tls.default_for_libraries())
        self.assertEqual(os.environ["SSL_CERT_FILE"], "/mine.pem")

    def test_a_python_with_certificates_is_not_changed(self):
        ctx = mock.Mock()
        ctx.cert_store_stats.return_value = {"x509_ca": 140}
        with mock.patch.object(ssl, "create_default_context", return_value=ctx):
            self.assertIsNone(tls.default_for_libraries())
        self.assertNotIn("SSL_CERT_FILE", os.environ)


if __name__ == "__main__":
    unittest.main()
