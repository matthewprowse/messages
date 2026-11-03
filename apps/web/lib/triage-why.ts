// The warning for a conversation the AI flagged as likely fraud. Pure: the kind is a closed list written by the AI worker
// (ai/triage_extras.py), and the app only warns, it never acts.

/** Likely fraud kinds the AI worker can flag, with the warning each shows. The app only warns, it never acts. */
export const SUSPICIOUS_COPY: Record<string, { title: string; text: string }> = {
  payment_change: { title: "Check Before You Pay", text: "This asks for money to go to new or changed bank details. Call the sender on a number you already have before you pay anything." },
  phishing: { title: "Possible Phishing", text: "This may be trying to get a password, code or card number. Do not open links or attachments unless you are sure." },
  impersonation: { title: "May Not Be Who It Says", text: "The sender may be pretending to be someone you know or a company you deal with. Check with them another way." },
};
