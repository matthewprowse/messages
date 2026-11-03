// The old address of What's New, which now lives in Settings. Kept so links and bookmarks still land.

import { redirect } from "next/navigation";

export default function OldWhatsNewPage() {
  redirect("/settings/whats-new");
}
