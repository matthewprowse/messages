"""pyicloud's reminders as the rows stored in public.tasks. Pure: it reads attributes off pyicloud's
Reminder and RemindersList models by name, so it is unit tested with stand-ins and needs no pyicloud.

The row follows the tasks layer's contract (apps/worker/src/tasks/index.ts): title, notes and list name in
plain text here (the store seals them), an all-day due date as midnight UTC of the date ("2026-10-30T00:00:00Z")
with due_all_day true, a timed one as its instant, status open or completed with completed_at only on a
completed task, and priority 1 high, 2 medium, 3 low or null."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

COMPLETED_KEEP = timedelta(days=30)  # completed reminders older than this are not brought across
# A time with no zone is floating: Apple shows its clock reading as local time wherever you are. Konva does not
# know where the person is, so a floating time is read in South African time.
FLOATING_ZONE = "Africa/Johannesburg"
SA_OFFSET = timezone(timedelta(hours=2))


def priority(value: int) -> int | None:
    """Apple's 0 to 9 as tasks have it: 1 to 4 high, 5 medium, 6 to 9 low, anything else none."""
    if 1 <= value <= 4:
        return 1
    if value == 5:
        return 2
    if 6 <= value <= 9:
        return 3
    return None


def apple_priority(value: int | None) -> int:
    """Apple's value for a task priority: 1 high is 1, 2 medium is 5, 3 low is 9, none is 0."""
    return {1: 1, 2: 5, 3: 9}.get(value or 0, 0)


def apple_due(due_at: str | None, all_day: bool) -> tuple[datetime | None, bool, str | None]:
    """(due_date, all_day, time_zone) to write for a task's due. An all-day date is the date of its midnight
    UTC, written floating (no zone) as devices do; a timed due is its instant, zoned UTC so it stays that
    instant wherever the person is. No due date clears all three."""
    if not due_at:
        return None, False, None
    try:
        at = _utc(datetime.fromisoformat(str(due_at).replace("Z", "+00:00")))
    except ValueError:
        return None, False, None
    if all_day:
        return at.replace(hour=0, minute=0, second=0, microsecond=0), True, None
    return at, False, "UTC"


def _zone(name: str | None) -> Any:
    if name:
        try:
            return ZoneInfo(name)
        except Exception:
            pass
    try:
        return ZoneInfo(FLOATING_ZONE)
    except Exception:  # no time zone database on this machine
        return SA_OFFSET


def _utc(moment: datetime) -> datetime:
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def iso(moment: datetime) -> str:
    return _utc(moment).strftime("%Y-%m-%dT%H:%M:%SZ")


def due(reminder: Any) -> tuple[str | None, bool]:
    """(due_at, due_all_day). A day with no time is all day. A time with a zone is a real instant; one with
    none is floating, read in FLOATING_ZONE."""
    moment = getattr(reminder, "due_date", None)
    if moment is None:
        return None, True
    zone = getattr(reminder, "time_zone", None)
    at = _utc(moment)
    if getattr(reminder, "all_day", False):
        # Devices write an all-day date as a floating midnight. A value that is not midnight is a real instant.
        day = at.date() if (at.hour, at.minute, at.second) == (0, 0, 0) or not zone else at.astimezone(_zone(zone)).date()
        return f"{day.isoformat()}T00:00:00Z", True
    if zone:
        return iso(at), False
    wall = at.replace(tzinfo=None).replace(tzinfo=_zone(None))
    return iso(wall), False


def task_row(reminder: Any, list_name: str | None, now: datetime) -> dict[str, Any] | None:
    """The row for one reminder, text in plain, or None when it should not be stored: deleted, or completed
    more than 30 days ago."""
    if getattr(reminder, "deleted", False):
        return None
    completed = bool(getattr(reminder, "completed", False))
    completed_at = getattr(reminder, "completed_date", None) if completed else None
    if completed:
        finished = completed_at or getattr(reminder, "modified", None)
        if finished is not None and _utc(finished) < _utc(now) - COMPLETED_KEEP:
            return None
    due_at, all_day = due(reminder)
    return {
        "provider_task_id": reminder.id,
        "list_id": reminder.list_id,
        "list_name": (list_name or "").strip() or None,
        "title": (reminder.title or "").strip(),
        "notes": (getattr(reminder, "desc", None) or "").strip() or None,
        "due_at": due_at,
        "due_all_day": all_day,
        "status": "completed" if completed else "open",
        "completed_at": iso(completed_at) if completed and completed_at else None,
        "priority": priority(int(getattr(reminder, "priority", 0) or 0)),
        "provider_meta": {"change_tag": getattr(reminder, "record_change_tag", None)},
    }


def wanted_lists(lists: list[Any]) -> tuple[dict[str, str], set[str]]:
    """(names of the lists to read from, ids of lists that are gone). Groups only hold other lists."""
    names: dict[str, str] = {}
    gone: set[str] = set()
    for item in lists:
        if getattr(item, "deleted", False):
            gone.add(item.id)
        elif not getattr(item, "is_group", False):
            names[item.id] = item.title
    return names, gone
