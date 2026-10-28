// The sealed-file columns of attachments (team_path, sealed, not_kept) come with migrations 20261102400000 and
// 20261103000000. On a database without them, asking for them fails the whole query, and the inbox shows no messages,
// so the loaders leave them out there. Checked once per load of the app.

import { supabase } from "./supabase";

let present: Promise<boolean> | undefined;

function sealedFileColumns(): Promise<boolean> {
  present ??= (async () => {
    const { error } = await supabase.from("attachments").select("team_path, sealed, not_kept").limit(0);
    return error?.code !== "42703";
  })();
  return present;
}

/** A select list as it is, or without the sealed-file columns when the database does not have them yet. */
export async function withSealedColumns<T extends string>(columns: T): Promise<T> {
  if (await sealedFileColumns()) return columns;
  return columns.replace(/,\s*(team_path|sealed|not_kept)\b/g, "") as T;
}
