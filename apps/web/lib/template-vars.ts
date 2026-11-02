// The {variables} a template or snippet can hold, and filling them from the person you write to and your own profile.
// Pure. A variable with nothing to fill it stays as typed, so a missing company is seen and fixed before sending
// instead of vanishing and leaving a gap in the sentence.

export const VARIABLE_NAMES = ["first_name", "name", "company", "my_name"] as const;
export type VariableName = (typeof VARIABLE_NAMES)[number];
export type TemplateVars = Partial<Record<VariableName, string>>;

const PATTERN = /\{(first_name|name|company|my_name)\}/g;

/** The first word of a name, or "" when the name is really an address or number. */
export function firstNameOf(name: string | undefined): string {
  const n = (name ?? "").trim();
  if (!n || n.includes("@") || /^[+\d\s()-]+$/.test(n)) return "";
  return n.split(/\s+/)[0] ?? "";
}

/** The values for one conversation: the contact it is with and your own name. */
export function varsFor(contact: { name?: string; company?: string; organization?: { name: string } } | undefined, myName: string): TemplateVars {
  const name = contact?.name?.trim() ?? "";
  return {
    first_name: firstNameOf(name),
    name: firstNameOf(name) ? name : "",
    company: contact?.company?.trim() || contact?.organization?.name?.trim() || "",
    my_name: myName.trim(),
  };
}

/** The text with each variable that has a value replaced. */
export function fillVariables(text: string, vars: TemplateVars): string {
  return text.replace(PATTERN, (whole, key: VariableName) => vars[key]?.trim() || whole);
}

/** Variables still unfilled in the text, each once, as they are typed: {company}. */
export function unresolvedVariables(text: string): string[] {
  return [...new Set(text.match(PATTERN) ?? [])];
}
