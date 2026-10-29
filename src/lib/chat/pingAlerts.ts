import { create } from "zustand";

export const PING_ALERT_MAX_AGE_MS = 2 * 60 * 1000;
export const PING_ALERT_DISPLAY_MS = 15_000;

export type PingAlert = {
  pingId: string;
  conversationId: string;
  senderId: string;
  createdAt: string;
};

export type ChatPingRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  target_user_id: string;
  created_at: string;
};

/** Czy wiersz PINGa jest adresowany do mnie i jeszcze „świeży” (alert in-app). */
export function isPingForMe(
  row: Pick<ChatPingRow, "target_user_id" | "created_at">,
  myId: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!myId || row.target_user_id !== myId) return false;
  const created = new Date(row.created_at).getTime();
  if (Number.isNaN(created)) return false;
  return nowMs - created <= PING_ALERT_MAX_AGE_MS;
}

type PingAlertsState = {
  queue: PingAlert[];
  push: (alert: PingAlert) => void;
  dismiss: (pingId: string) => void;
  clear: () => void;
};

export const usePingAlerts = create<PingAlertsState>((set, get) => ({
  queue: [],
  push: (alert) => {
    if (get().queue.some((a) => a.pingId === alert.pingId)) return;
    set((s) => ({ queue: [...s.queue, alert] }));
  },
  dismiss: (pingId) => {
    set((s) => ({ queue: s.queue.filter((a) => a.pingId !== pingId) }));
  },
  clear: () => set({ queue: [] }),
}));

export function enqueuePingFromRow(row: ChatPingRow, myId: string | null | undefined): void {
  if (!isPingForMe(row, myId)) return;
  usePingAlerts.getState().push({
    pingId: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_user_id,
    createdAt: row.created_at,
  });
}
