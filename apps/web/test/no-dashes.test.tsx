// The no-dashes rule for app text (AGENTS.md, UI rules): a broad set of the screen-tested components is rendered, with
// their menus and dialogs open, and no em or en dash may appear in anything a person reads or hears: the visible text,
// and the labels, titles, placeholders and alt text that screen readers and tooltips use.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { screen } from "@testing-library/react";
import { addDays, dayKey } from "@/lib/dates";
import { Composer } from "@/components/thread-view/composer";
import { ThreadHeader } from "@/components/thread-view/header";
import { Bubble, type BubbleHandlers } from "@/components/thread-view/bubble";
import { ThreadList } from "@/components/thread-list";
import { ThreadRow } from "@/components/thread-list/thread-row";
import { FilterButton, ListControls } from "@/components/thread-list/list-controls";
import { SelectionBar } from "@/components/thread-list/selection-bar";
import { SendLaterMenu } from "@/components/send-later-menu";
import { LabelChips } from "@/components/labels/label-chips";
import { NewEventDialog } from "@/components/new-event-dialog";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { DeleteEventDialog } from "@/components/delete-event-dialog";
import { ComposeDialog } from "@/components/compose-dialog";
import { NewWhatsAppDialog } from "@/components/new-whatsapp-dialog";
import { MergeDialog } from "@/components/merge-dialog";
import { NewContactDialog } from "@/components/contacts/new-contact-dialog";
import { SettingsList } from "@/components/settings/settings-list";
import { SummaryFilter } from "@/components/summary/summary-filter";
import { TaskRow } from "@/components/summary/task-row";
import { EventRow } from "@/components/summary/event-row";
import { MonthView } from "@/components/calendar/month-view";
import { WeekStrip } from "@/components/calendar/week-strip";
import { NoteRow } from "@/components/notes/note-row";
import { FilterMenu } from "@/components/attachments/filter-menu";
import { DeleteFilesDialog } from "@/components/attachments/delete-dialog";
import { renderScreen, type ScreenOptions } from "./render";
import { ACCOUNT, AVA, BEN, KITCHEN, KITCHEN_MESSAGES, LABELS, LEASE, WHATSAPP_ACCOUNT, task } from "./fixtures";
import { byDay, CALENDAR_ACCOUNT, calendarEvent, daysFromNow, TASKS_ACCOUNT } from "./calendar-fixtures";
import { note } from "./contacts-fixtures";

const DASHES = /[–—]/;
const none = () => undefined;
const TODAY = dayKey(new Date());
const monday = addDays(new Date(), -((new Date().getDay() + 6) % 7));
const DAYS = Array.from({ length: 42 }, (_, i) => dayKey(addDays(monday, i)));
const VISIT = calendarEvent("e-visit", "Site Visit", daysFromNow(1, 10));
const DRAFTED = { ...KITCHEN, id: "thread-dashes", draft: { id: "draft-1", body: "Hi Ava, the oak worktops are now a separate line.", tone: "default" as const, generatedAt: new Date().toISOString() } };

const BUBBLE = { whatsapp: false, nameOf: (who: string) => (who === "me" ? "You" : AVA.name), onJump: none, onReply: none, onReact: none, onOpen: none, onRetry: none, onDismiss: none } satisfies BubbleHandlers;

interface Scene {
  name: string;
  ui: ReactElement;
  options?: ScreenOptions;
  /** Buttons to press once rendered, by accessible name, to open the menus and dialogs behind them. */
  open?: string[];
}

