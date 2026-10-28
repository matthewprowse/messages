"""Memory about people and companies. For everyone you have written to at least MIN_SENT times this
keeps two notes on their contact: how you write to them (style_note, used by every draft to them)
and who they are and what you discuss (ai_summary). They are written once and refreshed after
REFRESH_AFTER more messages with that person, at most every REFRESH_MIN_DAYS. Each company
(organization) gets a one or two sentence summary of what it sends you, refreshed after
ORG_REFRESH_AFTER more emails and ORG_REFRESH_MIN_DAYS, as what a company sends rarely changes. A few
are done per run, so a backlog is worked through slowly and cheaply.

Working out who is due reads a lot of mail, so a user is only looked at again when they have new
messages, have more due than one run does, or RESCAN_S has passed."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from . import log
from .crypto import address_index
from .fields import ADDRESS, BODY, CONTACT_STYLE_NOTE, CONTACT_SUMMARY, DOMAIN, HTML, SUBJECT
from .gemini import DEFAULT_LIMITS, Gemini, GeminiError, UsageContext
from .supabase import Supabase, in_list
from .text import UNTRUSTED, clean
from .vault import Vault
from .voice import tidy_rule

MIN_SENT = 3
REFRESH_AFTER = 5
REFRESH_MIN_DAYS = 3
ORG_REFRESH_AFTER = 20
ORG_REFRESH_MIN_DAYS = 30
RESCAN_S = 6 * 3600
PEOPLE_PER_RUN = 3
ORGS_PER_RUN = 10
EMAILS_PER_PERSON = 16
EMAIL_CHARS = 700
PROMPT_CHARS = 14000
RETRY_S = 6 * 3600
ENCRYPTED = [("subject", SUBJECT), ("body_text", BODY), ("body_html", HTML)]

PERSON_SCHEMA = {
    "type": "object",
    "properties": {
        "style_note": {"type": "string", "description": "One or two sentences on how you write to this person."},
        "summary": {"type": "string", "description": "Two or three sentences on who they are to you and what you discuss."},
    },
    "required": ["style_note", "summary"],
}

PERSON_SYSTEM = """Read emails between one person and someone they write to, and keep two short notes for that
person to read. Their own emails are marked "You". Write both notes to them as "you", never as "Me",
"the user" or their name.

style_note: one or two sentences on how you write to this person: greeting, sign-off, length, formality,
language and anything particular to them. Style only, not content. Example: "Casual and brief, opens
with 'Hey Sam', signs off 'Cheers, Matt'."

summary: two or three sentences on who this person is to you (their role, company and relationship, as
far as the emails show) and what you discuss. State only what the emails show; do not guess. Example:
"Sam is the office manager at Acme. You look after their IT and they write about faults and invoices."

Update the previous notes when given: keep what still holds, change what the newer emails show, and
reword anything that calls you "Me". Never use em dashes.""" + UNTRUSTED

ORG_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string", "description": "At most two short sentences, under 140 characters."}},
    "required": ["summary"],
}

ORG_SYSTEM = """You describe a company from the emails it sends one person, for their contacts list.
Write at most two short sentences: what kind of company it is, then what it sends them.
Example: "Airline. Sends booking confirmations and promotions." Example: "Bank. Sends statements and
security alerts." No marketing language, no greetings. Never use em dashes.""" + UNTRUSTED


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sent_counts(
    outbound: list[dict[str, Any]],
    identities: dict[str, str],
    own: set[str],
    participants: dict[str, list[str]] | None = None,
    own_contacts: set[str] | None = None,
) -> dict[str, list[str]]:
    """contact_id -> sent_at of each email you sent them, newest first. identities maps an address to
    its contact; your own addresses never count. An email to two addresses of one person counts once.
    Mail synced before recipients were stored has no to_addresses; it counts for the people in that
    conversation (participants, by thread) other than you."""
    out: dict[str, list[str]] = {}
    for m in outbound:
        to = m.get("to_addresses") or []
        if to:
            people = {identities[a.lower()] for a in to if a.lower() in identities and a.lower() not in own}
        else:
            people = set((participants or {}).get(m.get("thread_id") or "", [])) - (own_contacts or set())
        for contact_id in people:
            out.setdefault(contact_id, []).append(m["sent_at"])
    return out


