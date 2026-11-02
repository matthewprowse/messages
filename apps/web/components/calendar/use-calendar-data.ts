// Loads what the Calendar page shows: the events for the days on screen (reloaded when `version` goes up, when the
// worker stores or creates an event, or when the tab comes back), and the details of the event that is open (guests,
// notes, link), including opening one from a ?event= link. The page decides which days; this fetches them and keeps
// the opened events current.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { dayKey, loadEventDetail, loadEvents, type CalendarEvent } from "@/lib/calendar";
import { supabase } from "@/lib/supabase";
import { addDays, fromKey } from "@/lib/dates";
import type { View } from "@/components/calendar/dates";
import type { PendingChanges } from "@/components/calendar/use-pending-changes";

const STALE_MS = 60_000; // events older than this are loaded again when the tab is shown

export function useCalendarData({ userId, view, setAnchor, sized, startKey, length, rangeKey, version, mounted, reload, pending }: {
  userId: string | undefined;
  view: View;
  setAnchor: (day: Date) => void;
  /** False while the week view does not yet know how many days fit, so it does not load twice. */
  sized: boolean;
  startKey: string;
  length: number;
  rangeKey: string;
  version: number;
  mounted: { current: boolean };
  reload: () => void;
  pending: PendingChanges;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const eventParam = useSearchParams().get("event");
  const { queued, created, deleted, updated, setQueued, setHidden, setEdits } = pending;
  // undefined while loading, null if it failed.
  const [loaded, setLoaded] = useState<{ key: string; events: CalendarEvent[] | null } | undefined>(undefined);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [details, setDetails] = useState<Map<string, CalendarEvent>>(() => new Map());
  const [detailsFailed, setDetailsFailed] = useState<Set<string>>(() => new Set());
  // True when the last refresh failed but earlier events are still shown, so the page can offer Try Again.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const requested = useRef(new Set<string>());
  const loadedVersion = useRef(0);
  const loadedAt = useRef(0);

  // ?event=<id> opens that event on its day, such as from the Summary.
  const handledEvent = useRef<string | null>(null);
  useEffect(() => {
    if (!eventParam || !userId || handledEvent.current === eventParam) return;
    handledEvent.current = eventParam;
    loadEventDetail(eventParam)
      .then((event) => {
        if (!mounted.current) return;
        if (!event) {
          toast.error("That event could not be found.");
          router.replace(pathname, { scroll: false });
          return;
        }
        const day = event.allDay ? event.startsAt.slice(0, 10) : dayKey(new Date(event.startsAt));
        requested.current.add(event.id);
        setDetails((map) => new Map(map).set(event.id, event));
        setAnchor(fromKey(day));
        setOpenKey(`${event.id}|${day}`);
        router.replace(`${pathname}?${new URLSearchParams({ view, date: day }).toString()}`, { scroll: false });
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load event failed");
        if (!mounted.current) return;
        toast.error("That event did not load.");
        router.replace(pathname, { scroll: false });
      });
  }, [eventParam, userId, pathname, router, view]);

  useEffect(() => {
    if (!userId || !sized) return;
    let cancelled = false;
    const from = fromKey(startKey);
    loadEvents(from, addDays(from, length), { details: false })
      .then((events) => {
        if (cancelled) return;
        setLoaded({ key: rangeKey, events });
        setRefreshFailed(false);
        loadedAt.current = Date.now();
        if (created.current.size) setQueued((list) => list.filter((e) => !created.current.has(e.id)));
        if (deleted.current.size) setHidden((list) => list.filter((h) => !deleted.current.has(h.token)));
        if (updated.current.size) setEdits((list) => list.filter((e) => !updated.current.has(e.token)));
        // Opened events are fetched again after a reload, as they may have changed. What is held stays on screen until
        // the new copy arrives, so an open event does not fall back to its skeleton.
        if (loadedVersion.current !== version) {
          loadedVersion.current = version;
          requested.current.clear();
        }
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load events failed");
        if (cancelled) return;
        // A failed refresh keeps the events already shown; only a first load with nothing to show reports the error.
        setLoaded((prev) => ({ key: rangeKey, events: prev?.events ?? null }));
        setRefreshFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rangeKey, startKey, length, userId, version, sized]);

  // The sync worker stores events in calendar_events (a new invite, a moved meeting, a cancellation) and marks a queued
  // event created after it has stored it. Both reload the days; a burst of changes loads once (see useReload).
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`calendar-page-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calendar_events", filter: `user_id=eq.${userId}` }, () => reload())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calendar_outbox", filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.new as { id?: string; status?: string };
        if (row.status !== "created") return;
        if (row.id) created.current.add(row.id);
        reload();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, reload]);

  // Coming back to the tab loads the days again when they are more than a minute old, as Realtime may have missed a
  // change while the laptop slept.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > STALE_MS) reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [reload]);

  // Guests, notes and the link are fetched for an event once it is opened.
  const openId = openKey ? openKey.split("|")[0] : null;
  // The days before stay on screen while the next ones load, so moving through time never flashes a skeleton.
  const loadedEvents = loaded?.key === rangeKey ? loaded.events : (loaded?.events ?? undefined);
  // Closing an event (or opening another) forgets a failed load, so opening it again tries again.
  useEffect(() => {
    setDetailsFailed((set) => {
      const stale = [...set].filter((id) => id !== openId);
      if (!stale.length) return set;
      for (const id of stale) requested.current.delete(id);
      return new Set([...set].filter((id) => id === openId));
    });
  }, [openId]);
  useEffect(() => {
    if (!openId || requested.current.has(openId)) return;
    const base = loadedEvents?.find((e) => e.id === openId) ?? queued.find((e) => e.id === openId);
    if (queued.some((e) => e.id === openId)) return;
    if (base?.detailed) return;
    requested.current.add(openId);
    loadEventDetail(openId)
      .then((event) => {
        if (!mounted.current) return;
        if (event) setDetails((map) => new Map(map).set(openId, event));
        else setDetailsFailed((set) => new Set(set).add(openId));
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load event failed");
        if (mounted.current) setDetailsFailed((set) => new Set(set).add(openId));
      });
  }, [openId, loadedEvents, queued]);

  return { loaded, setLoaded, refreshFailed, loadedEvents, openKey, setOpenKey, openId, details, detailsFailed };
}
