"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useSignedUrl } from "@/lib/signed-urls";
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
    const events = ["play", "pause", "ended", "timeupdate", "durationchange", "loadedmetadata", "volumechange"];
    for (const e of events) el.addEventListener(e, sync);
    el.addEventListener("error", fail);
    sync();
    return () => {
      for (const e of events) el.removeEventListener(e, sync);
      el.removeEventListener("error", fail);
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

const RATES = [1, 1.5, 2];

/**
 * A voice note or audio file in a conversation: play and pause, a bar to scrub through it, the time,
 * and a speed button (1x, 1.5x, 2x), drawn to match the bubble it sits in.
 */
export function VoiceNote({ attachment: a, me, transcript }: { attachment: Attachment; me: boolean; transcript?: string }) {
  const url = useSignedUrl("attachments", a.path);
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
  // Touch has no hover, so a tap on the picture shows the controls and they hide again after 3 seconds.
  const [shown, setShown] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touched = useRef(false);
  const reveal = useCallback(() => {
    setShown(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShown(false), 3000);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  // Playing again or pausing hands the controls back to the normal rules.
  useEffect(() => {
    if (!playing) {
      clearTimeout(hideTimer.current);
      setShown(false);
    }
  }, [playing]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen?.();
  };

  return (
    <div
      ref={frame}
      data-own-arrows
      onPointerDown={(e) => { touched.current = e.pointerType === "touch"; }}
      className={cn("group/video relative flex w-full flex-col overflow-hidden rounded-lg bg-black", full && "justify-center rounded-none")}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
        else if (e.key === "ArrowRight") seek(Math.min(duration, time + 5));
        else if (e.key === "ArrowLeft") seek(Math.max(0, time - 5));
        else if (e.key === "m") mute();
        else if (e.key === "f") fullscreen();
      }}
    >
      <video
        ref={ref}
        src={src}
        playsInline
        preload="metadata"
        onClick={() => {
          // First tap on a touch screen only shows the controls; the next one plays or pauses.
          if (touched.current && playing && !shown) reveal();
          else {
            if (touched.current && playing) reveal();
            toggle();
          }
        }}
        aria-label={name}
        className={cn("w-full cursor-pointer", full ? "max-h-full" : "max-h-[min(70vh,calc(100dvh-15rem))]")}
      />
      {failed && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">This Video Can't Play Here. Download It to Watch.</p>}
      {!playing && !failed && (
        <button type="button" onClick={toggle} aria-label="Play Video" className="absolute inset-0 m-auto flex size-14 items-center justify-center rounded-full bg-black/60 text-white outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <Play className="size-6 translate-x-0.5" fill="currentColor" />
        </button>
      )}
      <div
        onPointerDown={() => { if (playing) reveal(); }}
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-2 text-white transition-opacity",
          playing && !shown && "pointer-events-none opacity-0 group-hover/video:pointer-events-auto group-hover/video:opacity-100 group-focus-within/video:pointer-events-auto group-focus-within/video:opacity-100",
        )}
      >
        <Button variant="ghost" size="icon" className="shrink-0 text-white hover:bg-white/15 hover:text-white max-sm:size-10" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <span className="shrink-0 text-xs tabular-nums">{clock(time)} / {clock(duration)}</span>
        <Slider
          value={[Math.min(time, duration || 0)]}
          max={duration || 1}
          step={0.1}
          disabled={!duration}
          onValueChange={([v]) => seek(v)}
          aria-label="Position"
          className="flex-1 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-track]]:bg-white/30"
        />
        <Button variant="ghost" size="icon" className="shrink-0 text-white hover:bg-white/15 hover:text-white max-sm:size-10" onClick={mute} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>
        <Button variant="ghost" size="icon" className="shrink-0 text-white hover:bg-white/15 hover:text-white max-sm:size-10" onClick={fullscreen} aria-label={full ? "Exit Full Screen" : "Full Screen"}>
          {full ? <Minimize /> : <Maximize />}
        </Button>
      </div>
    </div>
  );
}
