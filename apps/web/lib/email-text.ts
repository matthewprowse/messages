// The email parser lives in packages/email-text, shared with the sync worker, which uses the same rules
// to spot newsletters and recover readable text when an email arrives.
export * from "@messages/email-text";
