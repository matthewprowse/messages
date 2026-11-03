// The old address of the Team's exports page, which is now a view inside Settings, Team. Kept so links and bookmarks still land.

import { redirect } from "next/navigation";

export default function OldTeamPage() {
  redirect("/settings/team?view=exports");
}
