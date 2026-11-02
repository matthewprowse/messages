"use client";

// Audio and video players drawn to match the app: voice notes in chat bubbles and the video player in the attachment viewer, with the clock and media state hook they share.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { mimeFor, useSignedUrl } from "@/lib/signed-urls";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { track } from "@/lib/analytics";

/** "1:05", or "1:02:05" past an hour. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** The state of an audio or video element, and the controls for it. */
export function useMedia(ref: RefObject<HTMLMediaElement | null>) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      setPlaying(!el.paused && !el.ended);
      setTime(el.currentTime);
      // Some Ogg voice notes report Infinity until played through once.
      if (Number.isFinite(el.duration)) setDuration(el.duration);
      setMuted(el.muted);
    };
    const fail = () => setFailed(true);
    // A new source starts loading afresh, so an earlier failure no longer applies.
    const fresh = () => setFailed(false);
    const events = ["play", "pause", "ended", "timeupdate", "durationchange", "loadedmetadata", "volumechange"];
    for (const e of events) el.addEventListener(e, sync);
    el.addEventListener("error", fail);
    el.addEventListener("loadstart", fresh);
    sync();
    return () => {
      for (const e of events) el.removeEventListener(e, sync);
      el.removeEventListener("error", fail);
      el.removeEventListener("loadstart", fresh);
    };
  }, [ref]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Another voice note or video playing stops when this one starts.
    if (el.paused) {
      document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((other) => { if (other !== el) other.pause(); });
      void el.play().catch(() => setFailed(true));
    } else el.pause();
  }, [ref]);
  const seek = useCallback((to: number) => { if (ref.current) ref.current.currentTime = to; }, [ref]);
  const mute = useCallback(() => { if (ref.current) ref.current.muted = !ref.current.muted; }, [ref]);
  return { playing, time, duration, muted, failed, toggle, seek, mute };
}

/** The height every picture and video is shown in, so the dialog is the same size before and after the file arrives. */
export const STAGE_HEIGHT = "h-[min(65dvh,calc(100dvh-14rem))]";

const RATES = [1, 1.5, 2];

/**
 * A voice note or audio file in a conversation: play and pause, a bar to scrub through it, the time,
 * and a speed button (1x, 1.5x, 2x), drawn to match the bubble it sits in.
 */
export function VoiceNote({ attachment: a, me, transcript }: { attachment: Attachment; me: boolean; transcript?: string }) {
  const url = useSignedUrl("attachments", a.path, false, a.sealed ? mimeFor(a) : undefined);
  const ref = useRef<HTMLAudioElement>(null);
  const { playing, time, duration, failed, toggle, seek } = useMedia(ref);
  const [rate, setRate] = useState(1);
  const [reading, setReading] = useState(false);
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate, url]);

  const ready = !!url && !failed;
  const label = a.name.replace(/\.[a-z0-9]+$/i, "");
  return (
    <div className={cn("flex w-72 max-w-full flex-col rounded-lg p-2 pr-3", me ? "rounded-br-[2px] bg-primary text-primary-foreground" : "rounded-bl-[2px] bg-muted")}>
      <div className="flex items-center gap-2">
        {/* Always mounted, so useMedia's listeners attach on first render even while the signed URL loads. */}
        <audio ref={ref} src={url || undefined} preload="metadata" />
        <Button variant="ghost" size="icon" className="shrink-0 rounded-full hover:bg-current/10" disabled={!ready} onClick={() => { if (!playing) track("audio_played", { after_transcript: reading }); toggle(); }} aria-label={playing ? `Pause ${label}` : `Play ${label}`}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Slider
            value={[Math.min(time, duration || 0)]}
            max={duration || 1}
            step={0.1}
            disabled={!ready || !duration}
            onValueChange={([v]) => seek(v)}
            aria-label={`Position in ${label}`}
            className={cn(me && "[&_[data-slot=slider-range]]:bg-primary-foreground [&_[data-slot=slider-thumb]]:border-primary-foreground [&_[data-slot=slider-track]]:bg-primary-foreground/30")}
          />
          <span className="text-xs tabular-nums opacity-70">
            {failed ? "Can't Play This Here" : !url ? (a.path ? "Loading" : "Still Downloading") : `${clock(playing || time ? time : duration)}`}
          </span>
        </div>
        <Button variant="ghost" size="xs" className="shrink-0 tabular-nums hover:bg-current/10 max-sm:h-10 max-sm:min-w-10" disabled={!ready} onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])} aria-label="Playback Speed">
          {rate}x
        </Button>
      </div>
      {/* What was said, written out by the AI worker. */}
      {transcript && (
        <>
          {reading && <p className="mt-2 px-1 text-sm leading-6 whitespace-pre-wrap wrap-anywhere">{transcript}</p>}
          <Button variant="ghost" size="xs" className="mt-1 self-start hover:bg-current/10" onClick={() => setReading((r) => !r)} aria-expanded={reading}>
            {reading ? "Hide Transcript" : "View Transcript"}
          </Button>
        </>
      )}
    </div>
  );
}

