"""Do: what an automation makes of the fields it read. Each step is optional, runs on its own (one failing never undoes another) and
writes down in `effects` exactly what it did, as ids, so Undo in the app can reverse precisely that.

  contact  find the person by email and +27 number (a repeat enquirer whose identifiers are all theirs joins their record) or
           make them; mark them a Lead with the source; put the conversation on their timeline. An identifier is never added to a
           contact found by another one, and a starred or non-Lead contact is never marked or linked: a partial match becomes a
           new Lead with a merge suggested for the user to confirm
  task     a task in the user's own task list through the task_updates queue ("Call Back Within 5 Minutes")
  draft    a pending draft the normal draft loop writes in the user's voice, with the lead's own address as its recipient;
           never the portal, and never sent: a draft only appears in the reply box
  urgent   the conversation is made urgent, which the existing push sender notices (its text carries no content)

Nothing here sends anything. Names, addresses and message text are sealed on the way in and never logged."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from .. import log
from ..crypto import address_index
from ..fields import ADDRESS, CONTACT_RELATIONSHIP, DRAFT, INSTRUCTION, LEAD_SOURCE, NAME, SUMMARY, TASK_NOTES, TASK_TITLE
from ..text import plain_dashes
from .spec import Do

LEAD = "Lead"
TASK_PROVIDERS = ("microsoft_todo", "google_tasks", "icloud_reminders")
MAX_PHRASE = 80  # characters of an outside name or listing put into a task title or a draft instruction


@dataclass
class Outcome:
    """What a run did: the contact, the ids to undo it with, and the steps that failed (names only)."""

    contact_id: str | None = None
    effects: dict[str, Any] = field(default_factory=dict)
    failed: list[str] = field(default_factory=list)


def phrase(value: str | None) -> str:
    """Outside text as one short plain line for a title or an instruction."""
    return plain_dashes(" ".join((value or "").split()))[:MAX_PHRASE].strip()


def task_title(template: str, name: str) -> str:
    """The task's title: the user's wording, then who to call. Written by us, from short checked pieces."""
    return f"{phrase(template)}: {phrase(name)}" if phrase(name) else phrase(template)


def draft_instruction(source: str, name: str, listing: str | None) -> str:
    """What the draft is asked to be. Only the checked name and listing go in, never the enquirer's message: the draft reads the
    conversation itself, inside the usual fence."""
    about = f" about {phrase(listing)}" if phrase(listing) else ""
    return (
        f"This is a new lead from {phrase(source) or 'a portal'}. Write a short, warm reply to {phrase(name)}{about}. Thank them for "
        "the enquiry, answer what they asked if the email says, and suggest a call or a viewing. The reply goes to their own email "
        "address, not to the portal, so write to them directly."
    )


class Doer:
    def __init__(self, db: Any, vault: Any):
        self.db = db
        self.vault = vault

    def run(self, do: Do, user: str, message: dict[str, Any], fields: dict[str, str]) -> Outcome:
        """Runs the steps the automation asks for, in order, for one email. Never raises."""
        out = Outcome()
        name = fields.get("name") or ""

        def step(label: str, fn: Any) -> None:
            try:
                fn()
            except Exception as err:
                out.failed.append(label)
                log.warn("automation step failed", step=label, code=log.code_of(err))

        if do.contact:
            step("contact", lambda: self._contact(do, user, message, fields, out))
        if do.task_title and do.contact and out.contact_id:
            step("task", lambda: self._task(do, user, message, fields, out))
        if do.draft and fields.get("email") and message.get("thread_id"):
            step("draft", lambda: self._draft(do, user, message, fields, out))
        if do.urgent and message.get("thread_id"):
            step("urgent", lambda: self._urgent(user, message, out))
        if not name and do.contact:
            out.failed.append("name")
        return out

    # Contact -------------------------------------------------------------------------------------

    def _index(self, user: str, value: str) -> str | None:
        keys = self.vault.keys_for(user)
        return address_index(keys, value) if keys else None

    def owner(self, user: str, kind: str, value: str | None) -> str | None:
        """The contact who has this email address or number, or None. Matched on the blind index; the same number written another
        way is the same number because it is normalised to +27 form first."""
        if not value:
            return None
        index = self._index(user, value)
        match = {"value_index": f"eq.{index}"} if index else {"value": f"eq.{value}"}
        row = self.db.first("contact_identities", {"select": "contact_id", "user_id": f"eq.{user}", "kind": f"eq.{kind}", **match})
        return row["contact_id"] if row else None

    def find_contact(self, user: str, email: str | None, phone: str | None) -> str | None:
        """The contact who has this email address, else the one with this number, or None."""
        return self.owner(user, "email", email) or self.owner(user, "phone", phone)

    def _identity(self, user: str, contact_id: str, kind: str, value: str) -> str | None:
        """Adds an email or number to a contact. Returns the new identity's id, or None when someone already has it."""
        row = {"user_id": user, "contact_id": contact_id, "kind": kind, "value": self.vault.seal(user, ADDRESS, value), "value_index": self._index(user, value), "source": "manual"}
        added = self.db.insert_new("contact_identities", row, "user_id,kind,value_index" if row["value_index"] else "user_id,kind,value")
        return added[0]["id"] if added else None

    def _contact(self, do: Do, user: str, message: dict[str, Any], fields: dict[str, str], out: Outcome, retry: bool = True) -> None:
        # The email and number come from the enquiry's body, which anyone can fill in. So an identifier is never added to a contact
        # found by another one: a client's address beside a stranger's number would make the stranger's WhatsApps that client's.
        given = {k: v for k, v in (("email", fields.get("email")), ("phone", fields.get("phone"))) if v}
        owners = {k: o for k, v in given.items() if (o := self.owner(user, k, v))}
        if given and len(owners) == len(given) and len(set(owners.values())) == 1:
            self._repeat(do, user, next(iter(owners.values())), out)  # every identifier is theirs: a repeat enquirer
        else:
            label = fields.get("name") or given.get("email") or given.get("phone") or ""
            if not self._new_lead(do, user, label, {k: v for k, v in given.items() if k not in owners}, set(owners.values()), out):
                if not retry:
                    raise RuntimeError("contact_lost")
                # Another run took every identifier between the lookup and the insert: look again, once.
                return self._contact(do, user, message, fields, out, retry=False)
        if do.link and message.get("thread_id") and out.contact_id and not out.effects.get("trusted"):
            linked = self.db.insert_new("thread_participants", {"thread_id": message["thread_id"], "contact_id": out.contact_id, "user_id": user}, "thread_id,contact_id")
            out.effects["linked"] = bool(linked)

    def _repeat(self, do: Do, user: str, found: str, out: Outcome) -> None:
        """Someone already a contact. A starred person, or one the user has called anything but a Lead, is not touched: an enquiry
        that only names their address must not mark them a Lead or put an outside conversation on their timeline."""
        out.contact_id, out.effects["contact_created"] = found, False
        current = self.db.first("contacts", {"select": "id,relationship,lead_source,vip", "id": f"eq.{found}", "user_id": f"eq.{user}"}) or {}
        relationship = self.vault.open(user, CONTACT_RELATIONSHIP, current.get("relationship"))
        if current.get("vip") or (relationship and relationship != LEAD):
            out.effects["trusted"] = True
            return
        source = phrase(do.source)
        patch: dict[str, Any] = {}
        if do.lead and not relationship:
            patch["relationship"] = self.vault.seal(user, CONTACT_RELATIONSHIP, LEAD)
            out.effects["set_lead"] = True
        if do.lead and source and not self.vault.open(user, LEAD_SOURCE, current.get("lead_source")):
            patch["lead_source"] = self.vault.seal(user, LEAD_SOURCE, source)
            out.effects["set_source"] = True
        if patch:
            self.db.update("contacts", {"id": f"eq.{found}", "user_id": f"eq.{user}"}, patch, minimal=True)

    def _new_lead(self, do: Do, user: str, name: str, unmatched: dict[str, str], others: set[str], out: Outcome) -> bool:
        """A new contact holding only the identifiers nobody has, with a merge suggested against each contact that has one of the
        others, for the user to confirm. False when every identifier it was to hold was taken meanwhile (the contact is removed)."""
        row: dict[str, Any] = {"user_id": user, "display_name": self.vault.seal(user, NAME, name)}
        if do.lead:
            row["relationship"] = self.vault.seal(user, CONTACT_RELATIONSHIP, LEAD)
            if phrase(do.source):
                row["lead_source"] = self.vault.seal(user, LEAD_SOURCE, phrase(do.source))
        created = self.db.insert("contacts", row)[0]["id"]
        taken = [k for k, v in unmatched.items() if self._identity(user, created, k, v) is None]
        if unmatched and len(taken) == len(unmatched):
            self.db.delete("contacts", {"id": f"eq.{created}", "user_id": f"eq.{user}"})
            return False
        out.contact_id, out.effects["contact_created"] = created, True
        suggested = [s for s in (self._suggest(user, created, other) for other in sorted(others)) if s]
        if suggested:
            out.effects["suggestion_ids"] = suggested
        return True

    def _suggest(self, user: str, a: str, b: str) -> str | None:
        """A pending merge suggestion between two contacts, shown with the linker's own. Never fails the step: the lead stands alone."""
        low, high = sorted((a, b))
        try:
            added = self.db.insert_new(
                "contact_suggestions", {"user_id": user, "contact_a": low, "contact_b": high, "reason": "other", "evidence": {"source": "automation"}, "score": 0.5},
                "user_id,contact_a,contact_b",
            )
            return added[0]["id"] if added else None
        except Exception as err:
            log.warn("merge suggestion not saved", code=log.code_of(err))
            return None

    # Task ----------------------------------------------------------------------------------------

    def _task(self, do: Do, user: str, message: dict[str, Any], fields: dict[str, str], out: Outcome) -> None:
        account = self.db.first(
            "accounts", {"select": "id", "user_id": f"eq.{user}", "provider": "in.(" + ",".join(TASK_PROVIDERS) + ")", "status": "eq.connected", "order": "created_at.asc"}
        )
        if not account:
            raise RuntimeError("no_task_list")
        notes = "\n".join(f"{label}: {fields[k]}" for k, label in (("phone", "Phone"), ("email", "Email"), ("listing_ref", "Listing"), ("listing_url", "Link")) if fields.get(k))
        due = datetime.now(timezone.utc) + timedelta(minutes=do.task_minutes)
        row_id = str(uuid.uuid4())  # chosen here so the title and notes are sealed for this row alone (packages/crypto/src/places.ts)
        row = self.db.insert(
            "task_updates",
            {
                "id": row_id, "user_id": user, "action": "create", "account_id": account["id"],
                "title": self.vault.seal(user, TASK_TITLE, task_title(do.task_title or "", fields.get("name") or ""), "task_updates.title", row_id),
                "notes": self.vault.seal(user, TASK_NOTES, notes, "task_updates.notes", row_id) if notes else None, "due_at": due.isoformat(), "due_all_day": False, "priority": 1,
                "contact_id": out.contact_id,
            },
        )[0]
        out.effects["task_update_id"] = row["id"]

    # Draft ---------------------------------------------------------------------------------------

    def _draft(self, do: Do, user: str, message: dict[str, Any], fields: dict[str, str], out: Outcome) -> None:
        thread = message["thread_id"]
        if self.db.first("drafts", {"select": "id", "thread_id": f"eq.{thread}", "status": "in.(pending,active)"}):
            return  # a draft is already there or on its way; this never replaces one
        row = self.db.insert(
            "drafts",
            {
                "user_id": user, "thread_id": thread, "account_id": message.get("account_id"), "for_message_id": message.get("id"), "contact_id": out.contact_id,
                "tone": "default", "status": "pending", "body": "", "reply_to": self.vault.seal(user, ADDRESS, fields["email"]),
                "instruction": self.vault.seal(user, INSTRUCTION, draft_instruction(do.source, fields.get("name") or "", fields.get("listing") or fields.get("listing_ref"))),
            },
        )[0]
        out.effects["draft_id"] = row["id"]

    # Urgent --------------------------------------------------------------------------------------

    def _urgent(self, user: str, message: dict[str, Any], out: Outcome) -> None:
        thread = message["thread_id"]
        before = self.db.first("threads", {"select": "priority,junk,needs_reply", "id": f"eq.{thread}", "user_id": f"eq.{user}"})
        if before is None:
            return
        out.effects["thread_before"] = {k: before.get(k) for k in ("priority", "junk", "needs_reply")}
        now_urgent = {"priority": "urgent", "junk": False, "needs_reply": True}
        self.db.update("threads", {"id": f"eq.{thread}", "user_id": f"eq.{user}"}, now_urgent, minimal=True)
        self.db.update("message_ai", {"message_id": f"eq.{message['id']}"}, now_urgent, minimal=True)
