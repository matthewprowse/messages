// The Summary's Filter menu (summary-filter.tsx): an icon button until a filter is on, then the filter's name, and a
// choice replacing the address with the filter while keeping the open conversation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import type { ListFilter } from "@/lib/types";
import { SummaryFilter } from "./summary-filter";
import { renderScreen } from "@/test/render";

const OPTIONS: { key: ListFilter; label: string }[] = [{ key: "none", label: "All" }, { key: "unread", label: "Unread" }, { key: "email", label: "Email" }, { key: "whatsapp", label: "WhatsApp" }];

test("with no filter on it is a plain Filter button", () => {
  renderScreen(<SummaryFilter filter="none" options={OPTIONS} />, { path: "/summary" });
  assert.equal(screen.getByRole("button", { name: "Filter" }).textContent, "");
});

test("with a filter on it names the filter", () => {
  renderScreen(<SummaryFilter filter="unread" options={OPTIONS} />, { path: "/summary?filter=unread" });
  const button = screen.getByRole("button", { name: "Filter, Unread" });
  assert.equal(button.textContent, "Unread");
});

test("the menu lists every option with the current one checked", async () => {
  const { user } = renderScreen(<SummaryFilter filter="email" options={OPTIONS} />, { path: "/summary?filter=email" });
  await user.click(screen.getByRole("button", { name: "Filter, Email" }));
  const items = await screen.findAllByRole("menuitemradio");
  assert.deepEqual(items.map((i) => i.textContent), ["All", "Unread", "Email", "WhatsApp"]);
  assert.deepEqual(items.filter((i) => i.getAttribute("aria-checked") === "true").map((i) => i.textContent), ["Email"]);
});

test("choosing a filter replaces the address, keeping the open conversation", async () => {
  const { user, router } = renderScreen(<SummaryFilter filter="none" options={OPTIONS} openId="thread-kitchen" />, { path: "/summary/thread-kitchen" });
  await user.click(screen.getByRole("button", { name: "Filter" }));
  await user.click(await screen.findByRole("menuitemradio", { name: "WhatsApp" }));
  assert.deepEqual(router.replace.mock.calls.map((c) => c.arguments[0]), ["/summary/thread-kitchen?filter=whatsapp"]);
  assert.equal(router.push.mock.callCount(), 0);
});

test("choosing All takes the filter out of the address", async () => {
  const { user, router } = renderScreen(<SummaryFilter filter="unread" options={OPTIONS} />, { path: "/summary?filter=unread" });
  await user.click(screen.getByRole("button", { name: "Filter, Unread" }));
  await user.click(await screen.findByRole("menuitemradio", { name: "All" }));
  assert.deepEqual(router.replace.mock.calls.map((c) => c.arguments[0]), ["/summary"]);
});
