// Pure reading of storage paths: which files are notes, which are a team's copy, and which field they were sealed under.
// No network or keys, so it is tested alone.

import { FIELD } from "@messages/crypto/fields";

/** A note file's path is "<user id>/notes/<note id>/<uuid>". */
export function isNotePath(path: string | undefined): path is string {
  return !!path && path.split("/")[1] === "notes";
}

/** The field a stored object was sealed under: note files by the browser, everything else by the workers. */
export function sealedField(path: string) {
  return isNotePath(path) ? FIELD.noteFileData : FIELD.attachmentData;
}

/** A shared chat's file as the team keeps it: "team/<workspace id>/<attachment id>", sealed with the team's key. */
export function isTeamFilePath(path: string | undefined): path is string {
  return !!path && path.startsWith("team/");
}
