// The pure parts of talking to OneDrive: the sign-in address with PKCE, the options the File Picker v8 is opened with,
// and reading the picker's messages. No window or network here (onedrive.ts does the I/O), so it is tested alone.

export const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
/** Read-only access to the user's files, asked for when they first choose OneDrive (incremental consent). */
export const GRAPH_FILES_SCOPE = "https://graph.microsoft.com/Files.Read";

/** A URL-safe base64 string from bytes, as PKCE wants. */
export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The sign-in address for one scope, with a PKCE challenge. The page that receives the code is `redirectUri`. */
export function authorizeUrl(o: { clientId: string; redirectUri: string; scope: string; state: string; challenge: string }): string {
  const url = new URL(`${AUTHORITY}/authorize`);
  url.searchParams.set("client_id", o.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", o.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", o.scope);
  url.searchParams.set("state", o.state);
  url.searchParams.set("code_challenge", o.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** The form body that swaps the code for an access token. */
export function tokenBody(o: { clientId: string; redirectUri: string; scope: string; code: string; verifier: string }): URLSearchParams {
  return new URLSearchParams({ client_id: o.clientId, grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier, scope: o.scope });
}

/** What the picker asks the app to sign in for: its own resource (SharePoint) or Microsoft Graph. */
export function scopeFor(command: { resource?: string; type?: string }): string {
  if (command.type === "SharePoint" && command.resource) return `${command.resource.replace(/\/+$/, "")}/.default`;
  return GRAPH_FILES_SCOPE;
}

/** The options the picker is opened with: files only, any number, talking over a channel on this page's origin. */
export function pickerOptions(origin: string, channelId: string) {
  return {
    sdk: "8.0",
    entry: { oneDrive: { files: {} } },
    authentication: {},
    messaging: { origin, channelId },
    selection: { mode: "multiple", enablePersistence: false },
    typesAndSources: { mode: "files", pivots: { oneDrive: true, recent: true } },
    search: { enabled: true },
  };
}

/** A message from the picker on the channel, reduced to what the app acts on. */
export type PickerMessage =
  | { kind: "page-loaded" }
  | { kind: "authenticate"; id: string; scope: string }
  | { kind: "pick"; id: string; items: unknown[] }
  | { kind: "close"; id: string }
  | { kind: "other" };

/** Reads one picker message; anything unexpected is "other" and ignored. */
export function readPickerMessage(msg: unknown): PickerMessage {
  const m = msg as { type?: string; id?: string; data?: { notification?: string; command?: string; resource?: string; type?: string; items?: unknown[] } } | null;
  if (!m || typeof m !== "object") return { kind: "other" };
  if (m.type === "notification") return m.data?.notification === "page-loaded" ? { kind: "page-loaded" } : { kind: "other" };
  if (m.type !== "command" || typeof m.id !== "string") return { kind: "other" };
  const cmd = m.data?.command;
  if (cmd === "authenticate") return { kind: "authenticate", id: m.id, scope: scopeFor(m.data ?? {}) };
  if (cmd === "pick") return { kind: "pick", id: m.id, items: Array.isArray(m.data?.items) ? m.data.items : [] };
  if (cmd === "close") return { kind: "close", id: m.id };
  return { kind: "other" };
}