def _after(times: list[str], since: str | None) -> int:
    """How many times fall after since. A message dated in the future (a sender with a wrong clock) only
    counts once its date has passed, so it cannot keep a note due on every run."""
    if since is None:
        return len(times)
    cutoff = _ts(since)
    now = datetime.now(timezone.utc)
    return sum(1 for t in times if cutoff < _ts(t) <= now)


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _days_since(value: str) -> float:
    return (datetime.now(timezone.utc) - _ts(value)).total_seconds() / 86400


def scan_due(previous: tuple[str | None, float, bool] | None, latest: str | None, now: float) -> bool:
    """Whether to work out again who is due for a user. previous is (newest message seen, when, whether
    more were due than that run did); latest is their newest message now."""
    if previous is None:
        return True
    seen, at, backlog = previous
    return backlog or latest != seen or now - at >= RESCAN_S


def people_due(sent: dict[str, list[str]], contacts: list[dict[str, Any]], inbound: dict[str, list[str]]) -> list[str]:
    """Contacts to (re)write, never-written first, then by how much new mail there is."""
    due: list[tuple[int, int, str]] = []
    for c in contacts:
        mine = sent.get(c["id"]) or []
        if len(mine) < MIN_SENT:
            continue
        since = c.get("style_updated_at")
        fresh = _after(mine, since) + _after(inbound.get(c["id"]) or [], since)
        if since is None:
            due.append((0, -fresh, c["id"]))
        elif fresh >= REFRESH_AFTER and _days_since(since) >= REFRESH_MIN_DAYS:
            due.append((1, -fresh, c["id"]))
    return [contact_id for _, _, contact_id in sorted(due)]


def orgs_due(orgs: list[dict[str, Any]], mail: dict[str, list[str]]) -> list[str]:
    """Organizations to (re)summarise: any with mail and no summary, or ORG_REFRESH_AFTER new emails
    and ORG_REFRESH_MIN_DAYS since."""
    due: list[tuple[int, int, str]] = []
    for o in orgs:
        times = mail.get(o["id"]) or []
        if not times:
            continue
        since = o.get("summary_updated_at")
        if not o.get("summary") or since is None:
            due.append((0, -len(times), o["id"]))
        elif _after(times, since) >= ORG_REFRESH_AFTER and _days_since(since) >= ORG_REFRESH_MIN_DAYS:
            due.append((1, -_after(times, since), o["id"]))
    return [org_id for _, _, org_id in sorted(due)]


def person_prompt(name: str, previous: dict[str, str], emails: list[tuple[str, str, str]]) -> str:
    """emails are (who, subject, text), oldest first; the newest are kept when over budget."""
    head = [f"The other person: {name}"]
    if previous.get("style_note") or previous.get("summary"):
        head += ["", "Previous notes:", f"style_note: {previous.get('style_note') or '(none)'}", f"summary: {previous.get('summary') or '(none)'}"]
    head += ["", "Emails, oldest first:"]
    used = sum(len(line) + 1 for line in head)
    blocks: list[str] = []
    for who, subject, text in reversed(emails):
        block = f"--- {who}, subject: {subject or '(none)'}\n{text}"
        if used + len(block) > PROMPT_CHARS:
            break
        blocks.append(block)
        used += len(block) + 1
    return "\n".join(head + blocks[::-1])


def org_prompt(name: str, domain: str, emails: list[tuple[str, str]]) -> str:
    """emails are (subject, text), newest first. Every subject, and the text of the first three."""
    lines = [f"Company: {name} ({domain})", "", "Subjects of their emails, newest first:"]
    lines += [f"- {subject or '(none)'}" for subject, _ in emails]
    lines += ["", "A few of them:"] + [f"--- {subject or '(none)'}\n{text[:500]}" for subject, text in emails[:3] if text]
    return "\n".join(lines)


def tidy_note(text: Any, limit: int) -> str:
    return tidy_rule(str(text or ""))[:limit].strip()


