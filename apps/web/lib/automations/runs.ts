// Words for the run history: what each status and error code the AI worker records means to a person, and what a run's row says.
// Pure, plain British English, no dashes.

export const STATUS_LABEL: Record<string, string> = { running: "Running", done: "Done", skipped: "Skipped", failed: "Failed", undone: "Undone" };

const ERRORS: Record<string, string> = {
  unreadable: "The email did not have a name and a way to reach them, so nothing was made.",
  no_fields: "No fields were set up to read.",
  ai_daily_limit: "The daily limit for reading emails with the AI was reached.",
  ai_paused: "The AI is paused until the 1st, so this email was not read.",
  ai_unavailable: "The AI could not read this email.",
  contact: "The contact could not be made.",
  task: "The task could not be added. Check that a task list is connected.",
  draft: "The draft could not be made.",
  urgent: "The urgent mark could not be set.",
  name: "No name was found, so the address or number stands in for it.",
};

/** The sentence for an error code, or for a comma separated list of step names. Unknown codes are not shown raw. */
export function errorText(error: string | null): string | null {
  if (!error) return null;
  return error.split(",").map((c) => ERRORS[c.trim()] ?? "Something went wrong.").join(" ");
}

/** Who the run was about: the name it read, else the address or number, else a plain stand-in. */
export function runWho(fields: Record<string, string> | null): string {
  return fields?.name?.trim() || fields?.email?.trim() || fields?.phone?.trim() || "An email";
}

/** How the fields were read, for the second line. */
export function readByText(readBy: "parser" | "gemini" | null): string {
  return readBy === "gemini" ? "Read by the AI" : readBy === "parser" ? "Read by the fixed reader" : "";
}
