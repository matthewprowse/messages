// A stored file's bytes sealed for, and opened at, the place they are kept ("<bucket>/<path>", packages/crypto/src/bound.ts):
// once SEAL_BOUND_FIELDS is on (`bind`), a sealed file copied to another path or another user's folder does not open.
// Until then the legacy "e1b:" is written, and both are always read. Pure: the caller says whether to bind.

import { decryptBytes, decryptTeamBytes, encryptBytes, encryptBytesAt, encryptTeamBytes, encryptTeamBytesAt, type TeamKeys, type UserKeys } from "@messages/crypto";
import type { Field } from "@messages/crypto/fields";
import { storageWhere } from "@messages/crypto/places";

/** A file's bytes sealed with the user's key for `bucket`/`path`: bound when `bind`, the legacy format otherwise. */
export function sealFileFor(keys: UserKeys, field: Field, bucket: string, path: string, plain: Uint8Array<ArrayBuffer>, bind: boolean): Promise<Uint8Array<ArrayBuffer>> {
  return bind ? encryptBytesAt(keys, field, storageWhere(bucket, path), plain) : encryptBytes(keys, field, plain);
}

/** A sealed file read from `bucket`/`path`, opened with any key the user holds. Throws if it will not open there. */
export function openFileFor(keys: UserKeys, field: Field, bucket: string, path: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return decryptBytes(keys, field, sealed, storageWhere(bucket, path));
}

/** sealFileFor with a team's key (a team copy of a file). */
export function sealTeamFileFor(keys: TeamKeys, field: Field, bucket: string, path: string, plain: Uint8Array<ArrayBuffer>, bind: boolean): Promise<Uint8Array<ArrayBuffer>> {
  return bind ? encryptTeamBytesAt(keys, field, storageWhere(bucket, path), plain) : encryptTeamBytes(keys, field, plain);
}

/** openFileFor with one version of a team's key. */
export function openTeamFileFor(keys: TeamKeys, field: Field, bucket: string, path: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return decryptTeamBytes(keys, field, sealed, storageWhere(bucket, path));
}
