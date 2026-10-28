// The waitlist, used by /admin. A team request names a company and its size; an individual request is an email only.

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
