"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { loadBrief, loadBriefAudio, localDate, requestBrief, syncTimezone, type DailyBrief } from "@/lib/brief";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** How often an asked-for brief is checked while it is written, and for how long. */
const POLL_MS = 3000;
const WAIT_MS = 3 * 60_000;

/**
 * Listen to today's brief. The AI worker writes one each morning; when there is none yet, Listen asks for
 * it and plays it as soon as it is ready. The script shows while it plays, and the phone's lock screen
 * gets play and pause controls.
 */
export function BriefPlayer({ onScript }: { onScript: (script: string | null) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    void syncTimezone(userId);
    void loadBrief(localDate()).then(setBrief);
  }, [userId]);

  // Stops and lets go of the audio when the page is left.
  useEffect(() => () => {
    audio.current?.pause();
    if (audio.current?.src) URL.revokeObjectURL(audio.current.src);
  }, []);

  const play = useCallback(async (ready: DailyBrief) => {
    if (audioFor.current !== `${ready.id}:${ready.updatedAt}`) {
      const blob = await loadBriefAudio(ready.id);
      if (!blob) { toast("Could not load your brief. Try again."); return; }
      audio.current?.pause();
      if (audio.current?.src) URL.revokeObjectURL(audio.current.src);
      const el = new Audio(URL.createObjectURL(blob));
      el.onplay = () => setPlaying(true);
      el.onpause = () => setPlaying(false);
      el.onended = () => setPlaying(false);
      audio.current = el;
      audioFor.current = `${ready.id}:${ready.updatedAt}`;
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: "Daily Brief", artist: "Messages" });
        navigator.mediaSession.setActionHandler("play", () => void el.play());
        navigator.mediaSession.setActionHandler("pause", () => el.pause());
      }
    }
    onScript(ready.script ?? null);
    await audio.current?.play();
  }, [onScript]);

  /** Asks for a brief and plays it once the worker has written it. */
  const ask = useCallback(async () => {
    const day = localDate();
    setWaiting(true);
    if (!(await requestBrief(day))) {
      setWaiting(false);
      toast("Could not ask for your brief. Check your connection and try again.");
      return;
    }
    for (const until = Date.now() + WAIT_MS; Date.now() < until; ) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const now = await loadBrief(day);
      if (now?.status === "ready") {
        setBrief(now);
        setWaiting(false);
        await play(now);
        return;
      }
      if (now?.status === "failed") break;
    }
    setWaiting(false);
    toast("Your brief could not be prepared. Try again.");
  }, [play]);

  const toggle = () => {
    if (playing) { audio.current?.pause(); return; }
    if (brief?.status === "ready") void play(brief);
    else void ask();
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="outline" disabled={waiting} onClick={toggle}>
        {waiting ? <Loader2 className="animate-spin" /> : playing ? <Pause /> : <Play />}
        {waiting ? "Preparing" : playing ? "Pause" : "Listen"}
      </Button>
      {brief?.status === "ready" && !waiting && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Refresh Brief" onClick={() => { audio.current?.pause(); void ask(); }}><RotateCcw /></Button>
          </TooltipTrigger>
          <TooltipContent>Refresh Brief</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
