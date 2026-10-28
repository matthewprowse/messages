// The files and file names of a shared chat. The name moves between the keys like any other text. The bytes of a sealed
// file are copied: a second object sealed with the team's current key (team/<workspace>/<attachment id>), next to the
// agent's own, which stays as it is. attachments.team_path says where the copy is and team_key_version which version of
// the team's key sealed it, so rotate.ts can seal it again when a member leaves. Moving the chat back deletes the copy.
// A file stored unsealed (encryption off) has no copy: the team reads it where it is.

import { decryptBytes, decryptTeamBytes, encryptTeamBytes, isSealedBytes, type TeamKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { Changes, moveValue, type Keys, type Move, type RowWrite } from "./reseal";

/** What the share job reads of an attachment row. */
export interface AttachmentRow {
  id: string;
  workspace_id: string | null;
  filename?: string | null;
  sealed?: boolean;
  storage_path?: string | null;
  team_path?: string | null;
  team_key_version?: number | null;
}

/** Where a workspace's copy of a file is kept (the attachments bucket, outside every user's own folder). */
export const teamFilePath = (workspaceId: string, attachmentId: string) => `team/${workspaceId}/${attachmentId}`;

/** What copying a file needs of storage and of the team's keys (supabaseFiles below; the tests use a fake). */
export interface ShareFiles {
  /** The team's current key and its version. */
  team(workspaceId: string): Promise<{ version: number; keys: TeamKeys }>;
  /** An object's bytes, or null when it is not there. */
  read(path: string): Promise<Uint8Array<ArrayBuffer> | null>;
  write(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  /** Deletes an object. Succeeds when it is already gone. */
  remove(path: string): Promise<void>;
}

/**
 * What to write for one attachment, or null when it is already where it should be. Going to work its name is sealed
 * with the team's key and a sealed file is copied under it; going back the name returns to the agent's key and the
 * copy is deleted (before the row says so, so an interrupted job is found again by its team_path and finishes).
 * Without `files` (a job that only moves text) the bytes are left for a later run.
 */
export async function moveAttachmentFile(keys: Keys, files: ShareFiles | undefined, move: Move, row: AttachmentRow): Promise<RowWrite | null> {
  const changes = new Changes();
  const placed = move.direction === "to_work" ? move.workspaceId : null;
  changes.note("workspace_id", row.workspace_id, placed);
  changes.note("filename", row.filename ?? null, await moveValue(keys, move, FIELD.filename, row.filename ?? null));
  if (files) {
    if (move.direction === "to_work") {
      if (row.sealed && row.storage_path && !row.team_path) {
        const sealed = await files.read(row.storage_path);
        if (sealed) {
          const plain = await decryptBytes(await keys.user(move.userId), FIELD.attachmentData, sealed);
          const team = await files.team(move.workspaceId);
          const path = teamFilePath(move.workspaceId, row.id);
          await files.write(path, await encryptTeamBytes(team.keys, FIELD.attachmentData, plain));
          changes.note("team_path", null, path);
          changes.note("team_key_version", row.team_key_version ?? null, team.version);
        }
      }
    } else if (row.team_path) {
      await files.remove(row.team_path);
      changes.note("team_path", row.team_path, null);
      changes.note("team_key_version", row.team_key_version ?? null, null);
    }
  }
  return changes.write(row.id);
}

/** Opens a team copy with the current key, else the older versions. null when none opens it. */
export async function openTeamFile(keys: TeamKeys[], sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!isSealedBytes(sealed)) return null;
  for (const k of keys) {
    try {
      return await decryptTeamBytes(k, FIELD.attachmentData, sealed);
    } catch {
      // another version
    }
  }
  return null;
}
