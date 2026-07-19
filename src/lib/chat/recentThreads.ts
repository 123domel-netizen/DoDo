import { threadDisplayTitle } from "@/lib/chat/feed";
import type { ChatMessage } from "@/lib/chat/types";

const STORAGE_KEY = "dodo-recent-threads-v1";
const MAX = 12;

export interface RecentThreadEntry {
  rootId: string;
  conversationId: string;
  title: string;
  at: number;
}

function read(): RecentThreadEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentThreadEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) => e && typeof e.rootId === "string" && typeof e.conversationId === "string",
    );
  } catch {
    return [];
  }
}

function write(list: RecentThreadEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // ignore quota
  }
}

export function loadRecentThreads(): RecentThreadEntry[] {
  return read().sort((a, b) => b.at - a.at);
}

/** Mapa rootId → timestamp ostatniego otwarcia wątku (lokalnie). */
export function threadSeenAtMap(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of read()) out[e.rootId] = e.at;
  return out;
}

/**
 * Nieodczytany wątek = ma odpowiedzi i użytkownik go lokalnie nie otworzył,
 * albo otworzył, ale potem przyszła nowsza odpowiedź od kogoś innego.
 */
export function isThreadUnread(opts: {
  replyCount: number;
  myUserId: string | null | undefined;
  lastReply?: { at: string; authorUserId: string } | null;
  seenAt?: number | null;
}): boolean {
  const { replyCount, myUserId, lastReply, seenAt } = opts;
  if (replyCount <= 0) return false;

  // Nigdy nieotwarty lokalnie → nieodczytany (w obrębie rozmowy).
  if (seenAt == null) return true;

  if (!myUserId || !lastReply) return false;
  if (lastReply.authorUserId === myUserId) return false;
  return new Date(lastReply.at).getTime() > seenAt;
}

/** Zapamiętaj otwarcie wątku (lokalnie, per przeglądarka). */
export function rememberRecentThread(
  root:
    | ChatMessage
    | { id: string; conversationId: string; title?: string; body?: string; kind?: ChatMessage["kind"]; deletedAt?: string | null; threadTitle?: string | null },
) {
  const rootId = root.id;
  const conversationId = root.conversationId;
  const title =
    ("title" in root && typeof root.title === "string" && root.title.trim()) ||
    ("body" in root
      ? threadDisplayTitle(root as ChatMessage)
      : "Wątek");
  const next = [
    { rootId, conversationId, title: String(title), at: Date.now() },
    ...read().filter((e) => e.rootId !== rootId),
  ];
  write(next);
}
