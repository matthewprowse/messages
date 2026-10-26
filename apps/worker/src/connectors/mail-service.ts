import type { ImapFlowOptions } from "imapflow";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { ICLOUD, type ImapServer, type SmtpServer } from "@messages/mail-servers";
import { publicAddress } from "@messages/mail-servers/net";
import type { AttachmentProvider } from "../send/attachment-rules";

// What the IMAP connector (./imap.ts) needs to know about a service: where its servers are, and how it is
// named to you. iCloud's servers are the same for everyone; any other mailbox has its own, saved with its
// password. No database here, so it can be unit tested.

/** The sign-in every IMAP mailbox has. */
export interface MailCredentials {
  /** The sign-in name, usually the email address. */
  username: string;
  password: string;
  /** Other addresses you send from, so your own messages are recognised as outbound. */
  aliases?: string[];
}

export interface ICloudCredentials extends MailCredentials {
  /** The iCloud Mail sign-in address, usually ...@icloud.com. */
  username: string;
  /** An app-specific password from account.apple.com. */
  password: string;
}

/** A mailbox at any host, with its servers as worked out and checked when it was connected (apps/web/app/api/connect/imap). */
export interface ImapCredentials extends MailCredentials {
  imap: ImapServer;
  smtp: SmtpServer;
}

export interface MailService<C extends MailCredentials> {
  /** In log lines: "icloud" or "imap". */
  tag: string;
  /** The service at the start of a sentence: "iCloud", or "Your mail server". */
  name: string;
  /** The same, mid-sentence: "iCloud", or "your mail server". */
  object: string;
  /** What it calls the password: "app-specific password", or "password". */
  password: string;
  /** What the Trash folder is called, for the reason a delete could not be applied. */
  trashName: string;
  /** The account's status when the server rejects the sign-in. */
  rejected(creds: C): string;
  /** Whose attachment limits apply. */
  attachments: AttachmentProvider;
  imap(creds: C): Promise<ImapFlowOptions>;
  smtp(creds: C): Promise<SMTPTransport.Options>;
}

/** ImapFlow's options for a server: TLS from the start, or STARTTLS required (never plain text). */
export function imapOptions(server: ImapServer) {
  return server.tls === "tls"
    ? { host: server.host, port: server.port, secure: true }
    : { host: server.host, port: server.port, secure: false, doSTARTTLS: true };
}

/** nodemailer's options for a server: SSL from the start, or STARTTLS required (never plain text). */
export function smtpOptions(server: SmtpServer) {
  return server.security === "ssl"
    ? { host: server.host, port: server.port, secure: true }
    : { host: server.host, port: server.port, secure: false, requireTLS: true };
}

const icloud = ICLOUD.servers("icloud.com");

/** iCloud Mail's IMAP server. The setup and one-off scripts connect with the same settings. */
export const ICLOUD_IMAP = imapOptions(icloud.imap[0]);
/** iCloud Mail's SMTP server: STARTTLS on 587. */
export const ICLOUD_SMTP = smtpOptions(icloud.smtp[0]);

export const ICLOUD_SERVICE: MailService<ICloudCredentials> = {
  tag: "icloud",
  name: "iCloud",
  object: "iCloud",
  password: "app-specific password",
  trashName: "Deleted Messages",
  rejected: () => "iCloud rejected the app-specific password. Create a new one and reconnect.",
  attachments: "icloud",
  imap: async () => ICLOUD_IMAP,
  smtp: async () => ICLOUD_SMTP,
};

/**
 * Where to connect for a server someone typed in: its public address, with its name for TLS, so the
 * certificate is still checked against the name. A host on a private network is never connected to.
 */
export async function pinned(host: string, resolve = publicAddress): Promise<{ host: string; servername: string }> {
  const address = await resolve(host);
  if (!address) throw Object.assign(new Error("host not public"), { code: "HOST_NOT_PUBLIC" });
  return { host: address, servername: host };
}

/** A mailbox at any host, with the servers saved when it was connected. */
export const IMAP_SERVICE: MailService<ImapCredentials> = {
  tag: "imap",
  name: "Your mail server",
  object: "your mail server",
  password: "password",
  trashName: "Trash",
  rejected: (creds) => `${creds.imap.host} rejected the password. Check it, then reconnect in Settings.`,
  attachments: "imap",
  imap: async (creds) => ({ ...imapOptions(creds.imap), ...(await pinned(creds.imap.host)) }),
  smtp: async (creds) => {
    const at = await pinned(creds.smtp.host);
    return { ...smtpOptions(creds.smtp), ...at, tls: { servername: at.servername } };
  },
};
