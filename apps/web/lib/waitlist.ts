// The waitlist, shared by the marketing page's form, /api/waitlist and /admin. A team request names a company
// and its size; an individual request is an email only.

export type WaitlistKind = "team" | "individual";
export type WaitlistStatus = "pending" | "approved" | "rejected";

export const TEAM_SIZES = [
  { value: "2-5", label: "2 to 5 People" },
  { value: "6-10", label: "6 to 10 People" },
  { value: "11-25", label: "11 to 25 People" },
  { value: "26-50", label: "26 to 50 People" },
  { value: "51+", label: "More Than 50 People" },
] as const;

export type TeamSize = (typeof TEAM_SIZES)[number]["value"];

// A team request names a range, so it starts with the top of it. A team has at least 5 seats.
const TEAM_SIZE_SEATS: Record<TeamSize, number> = { "2-5": 5, "6-10": 10, "11-25": 25, "26-50": 50, "51+": 51 };
export const teamSeats = (value: string | null) => Math.max(5, TEAM_SIZE_SEATS[value as TeamSize] ?? 5);

export const teamSizeLabel = (value: string | null) => TEAM_SIZES.find((s) => s.value === value)?.label ?? "Unknown Size";

export interface WaitlistRequest {
  kind: WaitlistKind;
  email: string;
  company?: string;
  teamSize?: TeamSize;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The request as it will be stored, or an error to show beside the form. */
export function checkRequest(input: unknown): { ok: true; value: WaitlistRequest } | { ok: false; error: string } {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind = body.kind === "team" ? "team" : body.kind === "individual" ? "individual" : null;
  if (!kind) return { ok: false, error: "Choose a team or an individual account." };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 320) return { ok: false, error: "Enter a valid email address." };
  if (kind === "individual") return { ok: true, value: { kind, email } };
  const company = typeof body.company === "string" ? body.company.trim() : "";
  if (!company || company.length > 200) return { ok: false, error: "Enter your company name." };
  const teamSize = TEAM_SIZES.find((s) => s.value === body.teamSize)?.value;
  if (!teamSize) return { ok: false, error: "Choose your team size." };
  return { ok: true, value: { kind, email, company, teamSize } };
}
