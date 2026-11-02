// Choosing files from OneDrive in the browser with the OneDrive File Picker v8 and the existing Microsoft app
// registration. Files.Read is asked for here, when the user first picks (incremental consent): sign-in runs in a popup
// with PKCE (the callback page is app/attachments/onedrive-callback), the picker opens in the same popup and talks over
// a MessageChannel, and the bytes are fetched from Microsoft Graph with the token (download.ts).
// Untestable without Microsoft, so the logic that can be is in onedrive-protocol.ts and pick-map.ts.

import type { PickResult } from "./google";
import type { CloudConfig } from "./config";
import { AUTHORITY, authorizeUrl, base64Url, GRAPH_FILES_SCOPE, pickerOptions, readPickerMessage, tokenBody } from "./onedrive-protocol";
import { mapOneDriveItem, oneDrivePickerBase, partitionPicks, type OneDriveItem } from "./pick-map";

/** The address Microsoft sends the sign-in back to. Register it under the app's Single-page application redirect URIs. */
export const callbackUri = () => `${window.location.origin}/attachments/onedrive-callback`;

// Tokens are kept in memory only, per scope, until a minute before they expire.
const tokens = new Map<string, { value: string; expires: number }>();

function randomText(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Signs in inside `win` for one scope and resolves to an access token. */
async function signIn(clientId: string, scope: string, win: Window): Promise<string> {
  const cached = tokens.get(scope);
  if (cached && cached.expires > Date.now()) return cached.value;
  const verifier = randomText(48);
  const state = randomText(16);
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const redirectUri = callbackUri();
  win.location.href = authorizeUrl({ clientId, redirectUri, scope, state, challenge });
  const code = await new Promise<string>((resolve, reject) => {
    const done = (fn: () => void) => { window.removeEventListener("message", onMessage); clearInterval(watch); fn(); };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; code?: string; state?: string; error?: string } | null;
      if (e.origin !== window.location.origin || d?.type !== "konva-onedrive-code" || d.state !== state) return;
      done(() => (d.code ? resolve(d.code) : reject(new Error(d.error || "denied"))));
    };
    const watch = setInterval(() => { if (win.closed) done(() => reject(new Error("closed"))); }, 500);
    window.addEventListener("message", onMessage);
  });
  const res = await fetch(`${AUTHORITY}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: tokenBody({ clientId, redirectUri, scope, code, verifier }) });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) throw new Error("token");
  tokens.set(scope, { value: json.access_token, expires: Date.now() + Math.max(0, (json.expires_in ?? 3600) - 60) * 1000 });
  return json.access_token;
}

/**
 * Opens the OneDrive File Picker. Must be called straight from a click, because the popup is opened before anything is
 * awaited (browsers block popups opened later). Resolves to null when the person closes it without choosing.
 */
export async function pickFromOneDrive(config: NonNullable<CloudConfig["onedrive"]>): Promise<PickResult | null> {
  const win = window.open("", "konva-onedrive", "popup,width=1080,height=680");
  if (!win) throw new Error("popup");
  try {
    const graphToken = await signIn(config.clientId, GRAPH_FILES_SCOPE, win);
    const drive = (await fetch("https://graph.microsoft.com/v1.0/me/drive?$select=driveType,webUrl", { headers: { authorization: `Bearer ${graphToken}` } }).then((r) => (r.ok ? r.json() : {}))) as { driveType?: string; webUrl?: string };
    const base = oneDrivePickerBase(drive.driveType, drive.webUrl);
    const channelId = crypto.randomUUID();
    const options = pickerOptions(window.location.origin, channelId);

    // The picker is opened by posting a form into the popup, with the token in the body rather than the address.
    const form = document.createElement("form");
    form.method = "POST";
    form.target = win.name;
    form.action = `${base}?filePicker=${encodeURIComponent(JSON.stringify(options))}&locale=en-gb`;
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = "access_token";
    field.value = graphToken;
    form.append(field);
    document.body.append(form);
    form.submit();
    form.remove();

    const items = await new Promise<OneDriveItem[] | null>((resolve, reject) => {
      let port: MessagePort | null = null;
      const finish = (fn: () => void) => { window.removeEventListener("message", onInit); clearInterval(watch); port?.close(); fn(); };
      const onInit = (e: MessageEvent) => {
        const d = e.data as { type?: string; channelId?: string } | null;
        if (e.source !== win || d?.type !== "initialize" || d.channelId !== channelId || !e.ports[0]) return;
        port = e.ports[0];
        port.addEventListener("message", (m) => {
          const msg = readPickerMessage(m.data);
          if (msg.kind === "authenticate") {
            port!.postMessage({ type: "acknowledge", id: msg.id });
            signIn(config.clientId, msg.scope, win).then((token) => port!.postMessage({ type: "result", id: msg.id, data: { result: "token", token } })).catch(() => finish(() => reject(new Error("denied"))));
          } else if (msg.kind === "pick") {
            port!.postMessage({ type: "acknowledge", id: msg.id });
            port!.postMessage({ type: "result", id: msg.id, data: { result: "success" } });
            finish(() => resolve(msg.items as OneDriveItem[]));
          } else if (msg.kind === "close") {
            port!.postMessage({ type: "acknowledge", id: msg.id });
            finish(() => resolve(null));
          }
        });
        port.start();
        port.postMessage({ type: "activate" });
      };
      const watch = setInterval(() => { if (win.closed) finish(() => resolve(null)); }, 500);
      window.addEventListener("message", onInit);
    });
    if (!items) return null;
    const { picks, errors } = partitionPicks(items.map(mapOneDriveItem));
    return { picks, token: graphToken, errors };
  } finally {
    if (!win.closed) win.close();
  }
}
