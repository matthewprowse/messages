// A signed-in session for a test user without going through the login page: the password grant against Konva Test's own
// Auth (no email is sent by a password sign-in), handed to the browser's local storage under the key supabase-js reads.
// Used by the `login` fixture; sign-in.spec.ts still signs in through the page.
//
// Every test gets a session of its own. Sharing one between the tests of a project does not work: the app refreshes its
// session on load, a refresh token used a second time (by another test's page) is treated by Auth as stolen, and Auth then
// ends the whole session, so the other tests' requests start answering 401.

import { assertTestUrl, loadTestEnv, TEST_REF } from "./test-env";
import { userEmail, userPassword, type ProjectName } from "./users";

/** The local storage entry (key and JSON value) that signs the project's user in. Throws if the sign-in is refused. */
export async function storageSession(project: ProjectName): Promise<{ key: string; value: string }> {
  const env = loadTestEnv();
  const response = await fetch(`${assertTestUrl(env.SUPABASE_URL)}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: userEmail(project), password: userPassword(project) }),
  });
  if (!response.ok) throw new Error(`The test user could not sign in (${response.status}).`);
  return { key: `sb-${TEST_REF}-auth-token`, value: JSON.stringify(await response.json()) };
}
