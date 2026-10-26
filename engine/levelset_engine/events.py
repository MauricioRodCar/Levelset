"""In-process pub/sub for the /events SSE stream."""

from __future__ import annotations

import asyncio
import json
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subs: set[asyncio.Queue[tuple[str, str]]] = set()

    def subscribe(self) -> asyncio.Queue[tuple[str, str]]:
        q: asyncio.Queue[tuple[str, str]] = asyncio.Queue(maxsize=1000)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[tuple[str, str]]) -> None:
        self._subs.discard(q)

    def publish(self, event: str, data: Any) -> None:
        """Call from the event loop thread."""
        payload = json.dumps(data, separators=(",", ":"))
        for q in list(self._subs):
            try:
                q.put_nowait((event, payload))
            except asyncio.QueueFull:
                pass

    @property
    def subscribers(self) -> int:
        return len(self._subs)
