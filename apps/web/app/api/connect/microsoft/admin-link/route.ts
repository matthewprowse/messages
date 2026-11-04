// The address an IT admin opens to approve Konva for their organisation, for Settings, Connect Microsoft after a sign-in
// came back with connect_error=admin_approval. Built here from this server's own MICROSOFT_CLIENT_ID and MICROSOFT_TENANT,
// never taken from the page's address, so nobody can send a link that shows another app's consent page as ours. The query
// only picks which of our fixed permission sets it covers. Public values only: no sign-in needed.

import { adminConsentUrl, clientId, microsoftReady } from "@/lib/server/microsoft";
import { fail, noStore } from "@/lib/server/request";
import { isAdminLink } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!microsoftReady()) return fail(503, "Connecting Microsoft is not set up on this server yet.");
  const params = new URL(request.url).searchParams;
  const link = adminConsentUrl({ teams: params.get("teams") === "1", calendarWrite: params.get("calendar_write") === "1" });
  if (!isAdminLink(link, clientId)) return fail(500, "Could not make the approval link.");
  return Response.json({ link }, { headers: noStore });
}
