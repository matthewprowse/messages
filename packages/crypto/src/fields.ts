// The kinds of text that are encrypted. A field's name is bound into its ciphertext, so a body cannot be
// passed off as a subject. Names are by meaning, not by column: a value the database copies from one table
// to another (a message's subject becoming its thread's, its preview becoming the thread's last preview)
// keeps its field and still opens. apps/ai/ai/fields.py lists the same names. A bound value ("e2:", bound.ts) also names
// its owner and the column (and row) it was sealed for, which the strict readers of action columns check.
export const FIELD = {
  /** messages.subject, threads.subject, outbox.subject */
  subject: "subject",
  /** messages.preview, threads.last_message_preview */
  preview: "preview",
  /** messages.body_text, outbox.body, draft_outcomes.sent_body */
  body: "body",
  /** messages.body_html */
  html: "html",
  /** messages.list_unsubscribe */
  unsubscribe: "unsubscribe",
  /** The quoted text in a WhatsApp message's provider_meta.quoted.text */
  quote: "quote",
  /** threads.summary, message_ai.summary, meetings.summary */
  summary: "summary",
  /** drafts.body, drafts.source, draft_outcomes.draft_body */
  draft: "draft",
  /** drafts.instruction, drafts.decision */
  instruction: "instruction",
  /** messages.body_marks: the bold and italic runs of an email's HTML, as JSON */
  marks: "marks",
  /** message_ai.reply_choices: guided drafting's one-tap choices, as JSON */
  choices: "choices",
  /** messages.transcript: what was said in a WhatsApp voice note. meetings.transcript: what was said in a meeting, as JSON */
  transcript: "transcript",
  /** Addresses (stage 2): contact_identities.value, messages.sender_address and to_addresses, chat IDs */
  address: "address",
  /**
   * contacts.display_name, organizations.name, threads.group_name, threads.share_label and share_match, labels and saved
   * views, meeting_participants.name (meeting_participants.address uses address)
   */
  name: "name",
  /** organizations.domain */
  domain: "domain",
  /** briefs.script and briefs.audio: the spoken daily brief */
  brief: "brief",
  /** notes.title */
  noteTitle: "note_title",
  /** notes.body: a note's markdown */
  note: "note",
  /** notes.excerpt: the first words of a note, kept beside the body so the list can load without it */
  noteExcerpt: "note_excerpt",
  /** note_attachments.name: the name of a file attached to a note */
  noteFile: "note_file",
  /** The bytes of a file attached to a note, sealed with encryptBytes before upload */
  noteFileData: "note_file_data",
  /** A recording of what a draft should say, sealed with encryptBytes before upload (attachments/<user>/drafts/) */
  voiceInstruction: "voice_instruction",
  /** tasks.title: a task or reminder from Microsoft To Do, Google Tasks or iCloud Reminders */
  taskTitle: "task_title",
  /** tasks.notes */
  taskNotes: "task_notes",
  /** tasks.list_name: the list a task is in */
  taskList: "task_list",
  /** meetings.title. meetings.transcript uses transcript and meetings.summary uses summary */
  meetingTitle: "meeting_title",
  /** meetings.action_items: the AI's action items from a meeting, as JSON */
  meetingActions: "meeting_actions",
  /** attachments.filename: the name of an email, WhatsApp, Instagram or LinkedIn file. outbox_attachments.filename: a file you send */
  filename: "filename",
  /** The bytes of a stored attachment (email, WhatsApp, Instagram), sealed with encryptBytes before upload */
  attachmentData: "attachment_data",
  /** The bytes of a file you attach to a message you send, sealed in the browser before upload (attachments/<user>/outbox/) */
  outboxFileData: "outbox_file_data",
  /** The bytes of a meeting recording (Zoom), sealed with encryptBytes before upload */
  recordingData: "recording_data",
  /** calendar_events.title, calendar_outbox.title, calendar_updates.title */
  eventTitle: "event_title",
  /** calendar_events.location, calendar_outbox.location, calendar_updates.location */
  eventLocation: "event_location",
  /** calendar_events.description, calendar_outbox.description, calendar_updates.description: an event's notes */
  eventNotes: "event_notes",
  /** calendar_events.attendees: the whole guest list (address, name, answer, self, organizer), as JSON */
  eventGuests: "event_guests",
  /** calendar_events.conference_url, and in meetings.provider_meta the join_url, Meet's meeting_code and Teams' online_meeting_id */
  eventLink: "event_link",
  /** calendar_events.calendar_name: which calendar an event is on, such as "Work" */
  calendarName: "calendar_name",
  /** calendar_events.resource_url: an iCloud event's file on the CalDAV server */
  eventFile: "event_file",
  /** address_book_cards.name */
  cardName: "card_name",
  /** writing_examples.situation */
  writingSituation: "writing_situation",
  /** writing_examples.body */
  writingBody: "writing_body",
  /** profiles.about: your role and goals, read by the AI worker */
  profileAbout: "profile_about",
  /** profiles.important_people: who matters to you, read by the AI worker */
  profilePeople: "profile_people",
  /** style_rules.rule */
  styleRule: "style_rule",
  /** style_rules.relationship */
  styleRelationship: "style_relationship",
  /** contacts.company */
  contactCompany: "contact_company",
  /** contacts.role */
  contactRole: "contact_role",
  /** contacts.relationship */
  contactRelationship: "contact_relationship",
  /** contacts.about_note: what the user wrote about the person */
  contactAbout: "contact_about",
  /** contacts.style_note */
  contactStyleNote: "contact_style_note",
  /** contacts.ai_summary: written by the AI worker */
  contactSummary: "contact_summary",
  /** organizations.summary: what a company sends you, written by the AI worker from its emails */
  orgSummary: "org_summary",
  /** actions.args: the arguments of a next step the AI proposed, as JSON */
  action: "action",
  /** message_ai.bulk_read: the AI's readable version of a bulk email, as JSON */
  bulkRead: "bulk_read",
  /** attachments.doc_card: the AI's card for a document (type, who, amount, due date, summary), as JSON */
  docCard: "doc_card",
  /** automations.spec and automation_previews.spec: an automation's name, conditions, fields and actions, as JSON */
  automation: "automation",
  /** automation_runs.fields and automation_previews.result: what an automation read from an email, as JSON */
  automationRun: "automation_run",
  /** contacts.lead_source: where a lead came from, such as "Property24 Enquiry" */
  leadSource: "lead_source",
  /** message_embeddings.embedding_data: a vector sealed with encryptBytes, base64 */
  embeddingData: "embedding_data",
} as const;

export type Field = (typeof FIELD)[keyof typeof FIELD];
