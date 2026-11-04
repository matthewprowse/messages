// The LinkedIn helper (apps/linkedin): a separate Go program, under the AGPL, that speaks to LinkedIn for one
// account through mautrix-linkedin's linkedingo. The worker runs one per account and talks to it with JSON
// lines over stdin and stdout; apps/linkedin/README.md is the protocol. Nothing of Konva is linked into it,
// and nothing it writes is logged here: its stderr is not even read.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { isPublicAddress, publicAddress } from "@messages/mail-servers/net";

export interface LinkedInPerson {
  /** The last part of the URN: a member's profile ID, or a company's. */
  id: string;
  /** urn:li:fsd_profile:<id> for a member, the company's URN for a page. The contact identity. */
  urn: string;
  kind: "member" | "organization";
  firstName?: string;
  lastName?: string;
  name?: string;
  headline?: string;
  /** The address of the largest profile picture (or a page's logo): signed, expiring, fetched with the picture command and never logged. */
  picture?: string;
}

export interface LinkedInFile {
  name: string;
  mediaType: string;
  size?: number;
}

export interface LinkedInMessage {
  urn: string;
  conversationUrn: string;
  sender?: LinkedInPerson;
  /** Unix milliseconds. */
  deliveredAt: number;
  text: string;
  format?: "DEFAULT" | "EDITED" | "RECALLED" | "SYSTEM" | string;
  files?: LinkedInFile[];
}

export interface LinkedInConversation {
  urn: string;
  title?: string;
  group: boolean;
  read: boolean;
  lastActivityAt: number;
  lastReadAt?: number;
  /** Such as INBOX, ARCHIVE and SPAM. */
  categories?: string[];
  /** Everyone in it, you included. */
  participants: LinkedInPerson[];
  messages?: LinkedInMessage[];
}

export type ErrorKind =
  | "bad_credentials" | "rate_limited" | "refused" | "forbidden" | "bad_request" | "failed"
  // A new conversation adds these: nobody matched the profile, or several people did. Nothing was sent.
  | "not_found" | "ambiguous"
  // A sign-in adds these: not accepted, turned away, a check that cannot be completed, unreachable, a sign-in
  // page the library no longer understands, and an approval wait that another command ended.
  // A send of several files stopped after some went out (error.sent).
  | "partial"
  | "rejected" | "blocked" | "challenge" | "unavailable" | "unsupported" | "cancelled";

/** What the helper reports, never what LinkedIn said. code is the kind, for errorCode() in logs. */
export class HelperError extends Error {
  readonly code: string;
  constructor(readonly kind: ErrorKind | "exited" | "timeout", readonly status?: number, readonly stage?: string, readonly sent?: number) {
    super(`linkedin helper: ${kind}`);
    this.code = kind;
  }
}

export type HelperEvent =
  | { event: "ready" }
  | { event: "connected" }
  | { event: "heartbeat" }
  | { event: "reconnecting" }
  | { event: "message"; message: LinkedInMessage }
  | { event: "conversation"; conversation: LinkedInConversation }
  /** Someone (by their profile ID) has seen a conversation up to a time, Unix milliseconds. It can be you, on another device. */
  | { event: "seen"; conversationUrn: string; by: string; at: number }
  | { event: "bad_credentials"; error?: { kind: ErrorKind } }
  | { event: "failed"; error?: { kind: ErrorKind; status?: number } };

export interface LoginArgs {
  cookies: string;
  /** The browser headers (User-Agent and its companions) the cookies were created with, from a password sign-in. */
  headers?: BrowserHeaders;
  xLiTrack?: string;
  pageInstance?: string;
  syncToken?: string;
}

/** Header name to values, as Go's http.Header. */
export type BrowserHeaders = Record<string, string[]>;

/** Where a password sign-in stands: done with a session, or waiting for a code or an approval in the LinkedIn app. */
export type SignInResult =
  | { state: "done"; cookies: string; headers: BrowserHeaders }
  | { state: "code"; method: "email" | "sms" | "totp"; /** The last code was wrong. */ rejected?: boolean }
  | { state: "app"; canTryAnotherWay: boolean };

/**
 * A file for send and start: written by the worker under the temp folder (the helper runs on the same machine
 * and refuses any path outside it). image and video choose LinkedIn's upload type; everything else is file.
 */
