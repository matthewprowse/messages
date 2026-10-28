"""The pyicloud client, set up the same way for every account, and the few things Konva needs that pyicloud
only offers as private methods.

The only module that imports pyicloud, and only when an account starts, so the rest of the AI worker and its
tests never need it installed (pip3 install -r apps/ai/requirements-icloud-reminders.txt). pyicloud 2026.10.1:
PyiCloudService (pyicloud/base.py) signs in with SRP and handles two-factor and the web-access consent that
Advanced Data Protection needs; its RemindersService (pyicloud/services/reminders) reads and writes the
com.apple.reminders CloudKit container."""

from __future__ import annotations

import logging
from typing import Any


def _silence() -> None:
    """pyicloud logs through the logging module; none of it is wanted in the worker's JSON log lines."""
    logger = logging.getLogger("pyicloud")
    logger.handlers = [logging.NullHandler()]
    logger.propagate = False
    logger.setLevel(logging.CRITICAL)


def make_api(apple_id: str, password: str | None, cookie_directory: str) -> Any:
    """A client for this Apple ID that has made no request yet. password is None when a saved session is
    all there is; pyicloud then cannot sign in again by itself, and says so when the session is no good.
    authenticate=False also keeps pyicloud from looking in the system keyring, which Konva never uses."""
    from pyicloud import PyiCloudService

    _silence()
    return PyiCloudService(apple_id, password, cookie_directory=cookie_directory, authenticate=False, with_family=False, refresh_interval=None)


def consent_needed(api: Any) -> bool:
    """Whether Apple will want a trusted device to approve web access before Reminders can be read, which
    is what Advanced Data Protection does (PyiCloudService._request_pcs_for_service asks the same question
    before it reads). False when it cannot tell: reading Reminders then finds out for itself."""
    try:
        state = api._check_pcs_consent()
        return bool(state.get("isICDRSDisabled", False)) and not state.get("isDeviceConsentedForPCS", True)
    except Exception:
        return False


def can_send_sms(api: Any) -> bool:
    """Whether Apple gave a trusted phone number to text a code to (PyiCloudService._trusted_phone_number;
    its _can_request_sms_2fa_code also needs Apple's default mode to be SMS, which a device prompt is not)."""
    try:
        return api._trusted_phone_number() is not None
    except Exception:
        return False


def send_sms(api: Any) -> None:
    """Texts a code to the trusted phone number (PyiCloudService._request_sms_2fa_code). Later code checks
    then go to Apple's SMS endpoint, as pyicloud follows its delivery method."""
    api._request_sms_2fa_code()
