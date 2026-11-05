"""TLS for outgoing requests, always verified. The python.org build of Python on macOS ships without
root certificates until "Install Certificates" is run, so the system bundle is used as a fallback."""

from __future__ import annotations

import os
import ssl

_FALLBACK_BUNDLES = ["/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt", "/opt/homebrew/etc/openssl@3/cert.pem"]


def context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if ctx.cert_store_stats().get("x509_ca", 0) == 0:
        for path in _FALLBACK_BUNDLES:
            if os.path.exists(path):
                ctx.load_verify_locations(cafile=path)
                break
    return ctx


def default_for_libraries() -> str | None:
    """Points Python's own default certificates at the fallback bundle when it has none, for libraries that build
    their own context (pyicloud's trusted-device code prompt does, and failed every iCloud sign-in that needed a
    code). A set SSL_CERT_FILE is left alone. Returns the bundle it chose, or None when nothing was changed."""
    if os.environ.get("SSL_CERT_FILE") or ssl.create_default_context().cert_store_stats().get("x509_ca", 0):
        return None
    for path in _FALLBACK_BUNDLES:
        if os.path.exists(path):
            os.environ["SSL_CERT_FILE"] = path
            return path
    return None


CONTEXT = context()
