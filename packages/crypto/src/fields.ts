// The kinds of text that are encrypted. A field's name is bound into its ciphertext, so a body cannot be
// passed off as a subject. Names are by meaning, not by column: a value the database copies from one table
// to another (a message's subject becoming its thread's, its preview becoming the thread's last preview)
// keeps its field and still opens. apps/ai/ai/fields.py lists the same names.
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
  /** contacts.display_name, organizations.name */
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
} as const;

export type Field = (typeof FIELD)[keyof typeof FIELD];
