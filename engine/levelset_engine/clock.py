"""New York time without tz files (Windows Python often has no tzdata).

Same DST rule the skills use: daylight time from 2:00 a.m. on the second Sunday
of March to 2:00 a.m. on the first Sunday of November (US rule since 2007).
"""

from __future__ import annotations

import datetime as dt

UTC = dt.timezone.utc
DEMO_NOW_ET = dt.datetime(2026, 10, 19, 10, 15)  # the README example, New York time


def _nth_sunday(year: int, month: int, n: int) -> dt.date:
    d = dt.date(year, month, 1)
    d += dt.timedelta(days=(6 - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def ny_offset_hours(utc_naive: dt.datetime) -> int:
    y = utc_naive.year
    start = dt.datetime.combine(_nth_sunday(y, 3, 2), dt.time(7, 0))
    end = dt.datetime.combine(_nth_sunday(y, 11, 1), dt.time(6, 0))
    return -4 if start <= utc_naive < end else -5


def to_ny(moment: dt.datetime) -> dt.datetime:
    """Aware (or naive UTC) datetime -> aware New York datetime with a fixed offset."""
    if moment.tzinfo is not None:
        moment = moment.astimezone(UTC).replace(tzinfo=None)
    off = ny_offset_hours(moment)
    return (moment + dt.timedelta(hours=off)).replace(tzinfo=dt.timezone(dt.timedelta(hours=off)))


def ny_local_to_utc(local: dt.datetime) -> dt.datetime:
    """Naive New York wall time -> aware UTC."""
    for off in (-4, -5):
        utc = local - dt.timedelta(hours=off)
        if ny_offset_hours(utc) == off:
            return utc.replace(tzinfo=UTC)
    return (local + dt.timedelta(hours=5)).replace(tzinfo=UTC)


def iso(moment: dt.datetime | None) -> str | None:
    """ISO-8601 with a New York offset (the API's timestamp convention)."""
    if moment is None:
        return None
    return to_ny(moment).isoformat(timespec="seconds")


def parse_iso(text: str | None) -> dt.datetime | None:
    if not text:
        return None
    try:
        d = dt.datetime.fromisoformat(str(text).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return d


class Clock:
    """Engine clock. In demo mode it is pinned to 2026-10-19 10:15 New York."""

    def __init__(self, fixed_et: dt.datetime | None = None) -> None:
        self._fixed = ny_local_to_utc(fixed_et) if fixed_et else None

    @property
    def pinned(self) -> bool:
        return self._fixed is not None

    def now(self) -> dt.datetime:
        if self._fixed is not None:
            return self._fixed
        return dt.datetime.now(UTC).replace(microsecond=0)

    def now_ny(self) -> dt.datetime:
        return to_ny(self.now())

    def today_ny(self) -> str:
        return self.now_ny().date().isoformat()

    def skill_now(self) -> str | None:
        """The --now value for skills ("2026-10-19 10:15", New York) or None for the real clock."""
        if self._fixed is None:
            return None
        return self.now_ny().strftime("%Y-%m-%d %H:%M")

    def skill_now_iso(self) -> str | None:
        """--now for skills that read ISO with an offset (trader-news)."""
        if self._fixed is None:
            return None
        return self.now_ny().isoformat(timespec="seconds")