const SCENES: Scene[] = [
  { name: "reply box with a draft, Send Later open", ui: <Composer thread={DRAFTED} msgs={KITCHEN_MESSAGES} onDraft={none} onDiscardDraft={none} onSend={async () => true} />, open: ["Send Later"] },
  { name: "conversation header, More open", ui: <ThreadHeader thread={KITCHEN} primary={AVA} title="Ava Thompson" subtitle={KITCHEN.subject} backHref="/inbox" hrefFor={(id) => `/inbox/${id}`} forwardable onLeave={none} onAttachments={none} onForward={none} />, open: ["More"] },
  { name: "message bubbles", ui: <>{KITCHEN_MESSAGES.map((m) => <Bubble key={m.id} m={m} showMeta flash={false} {...BUBBLE} />)}</> },
  { name: "conversation list", ui: <ThreadList />, options: { labels: LABELS, wearing: { [KITCHEN.id]: ["label-clients"] } } },
  { name: "one row", ui: <ThreadRow thread={KITCHEN} today={TODAY} contact={AVA} query="" selected={false} checked={false} selecting={false} onCheck={none} onAction={none} onPress={none} labels={LABELS} /> },
  { name: "list controls, Filter open", ui: <><ListControls view="all" filter="none" /><FilterButton view="all" filter="none" /></>, open: ["Filter"] },
  { name: "selection bar", ui: <SelectionBar allPicked={false} count={2} anyUnread ids={[KITCHEN.id, LEASE.id]} onAll={none} onClear={none} onAction={none} /> },
  { name: "Send Later menu", ui: <SendLaterMenu onPick={none} />, open: ["Send Later"] },
  { name: "label chips", ui: <LabelChips view="all" filter="none" />, options: { labels: LABELS } },
  { name: "New Event", ui: <NewEventDialog open onOpenChange={none} />, options: { accounts: [CALENDAR_ACCOUNT], contacts: [AVA] } },
  { name: "New Task", ui: <NewTaskDialog open onOpenChange={none} />, options: { accounts: [TASKS_ACCOUNT] } },
  { name: "Delete Event", ui: <DeleteEventDialog target={{ event: VISIT }} calendar="Google Calendar" onClose={none} onStart={none} onDone={none} onFail={none} /> },
  { name: "New Email", ui: <ComposeDialog open onOpenChange={none} />, options: { threads: [] } },
  { name: "New WhatsApp", ui: <NewWhatsAppDialog open onOpenChange={none} />, options: { accounts: [ACCOUNT, WHATSAPP_ACCOUNT], threads: [] } },
  { name: "Merge", ui: <MergeDialog a={{ name: AVA.name }} b={{ name: BEN.name }} open onOpenChange={none} onConfirm={async () => undefined} /> },
  { name: "New Contact", ui: <NewContactDialog open onOpenChange={none} />, options: { path: "/contacts" } },
  { name: "Settings list", ui: <SettingsList />, options: { path: "/settings" } },
  { name: "Summary filter", ui: <SummaryFilter filter="none" options={[{ key: "none", label: "All" }, { key: "unread", label: "Unread" }]} />, options: { path: "/summary" }, open: ["Filter"] },
  { name: "Summary rows", ui: <><TaskRow item={{ task: task("task-quote", "Send the revised quote"), overdue: true, timed: false }} today={TODAY} source="Microsoft To Do" /><EventRow event={VISIT} today={TODAY} /></> },
  { name: "month grid", ui: <MonthView days={DAYS} byDay={byDay([VISIT])} tasksByDay={new Map()} today={new Date()} selected={new Date()} monthOf={new Date()} onSelect={none} onCreate={none} /> },
  { name: "week strip", ui: <WeekStrip days={DAYS.slice(0, 7)} byDay={byDay([VISIT])} tasksByDay={new Map()} today={new Date()} selectedKey={TODAY} onSelect={none} /> },
  { name: "note row", ui: <NoteRow note={note("note-1")} drafts="off" term="" today={TODAY} selected={false} open={false} onSwipe={none} onTouchRow={none} onPin={none} onDelete={none} onDraft={none} onArchive={none} onWarm={none} />, options: { path: "/notes" } },
  { name: "attachments filter", ui: <FilterMenu value={{ source: "all", date: "any", doc: "all", sort: "newest", hidden: false }} sources={[{ key: "gmail", label: "Gmail" }]} onChange={none} onClear={none} />, options: { path: "/attachments" }, open: ["Filter"] },
  { name: "delete files", ui: <DeleteFilesDialog files={[{ id: "f-1", name: "Quote.pdf", kind: "pdf", size: "120 KB", path: "files/f-1", messageId: "m-1", threadId: KITCHEN.id, sentAt: new Date().toISOString(), from: AVA.id }]} busy={false} onCancel={none} onConfirm={none} />, options: { path: "/attachments" } },
];

/** Everything on the page a person reads or hears: text, and the attributes tooltips and screen readers use. */
function readableText(): string {
  const attrs = [...document.body.querySelectorAll("[aria-label], [title], [placeholder], [alt], [aria-description]")]
    .flatMap((el) => ["aria-label", "title", "placeholder", "alt", "aria-description"].map((a) => el.getAttribute(a) ?? ""));
  return [document.body.textContent ?? "", ...attrs].join("\n");
}

for (const scene of SCENES) {
  test(`no em or en dash in ${scene.name}`, async () => {
    const { user } = renderScreen(scene.ui, scene.options);
    for (const name of scene.open ?? []) await user.click(screen.getAllByRole("button", { name })[0]);
    const text = readableText();
    assert.ok(text.trim().length > 0, "the scene rendered nothing to read");
    const hit = text.split("\n").find((line) => DASHES.test(line));
    assert.equal(hit, undefined, `found a dash in: ${hit}`);
  });
}

test("the check itself finds a dash, in text or in a label", () => {
  renderScreen(<p>Quote<span aria-label={"Kitchen – Quote"} /></p>);
  assert.ok(DASHES.test(readableText()));
});
