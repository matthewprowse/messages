"use client";

// The Listen button for today's daily brief. Writes the brief first when needed, asks the worker to speak it, and plays the audio parts as they arrive.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pause, RotateCcw, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { track } from "@/lib/analytics";
import { supabase } from "@/lib/supabase";
import { cooldownWait, noteRefresh, readLastRefresh, REQUESTS_PER_DAY, whenAllowed } from "@/lib/brief-pace";
import { loadAllowance, loadBrief, loadBriefPart, loadBriefSettings, localDate, requestBrief, requestSpeech, syncTimezone, type BriefSettings, type DailyBrief } from "@/lib/brief";
import { joinParts } from "@/lib/wav";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A brief being written, or a part not stored yet, is waited for up to WAIT_MS. Realtime changes to the
 * brief row and to its parts end each wait at once; POLL_MS is only the slow fallback check, for a
 * connection that dropped or an event that never came.
 */
const POLL_MS = 6_000;
const WAIT_MS = 2 * 60_000;
/** A brief older than this is written again on Listen when a conversation has moved on since. */
const STALE_MS = 60 * 60_000;

/**
 * Listen to today's brief. Its audio comes in parts: the first is short, so playing starts as soon as
 * it is stored, and the rest play in turn while later ones are still being spoken. The morning brief is
 * only a script until someone listens: Listen asks the worker to speak it. Listen writes a fresh
 * brief first when there is none, it failed, the voice changed in Settings (once spoken), or conversations
 * moved on since it was written more than an hour ago. Speed comes from Settings. The script is never shown,
 * only played, and the phone's lock screen gets play and pause.
 */
