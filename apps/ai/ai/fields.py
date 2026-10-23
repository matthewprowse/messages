"""The kinds of text that are encrypted, the same names as packages/crypto/src/fields.ts. A field's name is
bound into its ciphertext; names are by meaning, so a value the database copies between tables still opens."""

SUBJECT = "subject"          # messages.subject, threads.subject, outbox.subject
PREVIEW = "preview"          # messages.preview, threads.last_message_preview
BODY = "body"                # messages.body_text, outbox.body, draft_outcomes.sent_body
HTML = "html"                # messages.body_html
UNSUBSCRIBE = "unsubscribe"  # messages.list_unsubscribe
QUOTE = "quote"              # provider_meta.quoted.text on a WhatsApp message
SUMMARY = "summary"          # threads.summary, message_ai.summary
DRAFT = "draft"              # drafts.body, draft_outcomes.draft_body
INSTRUCTION = "instruction"  # drafts.instruction, drafts.decision
MARKS = "marks"              # messages.body_marks
CHOICES = "choices"          # message_ai.reply_choices
ADDRESS = "address"          # contact_identities.value, messages.sender_address and to_addresses, chat IDs
NAME = "name"                # contacts.display_name, organizations.name
DOMAIN = "domain"            # organizations.domain
BRIEF = "brief"              # briefs.script, briefs.audio
