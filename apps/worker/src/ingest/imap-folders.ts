// Which folder on an IMAP server is Sent, Archive, Trash and Junk. Pure, so it can be unit tested.
// A folder the server marks with a special-use flag wins. Otherwise the usual names are looked for, at the
// top level or under the Inbox, as cPanel and Dovecot servers keep them ("INBOX.Sent" with a "." delimiter).

export interface ListedFolder {
  path: string;
  /** The folder's separator, "/" or "." (cPanel and Dovecot). */
  delimiter?: string;
  flags?: Set<string>;
  specialUse?: string;
  /** How specialUse was found: "extension" when the server said so, "name" when imapflow guessed it from the name. */
  specialUseSource?: "user" | "extension" | "name";
}

export interface FolderPicks {
  sent?: string;
  archive?: string;
  trash?: string;
  junk?: string;
}

/** The usual names, most likely first. iCloud's are Sent Messages, Deleted Messages, Junk and Archive. */
export const FOLDER_NAMES: Record<keyof FolderPicks, string[]> = {
  sent: ["Sent", "Sent Items", "Sent Mail", "Sent Messages"],
  archive: ["Archive", "Archives"],
  trash: ["Trash", "Deleted Items", "Deleted Messages", "Deleted", "Bin"],
  junk: ["Junk", "Spam", "Junk E-mail", "Junk Email", "Bulk Mail"],
};

const FLAG: Record<keyof FolderPicks, string> = { sent: "\\Sent", archive: "\\Archive", trash: "\\Trash", junk: "\\Junk" };

/** A folder's name without an "INBOX." or "INBOX/" in front, for comparing with the usual names. */
function bareName(folder: ListedFolder): string {
  const d = folder.delimiter;
  return d && folder.path.toUpperCase().startsWith(`INBOX${d}`) ? folder.path.slice(6) : folder.path;
}

export function pickFolders(list: ListedFolder[]): FolderPicks {
  // A folder that cannot be opened is a parent only, never a place for mail.
  const usable = list.filter((f) => f.path.toUpperCase() !== "INBOX" && !f.flags?.has("\\Noselect") && !f.flags?.has("\\NonExistent"));
  const picks: FolderPicks = {};
  const taken = new Set<string>();
  const pick = (role: keyof FolderPicks, folder: ListedFolder | undefined) => {
    if (!folder || picks[role] || taken.has(folder.path)) return;
    picks[role] = folder.path;
    taken.add(folder.path);
  };
  const roles = Object.keys(FLAG) as (keyof FolderPicks)[];
  // What the server says, then the usual names (top level before under the Inbox), then imapflow's guess.
  for (const role of roles) pick(role, usable.find((f) => f.specialUse === FLAG[role] && f.specialUseSource !== "name"));
  for (const role of roles) {
    for (const name of FOLDER_NAMES[role]) {
      const wanted = name.toLowerCase();
      pick(role, usable.find((f) => f.path.toLowerCase() === wanted) ?? usable.find((f) => bareName(f).toLowerCase() === wanted));
    }
  }
  for (const role of roles) pick(role, usable.find((f) => f.specialUse === FLAG[role]));
  return picks;
}
