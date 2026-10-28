// Old address kept so saved links still work: redirects to /settings/personalisation.

import { redirect } from "next/navigation";

export default function Page() {
  redirect("/settings/personalisation");
}
