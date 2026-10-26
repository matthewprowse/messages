import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// The LinkedIn helper (apps/linkedin): a separate Go program, under the AGPL, that speaks to LinkedIn for one
// account through mautrix-linkedin's linkedingo. The worker runs one per account and talks to it with JSON
// lines over stdin and stdout; apps/linkedin/README.md is the protocol. Nothing of Konva is linked into it,
// and nothing it writes is logged here: its stderr is not even read.

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

export type ErrorKind = "bad_credentials" | "rate_limited" | "refused" | "forbidden" | "bad_request" | "failed";

/** What the helper reports, never what LinkedIn said. code is the kind, for errorCode() in logs. */
export class HelperError extends Error {
  readonly code: string;
  constructor(readonly kind: ErrorKind | "exited" | "timeout", readonly status?: number) {
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
  | { event: "bad_credentials"; error?: { kind: ErrorKind } }
  | { event: "failed"; error?: { kind: ErrorKind; status?: number } };

export interface LoginArgs {
  cookies: string;
  xLiTrack?: string;
  pageInstance?: string;
  syncToken?: string;
}

/** Each command's arguments and result. */
export interface Commands {
  login: { args: LoginArgs; result: { me: LinkedInPerson } };
  conversations: { args: { before?: number }; result: { conversations: LinkedInConversation[] } };
  changes: { args: Record<string, never>; result: { conversations: LinkedInConversation[]; deleted: string[]; syncToken: string } };
  messages: { args: { conversation: string; before?: number; count?: number }; result: { messages: LinkedInMessage[] } };
  send: { args: { conversation: string; text: string; token: string }; result: { message: LinkedInMessage } };
  read: { args: { conversation: string }; result: Record<string, never> };
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
    let msg: { id?: number; ok?: boolean; result?: unknown; error?: { kind: ErrorKind; status?: number }; event?: string };
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
    else pending.reject(new HelperError(msg.error?.kind ?? "failed", msg.error?.status));
  }
}

/** Where the built helper is: LINKEDIN_HELPER, else apps/linkedin/bin/konva-linkedin. */
export function helperPath(): string {
  return process.env.LINKEDIN_HELPER || fileURLToPath(new URL("../../../linkedin/bin/konva-linkedin", import.meta.url));
}

export function helperBuilt(path = helperPath()): boolean {
  return existsSync(path);
}

/** Starts the helper as a child process. Its stderr is discarded, so nothing it might print is kept. */
export function spawnTransport(path = helperPath()): Transport {
  const child = spawn(path, [], { stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout });
  let exited = false;
  const exitListeners: (() => void)[] = [];
  const exit = () => {
    if (exited) return;
    exited = true;
    for (const l of exitListeners) l();
  };
  child.on("exit", exit);
  child.on("error", exit);
  child.stdin.on("error", () => undefined); // a write after the process died
  return {
    write: (line) => {
      if (!exited) child.stdin.write(line + "\n");
    },
    onLine: (listener) => void lines.on("line", listener),
    onExit: (listener) => void exitListeners.push(listener),
    close: () => {
      child.stdin.end();
      setTimeout(() => {
        if (!exited) child.kill();
      }, 3_000).unref();
    },
  };
}
