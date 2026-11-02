// Downloads a picked cloud file into a File in the browser, so it goes through exactly the same checks, sealing and
// upload as a file chosen on the device. The token is the one the picker run was given; nothing is stored.

import { downloadProblem, type CloudPick } from "./pick-map";

/** Fetches one pick as a File. Throws an Error whose message is a sentence fit to show. */
export async function downloadPick(pick: CloudPick, token: string): Promise<File> {
  let res: Response;
  try {
    res = await fetch(pick.url, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new Error(`${pick.name} did not download. Check your connection and try again.`);
  }
  if (!res.ok) throw new Error(downloadProblem(pick, res.status));
  const blob = await res.blob();
  return new File([blob], pick.name, { type: pick.mimeType, lastModified: Date.now() });
}
