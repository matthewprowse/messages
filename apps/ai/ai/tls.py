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


CONTEXT = context()
