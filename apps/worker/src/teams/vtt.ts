// A Teams meeting transcript, which Graph gives as WebVTT, turned into what meetings.transcript keeps:
// [{"speaker": "Name", "start_ms": 0, "text": "..."}], oldest first. Teams writes one cue per phrase with
// the speaker in a voice tag (<v Adele Vance>...</v>), so a speaker's run of cues becomes one segment.
// Pure, so it can be unit tested.

export interface TranscriptSegment {
  /** Who spoke, as Teams names them. Null when the cue has no voice tag. */
  speaker: string | null;
  /** When they started, from the start of the transcript. */
  start_ms: number;
  text: string;
}

/** A WebVTT time: "01:02:03.456", "02:03.456" or Teams' older "1:2:3.45". Null when it is not one. */
export function vttTime(value: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(value.trim());
  if (!m) return null;
  const [, hours = "0", minutes, seconds, fraction = ""] = m;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, "0"));
}

const TIMING = /^\s*(\S+)\s+-->\s+(\S+)/;
const VOICE = /<v(?:\.[^\s>]*)?(?:\s+([^>]*))?>/gi;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** A cue's words: other tags (<c>, <i>, inline times) dropped, entities decoded, lines joined. */
function words(text: string): string {
  return decode(text.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** The speakers and words in one cue's text. A cue may hold more than one voice; text before any has none. */
function voices(payload: string): { speaker: string | null; text: string }[] {
  const out: { speaker: string | null; text: string }[] = [];
  const opens = [...payload.matchAll(VOICE)];
  const before = words(payload.slice(0, opens[0]?.index ?? payload.length));
  if (before) out.push({ speaker: null, text: before });
  for (const [i, open] of opens.entries()) {
    const end = opens[i + 1]?.index ?? payload.length;
    const text = words(payload.slice(open.index! + open[0].length, end));
    const speaker = decode(open[1] ?? "").replace(/\s+/g, " ").trim() || null;
    if (text) out.push({ speaker, text });
  }
  return out;
}

/**
 * The segments of a WebVTT transcript, oldest first. Consecutive cues by the same speaker join into one
 * segment; a cue with no voice tag has a null speaker. NOTE, STYLE and REGION blocks, cue IDs and cue
 * settings are ignored, as is anything that is not a cue.
 */
export function parseVtt(vtt: string): TranscriptSegment[] {
  const cues: TranscriptSegment[] = [];
  const blocks = vtt.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/);
  for (const block of blocks) {
    const lines = block.split("\n");
    // The header block has no timing line, unless a cue follows it without a blank line, which still counts.
    const at = lines.findIndex((line) => line.includes("-->"));
    if (at < 0 || /^(?:NOTE|STYLE|REGION)\b/.test(lines[0]!.trim())) continue;
    const timing = TIMING.exec(lines[at]!);
    const start = timing ? vttTime(timing[1]!) : null;
    if (start === null) continue;
    for (const voice of voices(lines.slice(at + 1).join("\n"))) cues.push({ speaker: voice.speaker, start_ms: start, text: voice.text });
  }
  // Cues are meant to be in order; a stable sort keeps any that are not from jumping around within a time.
  cues.sort((a, b) => a.start_ms - b.start_ms);

  const out: TranscriptSegment[] = [];
  for (const cue of cues) {
    const last = out.at(-1);
    if (last && last.speaker === cue.speaker) last.text = `${last.text} ${cue.text}`;
    else out.push({ ...cue });
  }
  return out;
}

/**
 * Several transcripts of one meeting (transcription stopped and started again) as one, each moved by how
 * long after the first it began.
 */
export function joinTranscripts(parts: { startedAt: number; segments: TranscriptSegment[] }[]): TranscriptSegment[] {
  const sorted = [...parts].sort((a, b) => a.startedAt - b.startedAt);
  const first = sorted[0]?.startedAt ?? 0;
  return sorted.flatMap((part) => part.segments.map((s) => ({ ...s, start_ms: s.start_ms + Math.max(0, part.startedAt - first) })));
}
