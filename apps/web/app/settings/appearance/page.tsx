// Old address kept so saved links still work: redirects to /settings/general.

import { redirect } from "next/navigation";

export default function Page() {
  redirect("/settings/general");
}
