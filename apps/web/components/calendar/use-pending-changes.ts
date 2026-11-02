// Changes the Calendar page has saved but the worker has not made yet, laid over the loaded events as if they were
// made: new events (queued), deletes (hidden) and edits or invitation answers (edits). The `created`, `deleted`
// and `updated` sets hold the tokens the worker has confirmed; the next load of the days drops each one's entry.

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { buildResponse, followUpdate, withPatch, type CalendarEvent, type EventPatch, type EventResponse, type UpdateScope } from "@/lib/calendar";
import { supabase } from "@/lib/supabase";
import type { DeleteScope } from "@/components/delete-event-dialog";

export type HiddenEvent = { token: string; id: string; seriesId: string | null; scope: DeleteScope };
export type PendingEdit = { token: string; id: string; seriesId: string | null; scope: UpdateScope; patch: EventPatch };

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

  // An event with the changes saved for it laid over it. A change to a whole series shows on the rest of the series
  // too, except its time, which moves each occurrence by its own amount once the days reload.
  const applyEdits = (event: CalendarEvent) => {
    let patch: EventPatch | undefined;
    for (const edit of edits) {
      if (edit.id === event.id) patch = { ...patch, ...edit.patch };
      else if (edit.scope === "series" && edit.seriesId && edit.seriesId === event.seriesId) {
        const { startsAt: _s, endsAt: _e, allDay: _a, ...rest } = edit.patch;
        patch = { ...patch, ...rest };
      }
    }
    return withPatch(event, patch);
  };

  // Answers an invitation. The answer shows at once, marked as saving, while the worker sends it to the calendar.
  const answer = useCallback(
    async (event: CalendarEvent, response: EventResponse) => {
      if (!event.accountId) return;
      const pending = { token: `answer-${event.id}-${Date.now()}`, id: event.id, seriesId: null, scope: "occurrence" as const, patch: { response } };
      setEdits((list) => [...list, pending]);
      const dropPending = (token: string) => setEdits((list) => list.filter((e) => e.token !== token));
      const { data, error } = await supabase.from("calendar_updates").insert(buildResponse(event, response)).select("id").single();
      if (error || !data) {
        dropPending(pending.token);
        toast.error("Could not save your answer. Try again.");
        return;
      }
      const token = data.id;
      setEdits((list) => list.map((e) => (e.token === pending.token ? { ...e, token } : e)));
      const result = await followUpdate(token);
      if (result.status === "done") {
        updated.current.add(token);
        reload();
        return;
      }
      dropPending(token);
      toast.error(result.error ?? "Your answer could not be sent.");
    },
    [reload],
  );

  return { queued, setQueued, created, hidden, setHidden, deleted, edits, setEdits, updated, applyEdits, answer };
}

export type PendingChanges = ReturnType<typeof usePendingChanges>;
