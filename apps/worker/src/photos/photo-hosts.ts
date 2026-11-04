// Where the address book photo sync may connect, and how much of a photo it reads. Pure: no network. The iCloud
// sign-in goes only to iCloud's CardDAV hosts, and a vCard's PHOTO link is written by whoever made the card, so
// every link is checked here before icloud.ts or google.ts fetches it.

/** The most a contact photo may be; photos/store.ts keeps nothing larger. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

const ICLOUD_CONTACTS_HOST = /^(p\d{1,4}-)?contacts\.icloud\.com$/i;
const GOOGLE_PHOTO_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(googleusercontent|ggpht)\.com$/i;

function httpsUrl(href: string, base?: string): URL | null {
  try {
    const url = new URL(href, base);
    return url.protocol === "https:" && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

/** True for an https link on iCloud's contacts hosts (contacts.icloud.com or a pNN-contacts partition). */
export function isICloudContactsUrl(href: string, base?: string): boolean {
  const url = httpsUrl(href, base);
  return !!url && ICLOUD_CONTACTS_HOST.test(url.hostname);
}

/** The absolute URL of an href from a CardDAV answer. Throws code BAD_HOST off iCloud's contacts hosts. */
export function icloudContactsUrl(href: string, base: string): string {
  const url = httpsUrl(href, base);
  if (!url || !ICLOUD_CONTACTS_HOST.test(url.hostname)) throw Object.assign(new Error("carddav host is not iCloud"), { code: "BAD_HOST" });
  return url.href;
}

/** True for an https link on Google's image hosts, where contact photos are served without a sign-in. */
export function isGooglePhotoUrl(href: string): boolean {
  const url = httpsUrl(href);
  return !!url && GOOGLE_PHOTO_HOST.test(url.hostname);
}
