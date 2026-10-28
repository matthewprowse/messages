"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { clock } from "@/components/media-player";
import type { OutboxFiles } from "@/components/outbox-attachments";

// Voice notes recorded in the WhatsApp reply box. The browser records in whatever it supports (Ogg or
// WebM Opus, or MP4 in older Safari); the worker converts it to the format WhatsApp plays as a voice note.
// Stopping adds the recording to the reply's files, to listen to or remove before sending.

/** Formats to record in, best first. */
const FORMATS = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
/** WhatsApp drops voice notes shorter than this. */
const SHORTEST_MS = 1000;

function format(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f));
}

function extension(mimeType: string): string {
  if (mimeType.startsWith("audio/ogg")) return "ogg";
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  return "webm";
}

function startError(e: unknown, speaking: boolean): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return speaking ? "Allow the microphone in your browser to say what to write." : "Allow the microphone in your browser to record a voice note.";
  if (name === "NotFoundError") return "No microphone was found.";
  return "The microphone could not be started.";
}

export type VoiceRecorder = ReturnType<typeof useVoiceRecorder>;

/** Records from the microphone into the reply's files, or with onClip, hands the recording back instead
 *  (Speak, which tells the AI what a draft should say). Recording stops and is thrown away when the thread changes. */
export function useVoiceRecorder(files: Pick<OutboxFiles, "addVoiceNote" | "notify">, threadId: string, onClip?: (clip: Blob, secs: number) => void) {
  const [state, setState] = useState<"idle" | "starting" | "recording">("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const keep = useRef(false);
  const startedAt = useRef(0);
  const generation = useRef(0); // moves on when the thread changes, so a late microphone is let go
  const { addVoiceNote, notify } = files;
  const clipRef = useRef(onClip);
  clipRef.current = onClip;
  const speaking = !!onClip;

  const stopTracks = (r: MediaRecorder | null) => r?.stream.getTracks().forEach((t) => t.stop());

  const start = useCallback(async () => {
    if (state !== "idle") return;
    const mimeType = format();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) { notify("This browser cannot record voice notes."); return; }
    notify(null);
    setState("starting");
    const mine = ++generation.current;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (e) {
      if (mine !== generation.current) return;
      setState("idle");
      notify(startError(e, speaking));
      return;
    }
    if (mine !== generation.current) { stream.getTracks().forEach((t) => t.stop()); return; }
    // Speech for the AI needs far less than a voice note someone listens to.
    const r = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: speaking ? 24_000 : 64_000 });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    r.onstop = () => {
      stopTracks(r);
      if (recorder.current === r) recorder.current = null;
      setState("idle");
      if (!keep.current) return;
      const ms = Date.now() - startedAt.current;
      if (ms < SHORTEST_MS) { notify(speaking ? "The recording was too short." : "The voice note was too short."); return; }
      const type = r.mimeType || mimeType;
      const blob = new Blob(chunks, { type });
      if (clipRef.current) { clipRef.current(blob, Math.round(ms / 1000)); return; }
      addVoiceNote(new File([blob], `Voice Note.${extension(type)}`, { type }), Math.round(ms / 1000));
    };
    recorder.current = r;
    keep.current = false;
    startedAt.current = Date.now();
    setElapsed(0);
    r.start(1000);
    setState("recording");
  }, [state, notify, addVoiceNote, speaking]);

  const finish = useCallback((save: boolean) => {
    const r = recorder.current;
    if (!r) return;
    keep.current = save;
    if (r.state !== "inactive") r.stop();
    else stopTracks(r);
  }, []);
  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => finish(false), [finish]);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 250);
    return () => clearInterval(timer);
  }, [state]);

  // Another conversation, or leaving this one, throws the recording away and frees the microphone.
  useEffect(() => () => { generation.current++; finish(false); setState("idle"); }, [threadId, finish]);

  return { state, elapsed, start, stop, cancel, recording: state !== "idle" };
}

/** Speak: say what the reply should say, and the AI drafts it. On every channel. */
export function SpeakButton({ voice, disabled }: { voice: VoiceRecorder; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" size="icon" aria-label="Say What To Say" title="Say What To Say" disabled={disabled || voice.recording} onClick={voice.start}>
      <AudioLines />
    </Button>
  );
}

/** The microphone button next to the paperclip. Shown only where voice notes can be sent. */
export function RecordButton({ files, voice }: { files: OutboxFiles; voice: VoiceRecorder }) {
  if (files.provider !== "whatsapp") return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Record Voice Note"
          disabled={files.disabled || files.uploading || voice.recording}
          onClick={voice.start}
        >
          <Mic />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-balance">Record a voice note to send as your reply.</TooltipContent>
    </Tooltip>
  );
}

/** Takes the text box's place while recording: a dot and the time so far. */
export function RecordingStatus({ voice }: { voice: VoiceRecorder }) {
  return (
    <div className="flex h-5 items-center gap-2 text-sm" role="status" aria-live="polite">
      <span className="size-2 animate-pulse rounded-full bg-destructive" aria-hidden />
      <span>{voice.state === "starting" ? "Starting Microphone" : "Recording"}</span>
      {voice.state === "recording" && <span className="tabular-nums text-muted-foreground">{clock(voice.elapsed)}</span>}
    </div>
  );
}

/** Cancel and Stop, in place of the Send button while recording. */
export function RecordingActions({ voice, done = "Stop" }: { voice: VoiceRecorder; done?: string }) {
  return (
    <div className="flex items-center gap-2">
      {/* type="button": inside a dialog's form, a plain button would submit it, and send the message. */}
      <Button type="button" variant="ghost" onClick={voice.cancel} disabled={voice.state !== "recording"}>Cancel</Button>
      <Button type="button" onClick={voice.stop} disabled={voice.state !== "recording"}>{done}</Button>
    </div>
  );
}
