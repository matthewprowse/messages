// A task on the Summary (task-row.tsx): its checkbox ticks it off through the store's tickTask, it says when it is due
// (Overdue, All Day, Saving), and the row opens the task in Calendar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import { dayKey } from "@/lib/dates";
import { TaskRow } from "./task-row";
import { argsOf } from "@/test/fake-store";
import { renderScreen } from "@/test/render";
import { task } from "@/test/fixtures";

const TODAY = dayKey(new Date());
const QUOTE = task("task-quote", "Send the revised quote", { listName: "Clients" });

test("ticking the box ticks the task off through the store, from the Summary", async () => {
  const { user, store } = renderScreen(<TaskRow item={{ task: QUOTE, overdue: false, timed: false }} today={TODAY} source="Microsoft To Do" />);
  await user.click(screen.getByRole("checkbox", { name: "Send the revised quote" }));
  assert.deepEqual(argsOf(store.tickTask), [[QUOTE, true, "summary"]]);
});

test("ticking a done task puts it back", async () => {
  const done = { ...QUOTE, completed: true };
  const { user, store } = renderScreen(<TaskRow item={{ task: done, overdue: false, timed: false }} today={TODAY} source={undefined} />);
  const box = screen.getByRole("checkbox", { name: "Send the revised quote" });
  assert.equal(box.getAttribute("aria-checked"), "true");
  await user.click(box);
  assert.deepEqual(argsOf(store.tickTask), [[done, false, "summary"]]);
});

test("the row opens the task in Calendar and says its list and source", () => {
  renderScreen(<TaskRow item={{ task: QUOTE, overdue: false, timed: false }} today={TODAY} source="Microsoft To Do" />);
  const link = screen.getByRole("link", { name: /Send the revised quote/ });
  assert.equal(link.getAttribute("href"), `/calendar?date=${TODAY}&task=task-quote`);
  assert.ok(screen.getByText("Clients · Microsoft To Do"));
  assert.ok(screen.getByText("All Day"));
});

test("an overdue task says Overdue, and one still being saved says Saving", () => {
  const { unmount } = renderScreen(<TaskRow item={{ task: QUOTE, overdue: true, timed: false }} today={TODAY} source={undefined} />);
  assert.ok(screen.getByText("Overdue"));
  unmount();
  renderScreen(<TaskRow item={{ task: { ...QUOTE, pending: true }, overdue: true, timed: false }} today={TODAY} source={undefined} />);
  assert.ok(screen.getByText("Saving"));
});
