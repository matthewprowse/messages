import { cleanProps, sizeOf, type EventName, type Events } from "@messages/analytics";
import { supabase } from "./supabase";

// Content-free product analytics. An event is a name and a few numbers, flags and plain code words
// (see @messages/analytics); text is dropped here and again by the database. Nothing is sent unless
// the person is signed in and "Share Usage Data" is on, and the database checks that switch too.

const FLUSH_MS = 5000;
const BATCH = 20;
/** The most events the database takes in one call. */
const PER_CALL = 50;
const VERSION = process.env.NEXT_PUBLIC_APP_VERSION && /^[a-z][a-z0-9_.:-]{0,39}$/.test(process.env.NEXT_PUBLIC_APP_VERSION) ? process.env.NEXT_PUBLIC_APP_VERSION : "dev";

interface Queued {
  name: string;
  props: ReturnType<typeof cleanProps>;
  screen?: string;
}

let sharing = false;
let screen = "";
let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sessionId: string | undefined;
const submitted = new Set<string>();

function session() {
  sessionId ??= crypto.randomUUID();
  return sessionId;
}

/** On when the person is signed in and has Share Usage Data on. Turning it off also drops what is waiting to be sent. */
export function setSharing(on: boolean) {
  sharing = on;
  if (!on) queue = [];
}

/** The screen events are filed under until it changes: a route name, never an ID. */
export function setScreen(next: string) {
  screen = next;
}

export function currentScreen() {
  return screen;
}

/**
 * Records one event, filed under the screen open now (not the one open when the batch is sent). Fire and forget: it
 * never throws and never waits. `on` files it under another screen, such as the one just left.
 */
export function track<K extends EventName>(name: K, props: Events[K], on?: string) {
  if (!sharing || typeof window === "undefined") return;
  queue.push({ name, props: cleanProps(props as Record<string, unknown>), screen: on ?? (screen || undefined) });
  if (queue.length >= BATCH) void flush();
  else timer ??= setTimeout(() => void flush(), FLUSH_MS);
}

export async function flush() {
  clearTimeout(timer);
  timer = undefined;
  if (queue.length === 0) return;
  const events = queue.splice(0, PER_CALL).map((e) => ({ name: e.name, props: e.props, ...(e.screen ? { screen: e.screen } : {}) }));
  try {
    await supabase.rpc("track", { p_session: session(), p_screen: screen, p_size: sizeOf(window.innerWidth), p_version: VERSION, p_events: events });
  } catch {
    // Analytics never gets in the way. A batch that does not arrive is lost.
  }
  if (queue.length > 0) timer ??= setTimeout(() => void flush(), FLUSH_MS);
}

let nextVia: string | undefined;

/** Says how the next conversation is about to be opened (from search, say), for the one that opens it to report. */
export function viaNext(via: string) {
  nextVia = via;
}

export function takeVia(fallback: string) {
  const via = nextVia ?? fallback;
  nextVia = undefined;
  return via;
}

/** A dialog's submit button calls this before it closes, so the close counts as a submit and not a cancel. */
export function markSubmitted(dialog: string) {
  submitted.add(dialog);
}

export function takeSubmitted(dialog: string) {
  return submitted.delete(dialog);
}

/** Which screen a path belongs to: its first part, and for Settings the section too. Never an ID. */
export function screenOf(pathname: string): string {
  const [first = "", second = ""] = pathname.split("/").filter(Boolean);
  if (!first) return "home";
  return first === "settings" && second ? `settings_${second}` : first;
}
