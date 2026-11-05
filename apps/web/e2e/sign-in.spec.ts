// Signing in with a password on each of the core three screens: the test user gets in and their data key opens (the
// /api/keys reply the browser decrypts with), and a wrong password is refused with a plain sentence.

import { expect, test } from "./support/fixtures";
import { signIn } from "./support/sign-in";
import { userEmail } from "./support/users";

test("the test user signs in with a password and their data key opens", async ({ page, me }) => {
  const key = page.waitForResponse((r) => r.url().endsWith("/api/keys") && r.request().method() === "POST");
  await signIn(page, me.project);
  expect((await key).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Sign In or Create an Account" })).toHaveCount(0);
});

test("a wrong password is refused with a plain message and no session", async ({ page, me }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign In With a Password" }).click();
  await page.getByLabel("Email").fill(userEmail(me.project));
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByText("That email and password did not match.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
