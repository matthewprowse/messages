// Which cloud pickers this deployment has keys for. Google needs NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID, _API_KEY and
// _APP_ID (the Google Cloud project number, which drive.file needs to grant the picked files to the app); OneDrive needs
// NEXT_PUBLIC_MICROSOFT_CLIENT_ID. Without them the Attach menu simply leaves that source out. Public values only.

import type { CloudSource } from "./pick-map";

export interface CloudConfig {
  google?: { clientId: string; apiKey: string; appId: string };
  onedrive?: { clientId: string };
}

type Env = Record<string, string | undefined>;

/** The configured sources from an environment (passed in so it can be tested; next inlines each NEXT_PUBLIC_ name). */
export function cloudConfigFrom(env: Env): CloudConfig {
  const clean = (v: string | undefined) => v?.trim() || undefined;
  const clientId = clean(env.NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID);
  const apiKey = clean(env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY);
  const appId = clean(env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID);
  const microsoft = clean(env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID);
  return {
    google: clientId && apiKey && appId ? { clientId, apiKey, appId } : undefined,
    onedrive: microsoft ? { clientId: microsoft } : undefined,
  };
}

/** The config for this build. Each variable is written out in full so Next can inline it in the browser bundle. */
export const cloudConfig: CloudConfig = cloudConfigFrom({
  NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID,
  NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
  NEXT_PUBLIC_GOOGLE_PICKER_APP_ID: process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID,
  NEXT_PUBLIC_MICROSOFT_CLIENT_ID: process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID,
});

/** The sources to list in the Attach menu, in order. */
export function availableSources(config: CloudConfig = cloudConfig): CloudSource[] {
  return [config.google ? "google" : null, config.onedrive ? "onedrive" : null].filter((s): s is CloudSource => !!s);
}

export const SOURCE_LABEL: Record<CloudSource, string> = { google: "Google Drive", onedrive: "OneDrive" };

/** The line about iCloud Drive, which has no web API: the system file picker already lists it on Apple devices. */
export const ICLOUD_NOTE = "On Apple devices, This Device already includes iCloud Drive.";
