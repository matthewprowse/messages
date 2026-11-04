// Pure reading of storage paths: which files are notes or outgoing files, which are a team's copy, and which field they
// were sealed under.
// No network or keys, so it is tested alone.

import { FIELD } from "@messages/crypto/fields";

/** A note file's path is "<user id>/notes/<note id>/<uuid>". */
export function isNotePath(path: string | undefined): path is string {
  return !!path && path.split("/")[1] === "notes";
}

/** A file attached to a message you send: "<user id>/outbox/<uuid>/file" (or a real name, before sealing began). */
export function isOutboxPath(path: string | undefined): path is string {
  return !!path && path.split("/")[1] === "outbox";
}

/** A file the browser sealed before upload (a note's or an outgoing message's): opened whole here, never resized by Storage. */
export function isBrowserSealedPath(path: string | undefined): path is string {
  return isNotePath(path) || isOutboxPath(path);
}

/** The field a stored object was sealed under: note and outgoing files by the browser, everything else by the workers. */
export function sealedField(path: string) {
  if (isNotePath(path)) return FIELD.noteFileData;
  return isOutboxPath(path) ? FIELD.outboxFileData : FIELD.attachmentData;
}

/** A shared chat's file as the team keeps it: "team/<workspace id>/<attachment id>", sealed with the team's key. */
export function isTeamFilePath(path: string | undefined): path is string {
  return !!path && path.startsWith("team/");
}
