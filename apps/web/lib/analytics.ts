// Content-free product analytics. An event is a name and a few numbers, flags and plain code words
// (see @messages/analytics); text is dropped here and again by the database. Nothing is sent unless
// the person is signed in and "Share Usage Data" is on, and the database checks that switch too.

import { cleanProps, isWord, sizeOf, type EventName, type Events } from "@messages/analytics";
import { guardProps } from "@messages/analytics/allowed";
import { nextSession, parseSession, type StoredSession } from "./analytics-session";
import { supabase } from "./supabase";

const FLUSH_MS = 5000;
const BATCH = 20;
/** The most events the database takes in one call. */
const PER_CALL = 50;
const VERSION = isWord(process.env.NEXT_PUBLIC_APP_VERSION) ? process.env.NEXT_PUBLIC_APP_VERSION : "dev";
const SESSION_KEY = "konva_session";
const RPC_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/track`;

interface Queued {
  name: string;
  props: ReturnType<typeof cleanProps>;
  screen?: string;
}

let sharing = false;
let screen = "";
let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let accessToken: string | undefined;
let sessionFresh = false;
let memorySession: StoredSession | null = null;
const submitted = new Set<string>();

// The send on leaving the page cannot wait to ask for the token, so it is kept as it changes.
supabase.auth.onAuthStateChange((_event, s) => {
  accessToken = s?.access_token;
});

/**
 * The session id, kept in localStorage so a reload or another tab carries on the same session until 30 minutes pass
 * with nothing recorded. Falls back to one per page load when storage is blocked.
 */
function session() {
  let stored: StoredSession | null = null;
  try {
    stored = parseSession(localStorage.getItem(SESSION_KEY));
  } catch {
    // Blocked storage: the in-memory copy below is used.
  }
  const next = nextSession(stored ?? memorySession, Date.now(), () => crypto.randomUUID());
  memorySession = next.session;
  if (next.fresh) sessionFresh = true;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(next.session));
  } catch {
    // Blocked storage.
  }
  return next.session.id;
}

/** True once after a new session began (first open, or after 30 idle minutes), so the caller counts one app open per session, not one per page load. */
export function takeFreshSession(): boolean {
  session();
  const fresh = sessionFresh;
  sessionFresh = false;
  return fresh;
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
  queue.push({ name, props: cleanProps(guardProps(name, props as Record<string, unknown>)), screen: on ?? (screen || undefined) });
  session(); // keeps the idle clock honest
  if (queue.length >= BATCH) void flush();
  else timer ??= setTimeout(() => void flush(), FLUSH_MS);
}

/** Sends what is waiting. `leaving` is for the tab going to the background or closing: a plain request can be cancelled then, a keepalive one is finished by the browser. */
export async function flush(leaving = false) {
  clearTimeout(timer);
  timer = undefined;
  if (queue.length === 0) return;
  const events = queue.splice(0, PER_CALL).map((e) => ({ name: e.name, props: e.props, ...(e.screen ? { screen: e.screen } : {}) }));
  const body = { p_session: session(), p_screen: screen, p_size: sizeOf(window.innerWidth), p_version: VERSION, p_events: events };
  try {
    if (leaving && accessToken) {
      await fetch(RPC_URL, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });
    } else await supabase.rpc("track", body);
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
