// Whether New Email holds work worth keeping, so a click outside the dialog does not throw it away. Pure.

/** True when anything differs from how the dialog opened (its prefilled recipients, subject and body). */
export function composeIsDirty(now: { to: string; cc: string; bcc: string; subject: string; body: string }, opened: { to: string[]; subject: string; body: string }): boolean {
  return now.to.trim() !== opened.to.join(", ").trim() || now.cc.trim() !== "" || now.bcc.trim() !== "" || now.subject !== opened.subject || now.body !== opened.body;
}
