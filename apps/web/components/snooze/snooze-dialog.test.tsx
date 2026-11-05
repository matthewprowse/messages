// Snoozing (snooze-dialog.tsx, snooze-items.tsx, use-snooze-pick.tsx): the ready-made times and Pick a Date reach the
// store's snooze with the right conversations and time, Remind Me If No Reply is offered only when you wrote last, and
// Unsnooze only for a conversation snoozed now.

import { test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import { useApp } from "@/lib/store";
import { reminderChoices, snoozeChoices } from "@/lib/snooze";
import type { Thread } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DROPDOWN_KIT } from "./menu-kit";
import { SnoozeItems } from "./snooze-items";
import { useSnoozePick } from "./use-snooze-pick";
import { argsOf } from "@/test/fake-store";
import { renderScreen } from "@/test/render";
import { GARDEN, KITCHEN, LEASE, minutesAgo } from "@/test/fixtures";

/** A conversation menu wired as the header wires it: a time snoozes through the store, Pick a Date opens the dialog. */
function Harness({ thread, ids = [thread.id] }: { thread: Thread; ids?: string[] }) {
  const { snooze, unsnooze } = useApp();
  const pick = useSnoozePick((picked, action, at) => { if (at) snooze(picked, at, action === "remind" ? "reminder" : "snooze"); });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button>More</Button></DropdownMenuTrigger>
        <DropdownMenuContent>
          <SnoozeItems kit={DROPDOWN_KIT} thread={thread} onAt={(mode, at) => pick.snoozeAt(ids, at, mode)} onDate={(mode) => pick.request(ids, mode, "date")} onUnsnooze={() => unsnooze(thread.id)} />
        </DropdownMenuContent>
      </DropdownMenu>
      <Button onClick={() => pick.request(ids)}>Open Snooze</Button>
      {pick.dialog}
    </>
  );
}

const tomorrow = () => snoozeChoices(new Date()).find((c) => c.key === "tomorrow")!.at.getTime();

/** Opens the menu and a submenu by its name, by keyboard: a pointer moving off a sub trigger closes it in a DOM with no layout. */
async function openSub(user: ReturnType<typeof renderScreen>["user"], name: string) {
  await user.click(screen.getByRole("button", { name: "More" }));
  (await screen.findByRole("menuitem", { name })).focus();
  await user.keyboard("{ArrowRight}");
}

/** Chooses an item in an open submenu by keyboard, for the same reason. */
async function choose(user: ReturnType<typeof renderScreen>["user"], name: string) {
  (await screen.findByRole("menuitem", { name })).focus();
  await user.keyboard("{Enter}");
}

test("Snooze, Tomorrow snoozes the conversation until tomorrow morning", async () => {
  const { user, store } = renderScreen(<Harness thread={KITCHEN} />);
  await openSub(user, "Snooze");
  await choose(user, "Tomorrow");
  const [ids, at, kind] = argsOf(store.snooze)[0];
  assert.deepEqual(ids, [KITCHEN.id]);
  assert.equal((at as Date).getTime(), tomorrow());
  assert.equal(kind, "snooze");
});

test("the dialog's ready-made times snooze every chosen conversation", async () => {
  const { user, store } = renderScreen(<Harness thread={KITCHEN} ids={[KITCHEN.id, LEASE.id]} />);
  await user.click(screen.getByRole("button", { name: "Open Snooze" }));
  assert.ok(await screen.findByRole("dialog", { name: "Snooze" }));
  assert.ok(screen.getByText(/They leave your inbox and return/));
  await user.click(screen.getByRole("button", { name: /^Tomorrow/ }));
  const [ids, at] = argsOf(store.snooze)[0];
  assert.deepEqual(ids, [KITCHEN.id, LEASE.id]);
  assert.equal((at as Date).getTime(), tomorrow());
  assert.equal(screen.queryByRole("dialog"), null);
});

test("Pick a Date needs a day before Snooze is on, then snoozes to that day", async () => {
  const { user, store } = renderScreen(<Harness thread={KITCHEN} />);
  await openSub(user, "Snooze");
  await choose(user, "Pick a Date");
  const dialog = await screen.findByRole("dialog", { name: "Snooze" });
  const confirm = () => screen.getAllByRole("button", { name: "Snooze" }).at(-1) as HTMLButtonElement;
  assert.equal(confirm().disabled, true);
  assert.ok(screen.getByText("Choose a day. It returns at 08:00."));
  const days = Array.from(dialog.querySelectorAll<HTMLButtonElement>("[role=gridcell] button:not([disabled])"));
  await user.click(days.at(-1)!);
  assert.match(screen.getByText(/^Returns /).textContent ?? "", /\.$/);
  await user.click(confirm());
  const [ids, at] = argsOf(store.snooze)[0];
  assert.deepEqual(ids, [KITCHEN.id]);
  assert.ok((at as Date).getTime() > Date.now());
});

test("Remind Me If No Reply is offered only when you wrote last, and sets a reminder", async () => {
  const first = renderScreen(<Harness thread={KITCHEN} />);
  await first.user.click(screen.getByRole("button", { name: "More" }));
  await screen.findByRole("menuitem", { name: "Snooze" });
  assert.equal(screen.queryByRole("menuitem", { name: "Remind Me If No Reply" }), null);
  first.unmount();
  const { user, store } = renderScreen(<Harness thread={GARDEN} />);
  await openSub(user, "Remind Me If No Reply");
  await choose(user, "In 3 Days");
  const [, at, kind] = argsOf(store.snooze)[0];
  assert.equal(kind, "reminder");
  assert.equal((at as Date).getTime(), reminderChoices(new Date())[1].at.getTime());
});

test("a conversation snoozed now offers Unsnooze, which brings it back", async () => {
  const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const { user, store } = renderScreen(<Harness thread={{ ...LEASE, snoozedUntil: later }} />);
  await user.click(screen.getByRole("button", { name: "More" }));
  await user.click(await screen.findByRole("menuitem", { name: "Unsnooze" }));
  assert.deepEqual(argsOf(store.unsnooze), [[LEASE.id]]);
});

test("one whose snooze has passed offers no Unsnooze", async () => {
  const { user } = renderScreen(<Harness thread={{ ...LEASE, snoozedUntil: minutesAgo(5) }} />);
  await user.click(screen.getByRole("button", { name: "More" }));
  await screen.findByRole("menuitem", { name: "Snooze" });
  assert.equal(screen.queryByRole("menuitem", { name: "Unsnooze" }), null);
});
