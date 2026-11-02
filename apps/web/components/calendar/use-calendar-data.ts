// Loads what the Calendar page shows: the events for the days on screen (reloaded when `version` goes up or the
// worker creates an event), and the details of the event that is open (guests, notes, link), including opening one
// from a ?event= link. The page decides which days; this fetches them and keeps the opened events current.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { dayKey, loadEventDetail, loadEvents, type CalendarEvent } from "@/lib/calendar";
import { supabase } from "@/lib/supabase";
import { addDays, fromKey, type View } from "@/components/calendar/dates";
import type { PendingChanges } from "@/components/calendar/use-pending-changes";

export function useCalendarData({ userId, view, setAnchor, paneWidth, startKey, length, rangeKey, version, mounted, reload, pending }: {
  userId: string | undefined;
  view: View;
  setAnchor: (day: Date) => void;
  paneWidth: number;
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
  const requested = useRef(new Set<string>());
  const loadedVersion = useRef(0);

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
    // The week view waits to know how many days fit.
    if (!userId || (view === "week" && paneWidth === 0)) return;
    let cancelled = false;
    const from = fromKey(startKey);
    loadEvents(from, addDays(from, length), { details: false })
      .then((events) => {
        if (cancelled) return;
        setLoaded({ key: rangeKey, events });
        if (created.current.size) setQueued((list) => list.filter((e) => !created.current.has(e.id)));
        if (deleted.current.size) setHidden((list) => list.filter((h) => !deleted.current.has(h.token)));
        if (updated.current.size) setEdits((list) => list.filter((e) => !updated.current.has(e.token)));
        // Opened events are fetched again after a reload, as they may have changed.
        if (loadedVersion.current !== version) {
          loadedVersion.current = version;
          requested.current.clear();
          setDetails(new Map());
        }
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load events failed");
        if (cancelled) return;
        // A failed refresh keeps the events already shown; only a first load with nothing to show reports the error.
        setLoaded((prev) => ({ key: rangeKey, events: prev?.events ?? null }));
        toast.error("Events did not load. Try again in a moment.");
      });
    return () => {
      cancelled = true;
    };
  }, [rangeKey, startKey, length, userId, version, view, paneWidth]);

  // The worker stores a new event in calendar_events before it marks the queued row created.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`calendar-page-${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calendar_outbox", filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.new as { id?: string; status?: string };
        if (row.status !== "created") return;
        if (row.id) created.current.add(row.id);
        reload();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, reload]);

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

  return { loaded, setLoaded, loadedEvents, openKey, setOpenKey, openId, details, detailsFailed };
}
