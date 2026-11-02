// Changes the Calendar page has saved but the worker has not made yet, laid over the loaded events as if they were
// made: new events (queued), deletes (hidden) and edits or invitation answers (edits). The `created`, `deleted`
// and `updated` sets hold the tokens the worker has confirmed; the next load of the days drops each one's entry.

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { sendAnswer } from "@/lib/calendar-answer";
import { type CalendarEvent, type EventResponse, type PendingEdit, type UpdateScope } from "@/lib/calendar";
import { allowOutlookEditing, needsOutlookWrite } from "@/lib/outlook-write";
import type { DeleteScope } from "@/components/delete-event-dialog";

export type HiddenEvent = { token: string; id: string; seriesId: string | null; scope: DeleteScope };

/** A failure toast that offers Allow Editing when Outlook Calendar has not been allowed to make changes yet. */
export function failureToast(error: string | null | undefined, fallback: string) {
  const text = error ?? fallback;
  if (needsOutlookWrite(text)) toast.error(text, { action: { label: "Allow Editing", onClick: () => void allowOutlookEditing(false).catch(() => toast.error("Microsoft could not be reached. Try again.")) } });
  else toast.error(text);
}

export function usePendingChanges(reload: () => void) {
  // Events saved in the dialog that the worker has not created yet, shown as if they were. One leaves this list when
  // the days reload after it was created, or when it failed.
  const [queued, setQueued] = useState<CalendarEvent[]>([]);
  const created = useRef(new Set<string>());
  // Events being deleted, hidden at once (a whole series when that is what was asked for). Each goes when the days
  // reload after the worker has deleted it, or straight away when it could not.
  const [hidden, setHidden] = useState<HiddenEvent[]>([]);
  const deleted = useRef(new Set<string>());
  // Changes and answers saved but not yet made in the calendar, laid over the events as if they were. One goes when the
  // days reload after the worker made it, or straight away when it could not.
  const [edits, setEdits] = useState<PendingEdit[]>([]);
  const updated = useRef(new Set<string>());

  // Answers an invitation, for one event or every event in its series. The answer shows at once, marked as saving,
  // while the worker sends it to the calendar.
  const answer = useCallback(
    async (event: CalendarEvent, response: EventResponse, scope: UpdateScope = "occurrence") => {
      if (!event.accountId) return;
      const series = scope === "series" && !!event.seriesId;
      const pending = { token: `answer-${event.id}-${Date.now()}`, id: event.id, seriesId: series ? event.seriesId! : null, scope: series ? ("series" as const) : ("occurrence" as const), patch: { response } };
      setEdits((list) => [...list, pending]);
      const dropPending = (token: string) => setEdits((list) => list.filter((e) => e.token !== token));
      let token = pending.token;
      const outcome = await sendAnswer(event, response, scope, (id) => {
        token = id;
        setEdits((list) => list.map((e) => (e.token === pending.token ? { ...e, token: id } : e)));
      });
      if (!outcome.saved) {
        dropPending(pending.token);
        toast.error("Could not save your answer. Try again.");
        return;
      }
      if (outcome.status === "done") {
        updated.current.add(token);
        reload();
        return;
      }
      dropPending(token);
      failureToast(outcome.error, "Your answer could not be sent.");
    },
    [reload],
  );

  return { queued, setQueued, created, hidden, setHidden, deleted, edits, setEdits, updated, answer };
}

export type PendingChanges = ReturnType<typeof usePendingChanges>;
