// Carries the By Person choice (group=person) in an Inbox list address. Pure.

/** The address with group=person added (or left as it is) when By Person is on. */
export function withGroup(href: string, byPerson: boolean): string {
  if (!byPerson) return href;
  return href + (href.includes("?") ? "&" : "?") + "group=person";
}
