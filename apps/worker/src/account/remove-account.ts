// Removing one connected account: which stored files go with it. Pure, so the reference counting is tested without storage.
//
// Files are deduped by content, so one object can be the file of several attachment rows, and the same photo can reach two of a
// person's accounts. An object may be deleted only when no attachment row left behind still points at it. The same holds for
// a team copy (team_path) and a thumbnail (thumb_path).

/** An attachment row as the removal reads it: its object paths and the account its message belongs to. */
export interface FileRow {
  id: string;
  accountId: string;
  storagePath: string | null;
  thumbPath: string | null;
  teamPath: string | null;
}

/** Every object path a row points at. */
export const pathsOf = (row: FileRow): string[] => [row.storagePath, row.thumbPath, row.teamPath].filter((p): p is string => !!p);

/**
 * The objects to delete when `removing` accounts go: every path their rows point at, minus any path a row of another account
 * (`others`, rows that share a path with them) still points at. Sorted so the result is stable.
 */
export function objectsToDelete(rows: FileRow[], others: FileRow[]): string[] {
  const going = new Set(rows.flatMap(pathsOf));
  const kept = new Set(others.flatMap(pathsOf));
  return [...going].filter((p) => !kept.has(p)).sort();
}

/** The paths of `rows` that other rows might share, to look those others up by. */
export const sharedCandidates = (rows: FileRow[]): string[] => [...new Set(rows.flatMap(pathsOf))];
