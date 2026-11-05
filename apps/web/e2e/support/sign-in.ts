// Signs the project's test user in through the login page with their password, as a person would. Password sign-in sends no
// email (the magic link and code endpoints are blocked by the firewall anyway). The password is derived (users.ts).

import { expect, type Page } from "@playwright/test";
import { userEmail, userPassword, type ProjectName } from "./users";

/** Opens /login, signs in with the project user's password and waits until the app has taken them in (to /summary). */
export async function signIn(page: Page, project: ProjectName, password = userPassword(project)): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign In With a Password" }).click();
  await page.getByLabel("Email").fill(userEmail(project));
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/summary$/);
}