export interface HelperAttachment {
  path: string;
  name: string;
  mime: string;
  kind: "image" | "video" | "file";
}

/** Each command's arguments and result. */
export interface Commands {
  signin: { args: { email: string; password: string; proxy?: string }; result: SignInResult };
  code: { args: { code: string }; result: SignInResult };
  app: { args: Record<string, never>; result: SignInResult };
  another_way: { args: Record<string, never>; result: SignInResult };
  login: { args: LoginArgs; result: { me: LinkedInPerson } };
  conversations: { args: { before?: number }; result: { conversations: LinkedInConversation[] } };
  changes: { args: Record<string, never>; result: { conversations: LinkedInConversation[]; deleted: string[]; syncToken: string } };
  messages: { args: { conversation: string; before?: number; count?: number }; result: { messages: LinkedInMessage[] } };
  /** With attachments the text may be empty. Each file is a message of its own (messages), the text with the first. */
  send: { args: { conversation: string; text: string; token: string; attachments?: HelperAttachment[]; attachmentDir?: string }; result: { message: LinkedInMessage; messages?: LinkedInMessage[] } };
  /** With attachments the text may be empty. The first file opens the conversation; the others are in conversation.messages. */
  start: { args: { profile: string; text: string; token: string; attachments?: HelperAttachment[]; attachmentDir?: string }; result: { conversation: LinkedInConversation; message: LinkedInMessage } };
  /** A person's picture, fetched by the helper (through the account's proxy, from LinkedIn's image servers only). */
  picture: { args: { url: string }; result: { data: string; type: string } };
  read: { args: { conversation: string }; result: Record<string, never> };
  /** Puts your emoji reaction on a message, or takes it off (remove, with an empty emoji). Both IDs are URNs. See linkedin/reactions.ts. */
  react: { args: { conversation: string; message: string; emoji: string; remove: boolean }; result: Record<string, never> };
  connect: { args: Record<string, never>; result: Record<string, never> };
  cookies: { args: Record<string, never>; result: { cookies: string } };
  stop: { args: Record<string, never>; result: Record<string, never> };
}

/** Lines in and out of a helper process, or of a stand-in in tests. */
export interface Transport {
  write(line: string): void;
  onLine(listener: (line: string) => void): void;
  onExit(listener: () => void): void;
  close(): void;
}

const CALL_TIMEOUT_MS = 90_000; // linkedingo retries a failing request a few times, with waits, before it answers

/** One helper process: commands matched to their answers by id, and events passed on as they come. */
export class Helper {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private exited = false;

  constructor(private readonly transport: Transport, private readonly onEvent: (event: HelperEvent) => void) {
    transport.onLine((line) => this.receive(line));
    transport.onExit(() => {
      this.exited = true;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new HelperError("exited"));
        this.pending.delete(id);
      }
      this.onEvent({ event: "failed", error: { kind: "failed" } });
    });
  }

  get alive() {
    return !this.exited;
  }

  call<C extends keyof Commands>(cmd: C, args?: Commands[C]["args"], timeoutMs = CALL_TIMEOUT_MS): Promise<Commands[C]["result"]> {
    if (this.exited) return Promise.reject(new HelperError("exited"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HelperError("timeout"));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.transport.write(JSON.stringify(args === undefined ? { id, cmd } : { id, cmd, args }));
    });
  }

  /** Ends the session: stop if it still answers, then the process goes either way. */
  async stop() {
    if (!this.exited) await this.call("stop", undefined, 5_000).catch(() => undefined);
    this.transport.close();
  }

  private receive(line: string) {
    let msg: { id?: number; ok?: boolean; result?: unknown; error?: { kind: ErrorKind; status?: number; stage?: string; sent?: number }; event?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // not a protocol line
    }
    if (typeof msg.event === "string") {
      this.onEvent(msg as HelperEvent);
      return;
    }
    const pending = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
    if (!pending) return;
    this.pending.delete(msg.id!);
    clearTimeout(pending.timer);
    if (msg.ok) pending.resolve(msg.result ?? {});
    else pending.reject(new HelperError(msg.error?.kind ?? "failed", msg.error?.status, msg.error?.stage, msg.error?.sent));
  }
}

