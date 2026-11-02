// Choosing files from Google Drive in the browser: Google Identity Services asks for the non-restricted drive.file scope
// when the user first picks (incremental consent, nothing is asked at connect time), then Google's Picker shows Drive and
// grants this app access to only the files chosen. The bytes are fetched with the same token (download.ts).
// Untestable without Google, so the logic that can be is in pick-map.ts.

import type { CloudConfig } from "./config";
import { mapGoogleDoc, partitionPicks, type CloudPick, type GoogleDoc } from "./pick-map";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** What a picker run gives back: the files to download, the token to download them with, and what could not be used. */
export interface PickResult {
  picks: CloudPick[];
  token: string;
  errors: string[];
}

// Google's two scripts are loaded once, when first needed, so users who never use Drive never contact Google.
const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { scripts.delete(src); reject(new Error("script")); };
      document.head.append(el);
    });
    scripts.set(src, p);
  }
  return p;
}

// Only the parts of Google's globals this file calls.
type Google = {
  accounts: { oauth2: { initTokenClient(o: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string }) => void; error_callback?: () => void }): { requestAccessToken(): void } } };
  picker: {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new (id?: string) => { setIncludeFolders(on: boolean): unknown; setSelectFolderEnabled(on: boolean): unknown };
    ViewId: { DOCS: string };
    Feature: { MULTISELECT_ENABLED: string };
    Action: { PICKED: string; CANCEL: string };
  };
};
type PickerBuilder = {
  addView(v: unknown): PickerBuilder; setOAuthToken(t: string): PickerBuilder; setDeveloperKey(k: string): PickerBuilder; setAppId(id: string): PickerBuilder;
  enableFeature(f: string): PickerBuilder; setCallback(cb: (data: { action: string; docs?: GoogleDoc[] }) => void): PickerBuilder; build(): { setVisible(on: boolean): void };
};
const google = () => (window as unknown as { google: Google }).google;

function accessToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    google().accounts.oauth2
      .initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error || "denied"))),
        error_callback: () => reject(new Error("closed")),
      })
      .requestAccessToken();
  });
}

/**
 * Opens Google Drive's file chooser. Resolves to null when the person closes it without choosing, and rejects when
 * Google could not be reached or access was refused (the caller shows a plain sentence).
 */
export async function pickFromGoogleDrive(config: NonNullable<CloudConfig["google"]>): Promise<PickResult | null> {
  await Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]);
  await new Promise<void>((resolve) => (window as unknown as { gapi: { load(n: string, cb: () => void): void } }).gapi.load("picker", resolve));
  const token = await accessToken(config.clientId);
  const g = google().picker;
  const view = new g.DocsView(g.ViewId.DOCS);
  view.setIncludeFolders(true);
  view.setSelectFolderEnabled(false);
  return new Promise((resolve) => {
    const picker = new g.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .setCallback((data) => {
        if (data.action === g.Action.CANCEL) resolve(null);
        if (data.action !== g.Action.PICKED) return;
        const { picks, errors } = partitionPicks((data.docs ?? []).map(mapGoogleDoc));
        resolve({ picks, token, errors });
      })
      .build();
    picker.setVisible(true);
  });
}
