/**
 * CHAT5-PRESENCE: prosta obecność online — zielona kropka, gdy heartbeat
 * (profiles.last_seen_at) jest młodszy niż 5 minut. Bez statusów zajętości,
 * bez „ostatnio widziany".
 */

import { useEffect, useState } from "react";
import { dmPeerMember } from "@/lib/avatar";
import type { ChatProfile } from "@/lib/chat/types";

export const ONLINE_WINDOW_MS = 5 * 60_000;

const presenceListeners = new Set<() => void>();
let presenceInterval: ReturnType<typeof setInterval> | null = null;

function subscribePresenceClock(onTick: () => void) {
  presenceListeners.add(onTick);
  if (!presenceInterval) {
    presenceInterval = setInterval(() => {
      for (const fn of presenceListeners) fn();
    }, 60_000);
  }
  return () => {
    presenceListeners.delete(onTick);
    if (presenceListeners.size === 0 && presenceInterval) {
      clearInterval(presenceInterval);
      presenceInterval = null;
    }
  };
}

/** Odświeża UI co minutę — kropka online/offline bez czekania na fetch profili. */
export function usePresenceNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribePresenceClock(() => setNow(Date.now())), []);
  return now;
}

export function isOnline(
  lastSeenAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  return !Number.isNaN(t) && nowMs - t < ONLINE_WINDOW_MS;
}

export type DmPresence = "online" | "offline";

export function dmPeerPresence(
  entry: { kind: string; members: { userId: string }[] },
  myUserId: string | null | undefined,
  profiles: Record<string, ChatProfile>,
  nowMs: number = Date.now(),
): DmPresence | null {
  const peer = dmPeerMember(entry.members, myUserId, entry.kind);
  if (!peer) return null;
  return isOnline(profiles[peer.userId]?.lastSeenAt, nowMs) ? "online" : "offline";
}
