"""The Claude API key, in memory only.

The Tauri shell pushes the key it read from Windows Credential Manager (PUT /ai/key)
and forgets it again (DELETE /ai/key). The engine never writes it to disk, never logs
it and never returns it; scrub() removes it from any text that might leave the engine.
"""

from __future__ import annotations

import re
import threading

# Anthropic keys look like sk-ant-<kind>-<base64url>; accept any sk-ant- token of sane length.
KEY_SHAPE = re.compile(r"^sk-ant-[A-Za-z0-9_\-]{16,400}$")
ANY_KEY = re.compile(r"sk-ant-[A-Za-z0-9_\-]{4,}")
REDACTED = "[redacted]"


class InvalidKey(ValueError):
    pass


class KeyStore:
    def __init__(self) -> None:
        self._key: str | None = None
        self._lock = threading.Lock()

    def set(self, key: str) -> None:
        key = (key or "").strip()
        if not KEY_SHAPE.match(key):
            raise InvalidKey("the value does not look like an Anthropic API key")
        with self._lock:
            self._key = key

    def clear(self) -> None:
        with self._lock:
            self._key = None

    @property
    def present(self) -> bool:
        return self._key is not None

    def get(self) -> str | None:
        """Only the AI service calls this, to build the API client."""
        return self._key

    def scrub(self, text: object) -> str:
        out = str(text)
        key = self._key
        if key:
            out = out.replace(key, REDACTED)
        return ANY_KEY.sub(REDACTED, out)

    def __repr__(self) -> str:  # never show the key in a traceback or a debugger
        return "KeyStore(present=%s)" % self.present

    __str__ = __repr__