/** A video with the app's own controls: play, a bar to scrub, the time, mute and full screen. */
export function VideoPlayer({ src, name }: { src: string; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const { playing, time, duration, muted, failed, toggle, seek, mute } = useMedia(ref);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const box = frame.current; // by cleanup time the ref is null, which would match "nothing is in full screen"
    const onChange = () => setFull(document.fullscreenElement === box);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      // Closing the dialog or stepping to another file while full screen must not leave the page in it.
      if (box && document.fullscreenElement === box) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const fullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => undefined); return; }
    const box = frame.current;
    if (box?.requestFullscreen) void box.requestFullscreen().catch(() => undefined);
    else (ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.(); // iPhone Safari: only the video itself, with its own controls
  };

  return (
    <div
      ref={frame}
      data-own-arrows
      className={cn("flex w-full flex-col gap-3", full && "h-full w-full gap-0 bg-black text-white")}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
        else if (e.key === "ArrowRight") seek(Math.min(duration, time + 5));
        else if (e.key === "ArrowLeft") seek(Math.max(0, time - 5));
        else if (e.key === "m") mute();
        else if (e.key === "f") fullscreen();
      }}
    >
      {/* The video fills a fixed frame with no bars of its own, so the dialog does not change size once it loads. */}
      <div className={cn("relative flex items-center justify-center overflow-hidden rounded-lg", full ? "min-h-0 flex-1 rounded-none" : STAGE_HEIGHT)}>
        <video
          ref={ref}
          src={src}
          playsInline
          preload="metadata"
          onClick={toggle}
          aria-label={name}
          className="size-full cursor-pointer bg-transparent object-contain"
        />
        {failed && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">This Video Can't Play Here. Download It to Watch.</p>}
        {!playing && !failed && (
          <button type="button" onClick={toggle} aria-label="Play Video" className="absolute inset-0 m-auto flex size-14 items-center justify-center rounded-full bg-black/60 text-white outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <Play className="size-6 translate-x-0.5" fill="currentColor" />
          </button>
        )}
      </div>
      {/* The controls sit under the picture, never over it. */}
      <div className={cn("flex shrink-0 items-center gap-2", full && "px-3 py-2 text-white [&_button]:text-white [&_button:hover]:bg-white/15 [&_[data-slot=slider-track]]:bg-white/30")}>
        <Button variant="ghost" size="icon" className="shrink-0 max-sm:size-10" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <span className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", full && "text-white/70")}>{clock(time)} / {clock(duration)}</span>
        <Slider
          value={[Math.min(time, duration || 0)]}
          max={duration || 1}
          step={0.1}
          disabled={!duration}
          onValueChange={([v]) => seek(v)}
          aria-label="Position"
          className="flex-1"
        />
        <Button variant="ghost" size="icon" className="shrink-0 max-sm:size-10" onClick={mute} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>
        <Button variant="ghost" size="icon" className="shrink-0 max-sm:size-10" onClick={fullscreen} aria-label={full ? "Exit Full Screen" : "Full Screen"}>
          {full ? <Minimize /> : <Maximize />}
        </Button>
      </div>
    </div>
  );
}
