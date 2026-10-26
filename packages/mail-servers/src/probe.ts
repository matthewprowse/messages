import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { Candidates, ImapServer, ServerSettings, SmtpServer } from "./index";
import { publicAddress } from "./net";

// Checks a mailbox's sign-in before it is saved: an IMAP login, and SMTP authentication with nodemailer's
// verify(), which never sends anything. Each server is connected to by the public address it resolved to,
// with its name for TLS, so the certificate is still checked against the name. Nothing here logs.

/** How a check went. tls: the port speaks the other kind of encryption. certificate: TLS is right, the certificate is not. */
export type CheckResult = "ok" | "rejected" | "unreachable" | "tls" | "certificate";

const CONNECT_MS = 8_000;

const CERTIFICATE = new Set([
  "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_UNTRUSTED", "CERT_REJECTED",
]);
// TLS spoken to a plain port, or plain text to a TLS port (the server then waits for a TLS hello and no greeting comes).
const TLS_MISMATCH = new Set(["ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_PACKET_LENGTH_TOO_LONG", "EPROTO", "ETLS", "GREETING_TIMEOUT", "ClosedAfterConnectText"]);
const TLS_TEXT = /wrong version number|packet length too long|unknown protocol|ssl routines|starttls/i;

/** What a failed IMAP connect or SMTP verify means. Only codes and flags are read; the message only for TLS wording. */
export function classify(err: unknown): Exclude<CheckResult, "ok"> {
  const e = (err ?? {}) as { code?: unknown; originalCode?: unknown; authenticationFailed?: boolean; responseCode?: number; timeoutType?: unknown; message?: unknown };
  if (e.authenticationFailed || e.code === "EAUTH" || e.responseCode === 535) return "rejected";
  const codes = [e.code, e.originalCode].filter((c): c is string => typeof c === "string");
  if (codes.some((c) => CERTIFICATE.has(c))) return "certificate";
  if (codes.some((c) => TLS_MISMATCH.has(c))) return "tls";
  // nodemailer reports every timeout as ETIMEDOUT; one waiting for the greeting is a connected socket gone quiet.
  if (e.code === "ETIMEDOUT" && e.timeoutType === "GREETING") return "tls";
  if (typeof e.message === "string" && TLS_TEXT.test(e.message)) return "tls";
  return "unreachable";
}

/** Signs in to an IMAP server and logs out. */
export async function checkImap(server: ImapServer, username: string, password: string): Promise<CheckResult> {
  const address = await publicAddress(server.host);
  if (!address) return "unreachable";
  const probe = new ImapFlow({
    host: address,
    servername: server.host,
    port: server.port,
    secure: server.tls === "tls",
    ...(server.tls === "starttls" ? { doSTARTTLS: true } : {}),
    auth: { user: username, pass: password },
    logger: false,
    connectionTimeout: CONNECT_MS,
    greetingTimeout: CONNECT_MS,
    socketTimeout: 30_000,
  });
  probe.on("error", () => undefined); // a late socket error after the result is known
  try {
    await probe.connect();
    await probe.logout().catch(() => undefined);
    return "ok";
  } catch (err) {
    probe.close();
    return classify(err);
  }
}

/** Connects to an SMTP server and authenticates, with nodemailer's verify(). Nothing is sent. */
export async function checkSmtp(server: SmtpServer, username: string, password: string): Promise<CheckResult> {
  const address = await publicAddress(server.host);
  if (!address) return "unreachable";
  const transport = nodemailer.createTransport({
    host: address,
    servername: server.host,
    port: server.port,
    secure: server.security === "ssl",
    requireTLS: server.security === "starttls",
    tls: { servername: server.host },
    auth: { user: username, pass: password },
    connectionTimeout: CONNECT_MS,
    greetingTimeout: CONNECT_MS,
    socketTimeout: 30_000,
    logger: false,
  });
  try {
    await transport.verify();
    return "ok";
  } catch (err) {
    return classify(err);
  } finally {
    transport.close();
  }
}

export interface ProbeFailure {
  /** Which side failed: signing in to read, or to send. */
  side: "imap" | "smtp";
  result: Exclude<CheckResult, "ok">;
  server: ImapServer | SmtpServer;
}

// When every server failed, the most telling failure is reported: a certificate or TLS problem says more than "unreachable".
const RANK: Record<Exclude<CheckResult, "ok">, number> = { rejected: 3, certificate: 2, tls: 1, unreachable: 0 };

type Check<S> = (server: S, username: string, password: string) => Promise<CheckResult>;

/** Tries servers in order until one signs in. A rejected password stops it: trying it elsewhere risks a lockout. */
async function firstWorking<S extends ImapServer | SmtpServer>(
  servers: S[],
  check: Check<S>,
  username: string,
  password: string,
  side: "imap" | "smtp",
): Promise<{ server: S } | { failure: ProbeFailure }> {
  let worst: ProbeFailure | null = null;
  for (const server of servers) {
    const result = await check(server, username, password);
    if (result === "ok") return { server };
    if (!worst || RANK[result] > RANK[worst.result]) worst = { side, result, server };
    if (result === "rejected") break;
  }
  return { failure: worst! };
}

export interface Checks {
  imap: Check<ImapServer>;
  smtp: Check<SmtpServer>;
}

/** The first IMAP server and the first SMTP server that accept this sign-in, or why none did. */
export async function findWorking(c: Candidates, password: string, checks: Checks = { imap: checkImap, smtp: checkSmtp }): Promise<{ settings: ServerSettings } | { failure: ProbeFailure }> {
  if (c.imap.length === 0 || c.smtp.length === 0) return { failure: { side: c.imap.length === 0 ? "imap" : "smtp", result: "unreachable", server: c.imap[0] ?? c.smtp[0] } };
  const incoming = await firstWorking(c.imap, checks.imap, c.username, password, "imap");
  if ("failure" in incoming) return incoming;
  const outgoing = await firstWorking(c.smtp, checks.smtp, c.username, password, "smtp");
  if ("failure" in outgoing) return outgoing;
  return { settings: { imap: incoming.server, smtp: outgoing.server, username: c.username } };
}

const encryption = (server: ImapServer | SmtpServer) => ("tls" in server ? (server.tls === "tls" ? "SSL" : "STARTTLS") : server.security === "ssl" ? "SSL" : "STARTTLS");

/** What went wrong, for the person connecting. hint: the provider's own advice, added to a rejected password. */
export function failureText(failure: ProbeFailure, hint?: string): string {
  const { side, result, server } = failure;
  const { host, port } = server;
  if (result === "rejected") {
    const text = side === "imap"
      ? `${host} did not accept that email and password. Check them and try again.`
      : `Signed in to read mail, but ${host} did not accept the same email and password for sending.`;
    return hint ? `${text} ${hint}` : text;
  }
  if (result === "certificate") {
    return `The security certificate on ${host} is not valid for that name. Use the server name your email host gives you, which can differ from mail.yourdomain.`;
  }
  if (result === "tls") {
    const ports = side === "imap" ? "Port 993 uses SSL and port 143 uses STARTTLS." : "Port 465 uses SSL and port 587 uses STARTTLS.";
    return `${host} did not answer with ${encryption(server)} on port ${port}. ${ports}`;
  }
  return `Could not reach ${host} on port ${port}. Check the server name and port, or try again in a moment.`;
}
