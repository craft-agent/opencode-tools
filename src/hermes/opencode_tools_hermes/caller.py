"""Whose call the command line is told a call is."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import Any

#: The caller of a call Hermes gave no session id.
CALLER_FALLBACK = "hermes"

#: The most characters the command line accepts for a caller.
MAX_CALLER_LENGTH = 200

#: What a caller that stands for a session id the command line cannot take unchanged starts with.
DIGEST_PREFIX = "sha256:"


def caller_flags(call_kwargs: Mapping[str, Any]) -> list[str]:
    """The flag that tells the command line whose call this is.

    The caller is the Hermes session id stripped of surrounding whitespace, when it is a string
    of at most ``MAX_CALLER_LENGTH`` printable characters. A missing, non-string or blank id gives
    ``CALLER_FALLBACK``; an id that is too long or holds a control or non-space whitespace
    character gives ``sha256:`` and the SHA-256 digest of its UTF-8 bytes, so it is never cut
    into one caller with another. It never raises.

    The value is joined to its flag with ``=``, so one that starts with ``--`` is read as a value.
    """
    session_id = call_kwargs.get("session_id")
    value = session_id.strip() if isinstance(session_id, str) else ""
    if not value:
        return [f"--caller={CALLER_FALLBACK}"]
    if len(value) <= MAX_CALLER_LENGTH and value.isprintable():
        return [f"--caller={value}"]
    digest = hashlib.sha256(value.encode("utf-8", "surrogatepass")).hexdigest()
    return [f"--caller={DIGEST_PREFIX}{digest}"]
