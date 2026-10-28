"""The company voice of a team (step 6 of Teams, supabase/migrations/20261104100000_team_after_launch.sql).

Owners and admins teach the AI how the business writes in Settings, Team, Company Voice: a profile (tone, sign-off,
things to always say and never say), templates (a name and a body) and company facts (a title and a body, such as
prices, listings, office hours and FAQs). All of it is sealed with the team key ("t1:").

Drafting reads it for a chat that is a work chat (or a shared inbox chat) and for nothing else: the database function
company_voice_for_draft returns it only for a chat with a workspace, to a person who is an active member of that
workspace and who is the chat's agent, assigned to it or covering for the agent. A personal chat has no workspace, so
it gets nothing and its prompt is exactly what it was before teams. This module only opens and trims what that
function returned.

The company voice sits under the person's own style. In the prompt it comes after the person's own rules and facts and
before their saved examples and sent mail, and the system text (COMPANY_SYSTEM) says who wins: the person's own style
decides wording, greeting and sign-off; the company's always and never rules and its facts decide content. The caps
below keep it small, since it is part of every work-chat draft's cost and that cost counts against the person's (and
the team's) AI allowance like the rest of the prompt."""

from __future__ import annotations

from typing import Any, Callable

from .fields import NOTE, NOTE_TITLE, STYLE_RULE, WRITING_BODY, WRITING_SITUATION

PROFILE_CHARS = 600  # of the tone, and of the sign-off
RULE_LINES = 12  # always or never lines
RULE_CHARS = 200  # of one such line
TEMPLATE_CHARS = 600  # of one template
TEMPLATES_CHARS = 3000  # of all of them
COMPANY_FACT_CHARS = 500  # of one company fact
COMPANY_FACTS_CHARS = 4000  # of all of them

COMPANY_SYSTEM = """

This is a work chat for a business. The prompt gives "How the business writes", always and never rules, company facts and approved wording.
- Their own style wins on wording: their examples, their rules and their own messages in this conversation decide greeting, sign-off, length and register. The business's tone and sign-off are only a default for when they have no habit of their own.
- The business wins on content: when the reply needs something a company rule or fact covers, say it that way. Never say anything a "never" rule forbids, and say what an "always" rule asks for when the reply calls for it.
- Quote company facts exactly (figures, dates, names) and use one only when the reply needs it. Never invent a company fact, price or policy, and never use one for a question it does not answer.
- Approved wording is for the situation it names: adapt it to this reply and keep what it promises, never add to it."""


def _lines(text: str, limit: int, chars: int) -> list[str]:
    out = []
    for raw in text.replace("\r", "").split("\n"):
        line = raw.strip().lstrip("-*").strip()
        if line:
            out.append(line[:chars])
        if len(out) >= limit:
            break
    return out


def pick_company(items: list[dict[str, Any]], opened: Callable[[str, Any], str]) -> dict[str, Any] | None:
    """The company voice as the prompt shows it, from the items company_voice_for_draft returned (still sealed).
    opened(field, value) opens one value ("" when it cannot be opened, which leaves that item out). None when there
    is nothing to say. Order is the database's, so the start of the prompt stays the same from draft to draft."""
    profile: dict[str, str] = {}
    templates: list[tuple[str, str]] = []
    facts: list[tuple[str, str]] = []
    templates_room, facts_room = TEMPLATES_CHARS, COMPANY_FACTS_CHARS
    for item in items or []:
        kind = item.get("kind")
        if kind == "profile":
            text = (opened(STYLE_RULE, item.get("body")) or "").strip()
            if text and item.get("slot"):
                profile[item["slot"]] = text
        elif kind == "template":
            name = (opened(WRITING_SITUATION, item.get("title")) or "").strip()
            body = (opened(WRITING_BODY, item.get("body")) or "").strip()[:TEMPLATE_CHARS]
            if name and body and templates_room > 0:
                body = body[:templates_room]
                templates_room -= len(body)
                templates.append((name, body))
        elif kind == "fact":
            title = (opened(NOTE_TITLE, item.get("title")) or "").strip()
            body = (opened(NOTE, item.get("body")) or "").strip()[:COMPANY_FACT_CHARS]
            if body and facts_room > 0:
                body = body[:facts_room]
                facts_room -= len(body)
                facts.append((title, body))
    company = {
        "tone": profile.get("tone", "")[:PROFILE_CHARS],
        "sign_off": profile.get("sign_off", "")[:PROFILE_CHARS],
        "always": _lines(profile.get("always", ""), RULE_LINES, RULE_CHARS),
        "never": _lines(profile.get("never", ""), RULE_LINES, RULE_CHARS),
        "templates": templates,
        "facts": facts,
    }
    return company if any(company.values()) else None


def company_lines(company: dict[str, Any] | None) -> list[str]:
    """The prompt's company section, as lines (empty for a personal chat, which has none)."""
    if not company:
        return []
    lines: list[str] = []
    if company.get("tone") or company.get("sign_off"):
        lines += ["", "How the business they work for writes (their own style above wins on wording):"]
        if company.get("tone"):
            lines.append(f"- Tone: {company['tone']}")
        if company.get("sign_off"):
            lines.append(f"- Sign-off: {company['sign_off']}")
    if company.get("always"):
        lines += ["", "The business says these whenever the reply calls for them:"] + [f"- {r}" for r in company["always"]]
    if company.get("never"):
        lines += ["", "The business never says these:"] + [f"- {r}" for r in company["never"]]
    if company.get("facts"):
        lines += ["", "Company facts (quote exactly, and use one only when the reply needs it):"]
        lines += [f"[{title or 'Fact'}]\n{body}\n" for title, body in company["facts"]]
    if company.get("templates"):
        lines += ["", "Approved wording for common messages (for the situation named, adapted to this reply):"]
        lines += [f"[{name}]\n{body}\n" for name, body in company["templates"]]
    return lines