/** Where the built helper is: LINKEDIN_HELPER, else apps/linkedin/bin/konva-linkedin. */
export function helperPath(): string {
  return process.env.LINKEDIN_HELPER || fileURLToPath(new URL("../../../linkedin/bin/konva-linkedin", import.meta.url));
}

export function helperBuilt(path = helperPath()): boolean {
  return existsSync(path);
}

/** What the helper (a Go program) may see: the basics it needs to run and verify TLS. Nothing else, so a bug or a bad dependency in it cannot read the service-role key or the encryption keys. Proxy variables are set per helper, never inherited. */
const HELPER_ENV_ALLOW = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "TZ", "LANG", "LANGUAGE", "SSL_CERT_FILE", "SSL_CERT_DIR", "SYSTEMROOT"];
/** The allow-listed part of an environment, plus any LC_* locale variable. */
export function allowedEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && (HELPER_ENV_ALLOW.includes(name) || name.startsWith("LC_"))) env[name] = value;
  }
  return env;
}

/**
 * The environment a helper runs in. With a proxy, every request the helper makes goes through it: linkedingo
 * reads the standard proxy variables, once, when it starts, so this is per helper and so per account.
 */
export function helperEnv(proxy?: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = allowedEnv(base);
  if (proxy?.trim()) {
    env.HTTPS_PROXY = proxy.trim();
    env.HTTP_PROXY = proxy.trim();
  }
  return env;
}

/**
 * The proxy to hand the helper, checked at connect time: its host must be a public address or a name that
 * resolves only to public addresses (127.0.0.1.nip.io does not). For http and socks5 proxies the resolved
 * address replaces the name, so a second lookup cannot swap it; an https proxy keeps its name for the
 * certificate check. Null when the proxy may not be used.
 */
export async function vettedProxy(proxy: string, resolve: (host: string) => Promise<string | null> = publicAddress): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(proxy.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPublicAddress(host) ? url.toString().replace(/\/$/, "") : null;
  const address = await resolve(host);
  if (!address) return null;
  if (url.protocol === "https:") return url.toString().replace(/\/$/, "");
  url.hostname = isIP(address) === 6 ? `[${address}]` : address;
  return url.toString().replace(/\/$/, "");
}

/**
 * Starts the helper as a child process. Its stderr is discarded, so nothing it might print is kept. With a
 * proxy, the proxy is vetted first (see vettedProxy); lines written meanwhile are held, and a proxy that fails
 * the check ends the transport as if the helper had exited, so nothing connects through it.
 */
export function spawnTransport(path = helperPath(), proxy?: string, vet = vettedProxy): Transport {
  let child: ReturnType<typeof spawn> | null = null;
  let lines: ReturnType<typeof createInterface> | null = null;
  let exited = false;
  let closed = false;
  const queued: string[] = [];
  const lineListeners: ((line: string) => void)[] = [];
  const exitListeners: (() => void)[] = [];
  const exit = () => {
    if (exited) return;
    exited = true;
    for (const l of exitListeners) l();
  };
  const start = (checked: string | undefined) => {
    if (closed) return exit();
    const c = spawn(path, [], { stdio: ["pipe", "pipe", "ignore"], env: helperEnv(checked) });
    child = c;
    lines = createInterface({ input: c.stdout });
    for (const l of lineListeners) lines.on("line", l);
    c.on("exit", exit);
    c.on("error", exit);
    c.stdin.on("error", () => undefined); // a write after the process died
    for (const line of queued.splice(0)) c.stdin.write(line + "\n");
  };
  if (proxy?.trim()) {
    void vet(proxy).then((checked) => (checked ? start(checked) : exit()), () => exit());
  } else {
    start(undefined);
  }
  return {
    write: (line) => {
      if (exited) return;
      if (child) child.stdin?.write(line + "\n");
      else queued.push(line);
    },
    onLine: (listener) => {
      lineListeners.push(listener);
      lines?.on("line", listener);
    },
    onExit: (listener) => void exitListeners.push(listener),
    close: () => {
      closed = true;
      child?.stdin?.end();
      const c = child;
      setTimeout(() => {
        if (!exited) c?.kill();
      }, 3_000).unref();
    },
  };
}
