// The sealed-file columns of attachments (team_path, sealed, not_kept) come with migrations 20261102400000 and
// 20261103000000. On a database without them, asking for them fails the whole query, and the inbox shows no messages,
// so the loaders leave them out there. Checked once per load of the app.

import { supabase } from "./supabase";

let present: Promise<boolean> | undefined;
let thumbPresent: Promise<boolean> | undefined;
let shrunkPresent: Promise<boolean> | undefined;

/** messages.body_shrunk_at (old bulk mail cut down to a preview) comes with its own migration, so it is checked on its own. */
function shrunkColumn(): Promise<boolean> {
  shrunkPresent ??= (async () => {
    const { error } = await supabase.from("messages").select("body_shrunk_at").limit(0);
    return error?.code !== "42703";
  })();
  return shrunkPresent;
}

/** attachments.thumb_path (sealed thumbnails) comes with its own migration, so it is checked on its own. */
function thumbColumn(): Promise<boolean> {
  thumbPresent ??= (async () => {
    const { error } = await supabase.from("attachments").select("thumb_path").limit(0);
    return error?.code !== "42703";
  })();
  return thumbPresent;
}

function sealedFileColumns(): Promise<boolean> {
  present ??= (async () => {
    const { error } = await supabase.from("attachments").select("team_path, sealed, not_kept").limit(0);
    return error?.code !== "42703";
  })();
  return present;
}

/**
 * A select list as it is, or without the sealed-file columns when the database does not have them yet. thumb_path is added
 * after storage_path here, once the database has it, rather than named in the lists: the generated types do not know it
 * until they are regenerated, and a column they lack breaks the typed select.
 */
export async function withSealedColumns<T extends string>(columns: T): Promise<T> {
  let list: string = columns;
  if (await thumbColumn()) list = list.replace(/\bstorage_path\b(?!, thumb_path)/g, "storage_path, thumb_path");
  // The message list names is_bulk once; body_shrunk_at follows it, once the database has the column.
  if (list.includes("is_bulk") && (await shrunkColumn())) list = list.replace(/\bis_bulk\b(?!, body_shrunk_at)/, "is_bulk, body_shrunk_at");
  if (!(await sealedFileColumns())) list = list.replace(/,\s*(team_path|sealed|not_kept)\b/g, "");
  return list as T;
}
