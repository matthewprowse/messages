"""Automations and lead capture (docs/PLAN.md, "Automations and Lead Capture"): When a new email matches, Read the lead's
details out of it, Do something with them (contact, Lead, task, draft, urgent push). Email only; SMS is not built.

engine.py is the one entry the triage loop calls; previews.py answers "what would this have done in the last 30 days";
the rest are small pure modules (spec, match, labelled and one parser per template, phone) and the I/O halves (do, extract)."""