class People:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, fast_model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.fast_model = fast_model
        self.vault = vault or Vault(db)  # without one, plaintext passes through
        self._skip: dict[str, float] = {}  # id -> monotonic time to retry a contact or organization that failed, so it never blocks the queue
        self._scanned: dict[str, tuple[str | None, float, bool]] = {}  # user_id -> what scan_due needs
        self._backlog = False  # set during a user's run when more were due than it did
        self._summaries: dict[str, list[Any]] = {}  # user_id -> [day, summaries written that day]

    def run_once(self) -> int:
        accounts = self.db.select("accounts", {"select": "id,user_id,address,send_addresses,provider", "status": "neq.disconnected"})
        by_user: dict[str, list[dict[str, Any]]] = {}
        for a in accounts:
            by_user.setdefault(a["user_id"], []).append(a)
        done = 0
        for user_id, accts in by_user.items():
            own = {self._address(user_id, a["address"]) for a in accts if a.get("address")}
            own |= {self._address(user_id, s) for a in accts for s in a.get("send_addresses") or []}
            own.discard("")
            email_ids = [a["id"] for a in accts if a["provider"] in ("icloud", "gmail", "outlook", "imap")]
            if not email_ids:
                continue
            newest = self.db.first("messages", {"select": "created_at", "user_id": f"eq.{user_id}", "order": "created_at.desc"})
            latest = (newest or {}).get("created_at")
            if not scan_due(self._scanned.get(user_id), latest, time.monotonic()):
                continue
            self._backlog = False
            failed = False
            try:
                done += self._people(user_id, email_ids, own)
            except Exception as err:
                failed = True
                log.error("people learning failed", user=user_id, code=log.code_of(err))
            try:
                done += self._orgs(user_id)
            except Exception as err:
                failed = True
                log.error("organization summaries failed", user=user_id, code=log.code_of(err))
            self._scanned[user_id] = (latest, time.monotonic(), self._backlog or failed)
        return done

    def _summaries_left(self, user_id: str) -> bool:
        """False once this person has had summaries_per_day contact and company summaries written today (UTC),
        set in the admin panel. It counts what was written today, once for the day, then adds as it goes."""
        today = datetime.now(timezone.utc).date()
        made = self._summaries.get(user_id)
        if made is None or made[0] != today:
            start = f"gte.{today.isoformat()}T00:00:00+00:00"
            try:
                count = self.db.count("contacts", {"user_id": f"eq.{user_id}", "style_updated_at": start}) + self.db.count(
                    "organizations", {"user_id": f"eq.{user_id}", "summary_updated_at": start}
                )
            except Exception as err:  # never hold learning up over the count
                log.warn("summary count not read", code=log.code_of(err))
                return True
            made = self._summaries[user_id] = [today, count]
        cap = self.gemini.limits()["summaries_per_day"] if hasattr(self.gemini, "limits") else DEFAULT_LIMITS["summaries_per_day"]
        return made[1] < cap

    def _summarised(self, user_id: str) -> None:
        made = self._summaries.get(user_id)
        if made:
            made[1] += 1

    def _address(self, user_id: str, value: str | None) -> str:
        """A stored address as lowercase text, whether it is encrypted or not."""
        return (self.vault.open(user_id, ADDRESS, value) or "").strip().lower()

    @staticmethod
    def _guarded(step: Any, *args: Any) -> bool:
        """Runs one contact's or organization's step; an unexpected error counts as not done (so it is
        left for later) instead of ending the others' turn."""
        try:
            return bool(step(*args))
        except Exception as err:
            log.warn("people step failed", code=log.code_of(err))
            return False

    def _skipped(self, item_id: str) -> bool:
        return time.monotonic() < self._skip.get(item_id, 0.0)

    # People -----------------------------------------------------------------------------------------

    def _people(self, user_id: str, account_ids: list[str], own: set[str]) -> int:
        outbound = self.db.select(
            "messages",
            {
                "select": "thread_id,to_addresses,sent_at",
                "user_id": f"eq.{user_id}",
                "account_id": in_list(account_ids),
                "direction": "eq.outbound",
                "order": "sent_at.desc",
                "limit": "1000",
            },
        )
        if not outbound:
            return 0
        tally: dict[str, int] = {}
        for m in outbound:
            m["to_addresses"] = [self._address(user_id, a) for a in m.get("to_addresses") or []]
            for a in m["to_addresses"]:
                if a and a not in own:
                    tally[a] = tally.get(a, 0) + 1
        addresses = sorted(tally, key=lambda a: -tally[a])[:300]
        # People are found by their address's index, which is what the database matches on.
        keys = self.vault.keys_for(user_id)
        by_index = {address_index(keys, a): a for a in addresses + sorted(own)} if keys else {}
        rows = self.db.select(
            "contact_identities",
            {"select": "contact_id,value_index", "user_id": f"eq.{user_id}", "kind": "eq.email", "value_index": in_list(sorted(by_index))},
        ) if by_index else []
        found = [(by_index[r["value_index"]], r["contact_id"]) for r in rows if r.get("value_index") in by_index]
        identities = {a: c for a, c in found if a not in own}
        own_contacts = {c for a, c in found if a in own}
        no_to = sorted({m["thread_id"] for m in outbound if not m.get("to_addresses")})
        participants: dict[str, list[str]] = {}
        for i in range(0, len(no_to), 100):
            for r in self.db.select(
                "thread_participants", {"select": "thread_id,contact_id", "user_id": f"eq.{user_id}", "thread_id": in_list(no_to[i : i + 100])}
            ):
                participants.setdefault(r["thread_id"], []).append(r["contact_id"])
        sent = sent_counts(outbound, identities, own, participants, own_contacts)
        candidates = [c for c, times in sent.items() if len(times) >= MIN_SENT]
        if not candidates:
            return 0
        contacts = self.db.select(
            "contacts", {"select": "id,display_name,style_note,ai_summary,style_updated_at", "user_id": f"eq.{user_id}", "id": in_list(candidates)}
        )
        inbound_rows = self.db.select(
            "messages",
            {
                "select": "sender_contact_id,sent_at",
                "user_id": f"eq.{user_id}",
                "direction": "eq.inbound",
                "sender_contact_id": in_list(candidates),
                "order": "sent_at.desc",
                "limit": "2000",
            },
        )
        inbound: dict[str, list[str]] = {}
        for m in inbound_rows:
            inbound.setdefault(m["sender_contact_id"], []).append(m["sent_at"])

        by_id = {c["id"]: c for c in contacts}
        done = 0
        due = [c for c in people_due(sent, contacts, inbound) if not self._skipped(c)]
        self._backlog = self._backlog or len(due) > PEOPLE_PER_RUN
        for contact_id in due[:PEOPLE_PER_RUN]:
            if self._guarded(self._person, user_id, account_ids, by_id[contact_id]):
                done += 1
            else:
                self._skip[contact_id] = time.monotonic() + RETRY_S
        return done

    def _person(self, user_id: str, account_ids: list[str], contact: dict[str, Any]) -> bool:
        cols = "direction,subject,body_text,body_html,sent_at"
        theirs = self.db.select(
            "messages",
            {
                "select": cols,
                "user_id": f"eq.{user_id}",
                "direction": "eq.inbound",
                "sender_contact_id": f"eq.{contact['id']}",
                "order": "sent_at.desc",
                "limit": str(EMAILS_PER_PERSON // 2),
            },
        )
        # Your emails in conversations with them; older synced mail has no recipient list to match on.
        threads = self.db.select(
            "thread_participants", {"select": "thread_id", "user_id": f"eq.{user_id}", "contact_id": f"eq.{contact['id']}", "limit": "50"}
        )
        mine = (
            self.db.select(
                "messages",
                {
                    "select": cols,
                    "user_id": f"eq.{user_id}",
                    "account_id": in_list(account_ids),
                    "thread_id": in_list([t["thread_id"] for t in threads]),
                    "direction": "eq.outbound",
                    "order": "sent_at.desc",
                    "limit": str(EMAILS_PER_PERSON // 2),
                },
            )
            if threads
            else []
        )
        name = contact.get("display_name") or "Them"
        emails = sorted((self.vault.open_row(user_id, m, ENCRYPTED) for m in theirs + mine), key=lambda m: _ts(m["sent_at"]))
        texts = [
            ("You" if m["direction"] == "outbound" else name, m.get("subject") or "", clean(m.get("body_text"), m.get("body_html"), limit=EMAIL_CHARS))
            for m in emails
        ]
        texts = [t for t in texts if t[2]]
        if not texts:
            return False
        if not self._summaries_left(user_id):
            return False
        prompt = person_prompt(
            name,
            {
                "style_note": self.vault.open(user_id, CONTACT_STYLE_NOTE, contact.get("style_note")) or "",
                "summary": self.vault.open(user_id, CONTACT_SUMMARY, contact.get("ai_summary")) or "",
            },
            texts,
        )
        try:
            result = self.gemini.json(
                self.fast_model,
                PERSON_SYSTEM,
                prompt,
                PERSON_SCHEMA,
                UsageContext(user_id, "learn"),
                thinking="minimal",
                max_output=2048,
            )
        except GeminiError as err:
            log.warn("person notes failed", contact=contact["id"], status=err.status)
            return False
        style_note, summary = tidy_note(result.get("style_note"), 400), tidy_note(result.get("summary"), 600)
        patch: dict[str, Any] = {"style_updated_at": _now()}
        if style_note:
            patch["style_note"] = self.vault.seal(user_id, CONTACT_STYLE_NOTE, style_note)
        if summary:
            patch["ai_summary"] = self.vault.seal(user_id, CONTACT_SUMMARY, summary)
        self.db.update("contacts", {"id": f"eq.{contact['id']}", "user_id": f"eq.{user_id}"}, patch, minimal=True)
        self._summarised(user_id)
        log.info("person notes written", contact=contact["id"], emails=len(texts))
        return True

    # Organizations ----------------------------------------------------------------------------------

    def _orgs(self, user_id: str) -> int:
        orgs = self.db.select("organizations", {"select": "id,name,domain,summary,summary_updated_at", "user_id": f"eq.{user_id}", "limit": "1000"})
        for o in orgs:
            o["domain"] = self.vault.open(user_id, DOMAIN, o.get("domain")) or ""
        if not orgs:
            return 0
        members = self.db.select(
            "contacts", {"select": "id,organization_id", "user_id": f"eq.{user_id}", "organization_id": "not.is.null", "limit": "5000"}
        )
        org_of = {c["id"]: c["organization_id"] for c in members}
        if not org_of:
            return 0
        inbound = self.db.select(
            "messages",
            {
                "select": "sender_contact_id,sent_at",
                "user_id": f"eq.{user_id}",
                "direction": "eq.inbound",
                "sender_contact_id": "not.is.null",
                "order": "sent_at.desc",
                "limit": "5000",
            },
        )
        mail: dict[str, list[str]] = {}
        for m in inbound:
            org_id = org_of.get(m["sender_contact_id"])
            if org_id:
                mail.setdefault(org_id, []).append(m["sent_at"])
        by_id = {o["id"]: o for o in orgs}
        done = 0
        due = [o for o in orgs_due(orgs, mail) if not self._skipped(o)]
        self._backlog = self._backlog or len(due) > ORGS_PER_RUN
        for org_id in due[:ORGS_PER_RUN]:
            contact_ids = [c for c, o in org_of.items() if o == org_id]
            if self._guarded(self._org, user_id, by_id[org_id], contact_ids):
                done += 1
            else:
                self._skip[org_id] = time.monotonic() + RETRY_S
        return done

    def _org(self, user_id: str, org: dict[str, Any], contact_ids: list[str]) -> bool:
        rows = self.db.select(
            "messages",
            {
                "select": "subject,body_text,body_html",
                "user_id": f"eq.{user_id}",
                "direction": "eq.inbound",
                "sender_contact_id": in_list(contact_ids[:100]),
                "order": "sent_at.desc",
                "limit": "15",
            },
        )
        if not rows:
            return False
        if not self._summaries_left(user_id):
            return False
        rows = [self.vault.open_row(user_id, m, ENCRYPTED) for m in rows]
        emails = [(m.get("subject") or "", clean(m.get("body_text"), m.get("body_html"), limit=500)) for m in rows]
        try:
            result = self.gemini.json(
                self.fast_model,
                ORG_SYSTEM,
                org_prompt(org["name"], org["domain"], emails),
                ORG_SCHEMA,
                UsageContext(user_id, "learn"),
                thinking="minimal",
                max_output=2048,
            )
        except GeminiError as err:
            log.warn("organization summary failed", organization=org["id"], status=err.status)
            return False
        summary = tidy_note(result.get("summary"), 200)
        if not summary:
            return False
        self.db.update("organizations", {"id": f"eq.{org['id']}", "user_id": f"eq.{user_id}"}, {"summary": summary, "summary_updated_at": _now()}, minimal=True)
        self._summarised(user_id)
        log.info("organization summarised", organization=org["id"], emails=len(rows))
        return True
