/**
 * CHAT5-PRESENCE: prosta obecność online — zielona kropka, gdy heartbeat
 * (profiles.last_seen_at) jest młodszy niż 5 minut. Bez statusów zajętości,
 * bez „ostatnio widziany".
 */

export const ONLINE_WINDOW_MS = 5 * 60_000;

export function isOnline(
  lastSeenAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  return !Number.isNaN(t) && nowMs - t < ONLINE_WINDOW_MS;
}