export function BriefPlayer() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const { threads } = useApp();
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [playing, setPlaying] = useState(false);
  // The part now playing (from 0) and how many there are, while listening, paused or not. Null otherwise.
  const [part, setPart] = useState<{ seq: number; parts: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Briefs that may still be asked for in the next 24 hours (the database's cap), once read. Null while unknown.
  const [allowance, setAllowance] = useState<{ left: number; of: number; nextAt: number | null } | null>(null);
  // When this browser last refreshed, for the short cooldown; read after mount as storage is not there on the server.
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Waits in progress, woken early when the brief or its parts change, and a count of those changes so
  // one that lands between a check and the wait is not missed.
  const wakers = useRef(new Set<() => void>());
  // Ends the wait for the playing part, so stop() does not leave playFrom waiting on events that will never fire.
  const endWait = useRef<(() => void) | null>(null);
  const changes = useRef(0);
  const limited = useRef(false);
  const allowanceLeft = useRef<number | null>(null);
  allowanceLeft.current = allowance?.left ?? null;
  const current = useRef<HTMLAudioElement | null>(null);
  // Bumped to abandon a brief being played (Refresh, leaving the page).
  const run = useRef(0);
  // Where listening has got to, for the play and stop events: seconds of finished parts, and the part now playing.
  const progress = useRef<{ base: number; seq: number; parts: number } | null>(null);

  /** Ends the listening being counted, saying how far it got. */
  const finishListening = useCallback((done: boolean) => {
    const p = progress.current;
    if (!p) return;
    progress.current = null;
    const el = current.current;
    const fraction = el && el.duration > 0 ? el.currentTime / el.duration : 0;
    track("brief_stop", {
      pos_s: Math.round(p.base + (el?.currentTime ?? 0)),
      pct: done ? 100 : Math.round((100 * (p.seq + fraction)) / Math.max(1, p.parts)),
      done,
    });
  }, []);

  /** Waits ms, or until the brief or a part changes; at once when something changed since `seen` was read from `changes`. */
  const nap = useCallback(
    (ms: number, seen: number) =>
      new Promise<void>((resolve) => {
        if (changes.current !== seen) { resolve(); return; }
        const done = () => { clearTimeout(timer); wakers.current.delete(done); resolve(); };
        const timer = setTimeout(done, ms);
        wakers.current.add(done);
      }),
    [],
  );

  /** Polls `check` until it gives a value, the wait runs out or the run is abandoned. */
  const until = useCallback(
    async <T,>(mine: number, check: () => Promise<T | null | undefined>): Promise<T | null> => {
      for (const end = Date.now() + WAIT_MS; Date.now() < end && run.current === mine; ) {
        const seen = changes.current;
        const found = await check();
        if (found) return found;
        await nap(POLL_MS, seen);
      }
      return null;
    },
    [nap],
  );

  const refreshAllowance = useCallback(async (uid: string) => {
    const next = await loadAllowance(uid);
    if (next) setAllowance(next);
  }, []);
  useEffect(() => {
    if (!userId) return;
    void syncTimezone(userId);
    void loadBrief(localDate(), userId).then(setBrief);
    setLastRefresh(readLastRefresh());
    void refreshAllowance(userId);
    // Changes to the brief (written, speaking, ready) and to its parts (each stored) end the waits at once
    // instead of at the next check.
    const wake = () => {
      changes.current++;
      for (const w of [...wakers.current]) w();
    };
    const channel = supabase
      .channel(`brief-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "briefs", filter: `user_id=eq.${userId}` }, wake)
      .on("postgres_changes", { event: "*", schema: "public", table: "brief_parts", filter: `user_id=eq.${userId}` }, wake)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, refreshAllowance]);

  // Refresh is available again when its cooldown ends, and when the 24 hours of the oldest request run out.
  const wait = cooldownWait(lastRefresh, now);
  const cooling = wait > 0;
  const none = allowance !== null && allowance.left === 0;
  useEffect(() => {
    if (!cooling) return;
    const timer = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(timer);
  }, [cooling, wait]);
  useEffect(() => {
    if (!allowance?.nextAt || !userId) return;
    const timer = setTimeout(() => void refreshAllowance(userId), Math.min(2 ** 31 - 1, Math.max(1000, allowance.nextAt - Date.now() + 1000)));
    return () => clearTimeout(timer);
  }, [allowance?.nextAt, userId, refreshAllowance]);

  const stop = useCallback(() => {
    run.current++;
    finishListening(false);
    const el = current.current;
    current.current = null;
    if (el) { el.pause(); URL.revokeObjectURL(el.src); }
    setPlaying(false);
    setPart(null);
    setWaiting(false);
    for (const wake of [...wakers.current]) wake();
    endWait.current?.();
  }, [finishListening]);
  useEffect(() => stop, [stop]);

  /** The brief once it is speaking or ready, writing it first when asked to. Null when that failed. */
  const ready = useCallback(async (fresh: boolean, mine: number, uid: string): Promise<DailyBrief | null> => {
    const day = localDate();
    if (fresh) {
      const asked = await requestBrief(day, uid);
      void refreshAllowance(uid);
      if (!asked.ok) {
        if (asked.limit) {
          limited.current = true;
          toast(`You have asked for 3 briefs in the last 24 hours. You can ask again${asked.nextAt ? ` ${whenAllowed(asked.nextAt, Date.now())}` : " later"}.`);
        }
        return null;
      }
    }
    const found = await until<DailyBrief | "failed">(mine, async () => {
      const now = await loadBrief(day, uid);
      if (now?.status === "failed") return "failed";
      return (now?.status === "speaking" || now?.status === "ready") && now.parts ? now : null;
    });
    return found === "failed" ? null : found;
  }, [until, refreshAllowance]);

  /**
   * Plays the brief. One already fully stored is joined into a single recording, so nothing breaks between
   * its parts. One still being spoken plays part by part, each next part fetched and loaded while the one
   * before plays so it starts the moment that one ends, waiting only for a part not stored yet.
   */
  const playFrom = useCallback(async (b: DailyBrief, settings: BriefSettings, mine: number, uid: string) => {
    const count = b.parts ?? 0;
    const fetched = new Map<number, Promise<Blob | null>>();
    const part = (seq: number) => {
      if (!fetched.has(seq)) fetched.set(seq, until(mine, () => loadBriefPart(b.id, seq, uid)));
      return fetched.get(seq)!;
    };
    let joined: Blob | null = null;
    if (b.status === "ready" && count > 1) {
      const all = await Promise.all(Array.from({ length: count }, (_, seq) => part(seq)));
      if (run.current !== mine) return;
      joined = all.every((p) => p !== null) ? await joinParts(all as Blob[]) : null;
    }
    const pieces = joined ? 1 : count;
    const load = async (i: number) => {
      const blob = joined ?? (await part(i));
      if (!blob) return null;
      const el = new Audio(URL.createObjectURL(blob));
      el.preload = "auto";
      el.playbackRate = settings.speed;
      return el;
    };
    let next: Promise<HTMLAudioElement | null> = load(0);
    const dropNext = () => void next.then((el) => el && URL.revokeObjectURL(el.src));
    let completed = true;
    for (let seq = 0; seq < pieces && run.current === mine; seq++) {
      const el = await next;
      if (run.current !== mine) { if (el) URL.revokeObjectURL(el.src); return; }
      if (!el) { toast("Part of your brief did not arrive. Try again."); completed = false; break; }
      next = seq + 1 < pieces ? load(seq + 1) : Promise.resolve(null);
      if (seq === 0) track("brief_play", { speed: settings.speed });
      progress.current = { base: progress.current?.base ?? 0, seq, parts: pieces };
      setPart({ seq, parts: pieces });
      el.onplay = () => setPlaying(true);
      el.onpause = () => setPlaying(false);
      current.current = el;
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: "Daily Brief", artist: "Messages" });
        navigator.mediaSession.setActionHandler("play", () => void current.current?.play());
        navigator.mediaSession.setActionHandler("pause", () => current.current?.pause());
      }
      try {
        await el.play();
      } catch {
        // The browser refused to play (autoplay after a long wait) or the part would not decode.
        URL.revokeObjectURL(el.src);
        if (run.current === mine) toast("Your brief could not play. Try again.");
        completed = false;
        break;
      }
      // A part that fails mid-way ends like one that finished, so the rest still play.
      await new Promise<void>((done) => {
        const end = () => { if (endWait.current === end) endWait.current = null; done(); };
        endWait.current = end;
        el.onended = end;
        el.onerror = end;
        el.addEventListener("emptied", end, { once: true });
      });
      URL.revokeObjectURL(el.src);
      if (progress.current && run.current === mine) progress.current.base += Number.isFinite(el.duration) ? el.duration : 0;
    }
    dropNext();
    if (run.current === mine) { finishListening(completed); current.current = null; setPlaying(false); setPart(null); }
  }, [finishListening, until]);

  const listen = useCallback(async (forceFresh: boolean) => {
    if (!userId) return;
    stop();
    // stop() bumped the run, so a later Refresh or leaving the page abandons this one, even while it is still being prepared.
    const mine = run.current;
    limited.current = false;
    setWaiting(true);
    const [settings, latest] = await Promise.all([loadBriefSettings(userId), loadBrief(localDate(), userId)]);
    if (run.current !== mine) return;
    const moved = !!latest && Date.now() - Date.parse(latest.updatedAt) > STALE_MS && threads.some((t) => Date.parse(t.lastMessageAt) > Date.parse(latest.updatedAt));
    const written = latest?.status === "written";
    // With no requests left, a brief that exists is played as it is instead of asking for another.
    const spare = !forceFresh && !!latest && (latest.status === "ready" || latest.status === "written") && allowanceLeft.current === 0;
    const fresh = !spare && (forceFresh || !latest || latest.status === "failed" || ((latest.status === "ready" || written) && moved) || (latest.status === "ready" && latest.voice !== settings.voice));
    // The morning brief is stored as a script alone: ask for it to be spoken, then wait for the first part as for any brief.
    if (!fresh && written && !(await requestSpeech(latest.id, userId))) { setWaiting(false); toast("Your brief could not be prepared. Try again."); return; }
    const b = fresh || latest?.status !== "ready" ? await ready(fresh, mine, userId) : latest;
    if (run.current !== mine) return;
    setWaiting(false);
    if (!b) { if (!limited.current) toast("Your brief could not be prepared. Try again."); return; }
    setBrief(b);
    await playFrom(b, settings, mine, userId);
    // Once every part is stored the brief is ready; the next Listen plays it straight away.
    void loadBrief(localDate(), userId).then(setBrief);
  }, [userId, threads, stop, ready, playFrom]);

  /** Refresh Brief, once confirmed: counted first, so a failed attempt still paces the next. */
  const refresh = () => {
    setLastRefresh(noteRefresh(Date.now()));
    setNow(Date.now());
    void listen(true);
  };

  // One button: Listen, then Pause while it plays (Listen again carries on), or cancel while it is being prepared.
  const toggle = () => {
    const el = current.current;
    if (waiting) stop();
    else if (el && playing) el.pause();
    else if (el) void el.play();
    else void listen(false);
  };

  const active = part !== null;
  const label = waiting ? "Preparing" : playing ? "Pause" : "Listen";
  const left = allowance ? `${allowance.left} of ${allowance.of} Left Today` : null;
  const refreshNote = none ? `No Refreshes Left Today${allowance?.nextAt ? `, Available ${whenAllowed(allowance.nextAt, now)}` : ""}` : cooling ? "Available Again in a Minute" : "Refresh Brief";

  return (
    <div className="flex shrink-0 items-center gap-3">
      {waiting && <span role="status" className="hidden pr-1 text-xs text-muted-foreground md:inline">Writing your brief, this takes up to a minute</span>}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="icon" aria-label={waiting ? "Stop" : label} onClick={toggle}>
            {waiting ? <Loader2 className="animate-spin" /> : playing ? <Pause /> : <Volume2 />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{waiting ? "Stop" : label}</TooltipContent>
      </Tooltip>
      {brief && !waiting && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={none || cooling ? 0 : -1} className="flex items-center gap-3">
              {left && <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{left}</span>}
              <Button variant="ghost" size="icon" aria-label="Refresh Brief" disabled={none || cooling} onClick={() => setConfirming(true)}>
                <RotateCcw />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{refreshNote}</TooltipContent>
        </Tooltip>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refresh Brief?</AlertDialogTitle>
            <AlertDialogDescription>
              This writes a new brief from your latest conversations and plays it from the start{active ? ", replacing what is playing now" : ""}. You can ask for {REQUESTS_PER_DAY} briefs in any 24 hours, and the first brief of the day counts as one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={refresh}>Refresh Brief</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
