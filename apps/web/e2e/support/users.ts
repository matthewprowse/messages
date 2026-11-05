// The test users: one per project (Desktop, iPhone, Android), so the three run side by side without ever sharing a row.
// Each is a made-up example.com address. A password is never stored or printed: it is derived here from the one secret
// already in apps/web/.env.test.local (TEST_USER_PASSWORD), so nothing new is written to disk.

import { createHmac } from "node:crypto";
import { admin } from "./admin";
import { loadTestEnv } from "./test-env";
import { worldOf } from "./world";

/** The Playwright projects that run against Konva Test (playwright.config.ts), in the order global setup seeds them. */
export const PROJECTS = ["Desktop", "iPhone", "Android"] as const;
export type ProjectName = (typeof PROJECTS)[number];

export const isProject = (name: string): name is ProjectName => (PROJECTS as readonly string[]).includes(name);

/** The test user's email for a project: konva-test-desktop@example.com and so on. */
export const userEmail = (project: ProjectName) => `konva-test-${project.toLowerCase()}@example.com`;

/** The project's password: an HMAC of its name under TEST_USER_PASSWORD, so it is stable between runs and known to no file. */
export function userPassword(project: ProjectName): string {
  return createHmac("sha256", loadTestEnv().TEST_USER_PASSWORD).update(`konva-e2e-user:${project}`).digest("base64url").slice(0, 32);
}

/** The project a test runs in, from Playwright's project name. Throws on a name that has no test user. */
export function projectOf(name: string): ProjectName {
  if (!isProject(name)) throw new Error(`The project "${name}" has no test user (e2e/support/users.ts).`);
  return name;
}

const ids = new Map<ProjectName, Promise<string>>();

/**
 * The project's user id, making the user (confirmed, no email sent) when it does not exist and setting its password
 * either way. Only ever called for an example.com address on Konva Test: admin() checks the database address.
 */
export function ensureUser(project: ProjectName): Promise<string> {
  let found = ids.get(project);
  if (!found) {
    found = (async () => {
      const email = userEmail(project);
      const auth = admin().auth.admin;
      for (let page = 1; page < 50; page++) {
        const { data, error } = await auth.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const user = data.users.find((u) => u.email?.toLowerCase() === email);
        if (user) {
          const { error: setError } = await auth.updateUserById(user.id, { password: userPassword(project), email_confirm: true });
          if (setError) throw setError;
          return user.id;
        }
        if (data.users.length < 200) break;
      }
      // Sign-up is for approved emails only (a trigger on auth.users), and the Admin API is held to it too.
      const approved = await admin().from("waitlist").upsert({ email, kind: "individual", status: "approved" }, { onConflict: "email" });
      if (approved.error) throw Object.assign(new Error("Could not approve a test user."), { code: approved.error.code });
      const { data, error } = await auth.createUser({ email, password: userPassword(project), email_confirm: true });
      if (error || !data.user) throw Object.assign(new Error("Could not create a test user."), { code: error?.code });
      return data.user.id;
    })();
    found.catch(() => ids.delete(project));
    ids.set(project, found);
  }
  return found;
}

/** A project's test user id, from what global setup wrote (world.ts): no lookup in Auth for each test. */
export const testUserId = async (project: ProjectName): Promise<string> => worldOf(project).userId;
