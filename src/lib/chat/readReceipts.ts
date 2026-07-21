import type { ChatOverviewEntry } from "@/lib/chat/types";

export type OutboundReadStatus = "none" | "some" | "all";

/**
 * Status odczytu ostatniej wiadomości (tylko gdy to moja).
 * Opiera się na conversation_members.last_read_at (D6) — bez receipts per message.
 */
export function outboundReadStatus(
  entry: ChatOverviewEntry,
  myUserId: string | null,
): OutboundReadStatus | null {
  if (!myUserId) return null;
  const last = entry.lastMessage;
  if (!last || last.deletedAt || last.kind === "system") return null;
  if (last.authorUserId !== myUserId) return null;

  const others = entry.members.filter((m) => m.userId !== myUserId);
  if (others.length === 0) return null;

  const at = new Date(last.createdAt).getTime();
  let read = 0;
  for (const m of others) {
    if (!m.lastReadAt) continue;
    if (new Date(m.lastReadAt).getTime() >= at) read += 1;
  }

  if (read === 0) return "none";
  if (read >= others.length) return "all";
  return "some";
}

export function outboundReadLabel(
  status: OutboundReadStatus,
  memberCountExcludingMe: number,
): string {
  if (status === "all") {
    return memberCountExcludingMe <= 1 ? "Odczytane" : "Odczytane przez wszystkich";
  }
  if (status === "some") return "Odczytane przez część osób";
  return "Wysłane";
}
