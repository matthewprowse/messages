// WebVTT transcripts, as Zoom and Teams give them, turned into the segments meetings.transcript stores:
// [{"speaker": "Name", "start_ms": 0, "text": "..."}], oldest first. Pure, so it can be unit tested.
//
// Zoom writes each cue as "Name: what they said", Teams as "<v Name>what they said</v>"; both are read. A cue
// can run over several lines. A cue with no speaker (Zoom could not tell who it was) has speaker null. Cues
// in a row from the same named speaker are joined into one segment that starts when the first one does.

export interface TranscriptSegment {
  speaker: string | null;
  start_ms: number;
  text: string;
}

const TIMING = /^((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
/** A voice tag at the start of a cue: <v Name> or <v.loud Name>. */
const VOICE = /^<v(?:\.[^\s>]+)*\s+([^>]+)>/i;
/** "Name: text". The space after the colon keeps times (10:30) and links (https://) from looking like names. */
const PREFIX = /^([^:<>\n]{1,80}?):\s+(.*)$/;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", nbsp: " ", quot: '"', apos: "'", lrm: "", rlm: "" };

/** Milliseconds from a VTT timestamp: hh:mm:ss.ttt or mm:ss.ttt. */
export function timestampMs(value: string): number {
  const [clock, fraction = "0"] = value.split(/[.,]/);
  const parts = clock.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return ((h * 60 + m) * 60 + s) * 1000 + Number(fraction.padEnd(3, "0").slice(0, 3));
}

function plain(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Who said a cue and what, from its text lines. */
function speakerAndText(lines: string[]): { speaker: string | null; text: string } {
  const first = lines[0]?.trim() ?? "";
  const voice = first.match(VOICE);
  if (voice) return { speaker: plain(voice[1]) || null, text: plain(lines.join(" ")) };
  const prefix = first.match(PREFIX);
  if (prefix && plain(prefix[1])) {
    return { speaker: plain(prefix[1]), text: plain([prefix[2], ...lines.slice(1)].join(" ")) };
  }
  return { speaker: null, text: plain(lines.join(" ")) };
}

export function parseVtt(vtt: string): TranscriptSegment[] {
  const blocks = vtt.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const segments: TranscriptSegment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const at = lines.findIndex((l) => TIMING.test(l.trim()));
    if (at < 0) continue; // the header, NOTE, STYLE and REGION blocks
    const start = timestampMs(lines[at].trim().match(TIMING)![1]);
    const { speaker, text } = speakerAndText(lines.slice(at + 1));
    if (!text) continue;
    const last = segments[segments.length - 1];
    if (last && speaker !== null && last.speaker === speaker) last.text = `${last.text} ${text}`;
    else segments.push({ speaker, start_ms: start, text });
  }
  return segments.sort((a, b) => a.start_ms - b.start_ms);
}
