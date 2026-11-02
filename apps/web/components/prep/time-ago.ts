// How long ago a time was, in words ("Today", "Yesterday", "3 Days Ago"), for the client card's footer.

export function timeAgo(iso: string, now: number = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "Today";
  return days === 1 ? "Yesterday" : `${days} Days Ago`;
}
