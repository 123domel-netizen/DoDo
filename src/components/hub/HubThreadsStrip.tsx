import { useEffect, useMemo, useState } from "react";
import { Clock, MessageSquare, Pin } from "lucide-react";
import { fetchPinnedMessages, fetchThreadsList } from "@/lib/chat/api";
import { openThread } from "@/lib/chat/init";
import { threadDisplayTitle } from "@/lib/chat/feed";
import { setRouteHash } from "@/lib/navigation";
import type { ChatMessage } from "@/lib/chat/types";
import { loadRecentThreads } from "@/lib/chat/recentThreads";

const PINNED_LIMIT = 4;
const RECENT_LIMIT = 4;

interface HubThreadsStripProps {
  /** Tylko wątki otwartej rozmowy; null = belka ukryta. */
  conversationId: string | null;
}

/**
 * Mini-belka pod listą rozmów: przypięte i ostatnie wątki aktywnej korespondencji.
 */
export function HubThreadsStrip({ conversationId }: HubThreadsStripProps) {
  const [pinned, setPinned] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<
    { root: ChatMessage; replyCount: number }[]
  >([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [recentTick, setRecentTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!conversationId) {
      setPinned([]);
      setThreads([]);
      setLoadedFor(null);
      return;
    }
    setPinned([]);
    setThreads([]);
    setLoadedFor(null);

    void (async () => {
      const [pins, list] = await Promise.all([
        fetchPinnedMessages(conversationId),
        fetchThreadsList(conversationId),
      ]);
      if (cancelled) return;
      setPinned(
        pins.filter(
          (m) =>
            m.conversationId === conversationId &&
            !m.threadRootId &&
            !m.deletedAt &&
            !m.threadArchivedAt,
        ),
      );
      setThreads(
        list.filter(
          (t) =>
            t.root.conversationId === conversationId && !t.root.threadArchivedAt,
        ),
      );
      setLoadedFor(conversationId);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Po otwarciu wątku odśwież listę (bez czyszczenia belki przy przełączaniu rozmowy).
  useEffect(() => {
    if (!conversationId || recentTick === 0) return;
    let cancelled = false;
    void (async () => {
      const [pins, list] = await Promise.all([
        fetchPinnedMessages(conversationId),
        fetchThreadsList(conversationId),
      ]);
      if (cancelled) return;
      setPinned(
        pins.filter(
          (m) =>
            m.conversationId === conversationId &&
            !m.threadRootId &&
            !m.deletedAt &&
            !m.threadArchivedAt,
        ),
      );
      setThreads(
        list.filter(
          (t) =>
            t.root.conversationId === conversationId && !t.root.threadArchivedAt,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [recentTick, conversationId]);

  const ready = Boolean(conversationId && loadedFor === conversationId);

  const pinnedIds = useMemo(() => new Set(pinned.map((p) => p.id)), [pinned]);

  const recentItems = useMemo(() => {
    if (!ready || !conversationId) return [];
    const byId = new Map(
      threads
        .filter((t) => t.root.conversationId === conversationId)
        .map((t) => [t.root.id, t]),
    );
    const fromHistory: {
      rootId: string;
      title: string;
      replyCount: number;
    }[] = [];

    for (const r of loadRecentThreads()) {
      if (r.conversationId !== conversationId) continue;
      if (pinnedIds.has(r.rootId)) continue;
      // Tylko jeśli wątek nadal istnieje w tej rozmowie (albo jest w historii z potwierdzonym id).
      const live = byId.get(r.rootId);
      if (!live) continue;
      fromHistory.push({
        rootId: r.rootId,
        title: threadDisplayTitle(live.root),
        replyCount: live.replyCount,
      });
      if (fromHistory.length >= RECENT_LIMIT) break;
    }

    if (fromHistory.length < RECENT_LIMIT) {
      for (const t of threads) {
        if (t.root.conversationId !== conversationId) continue;
        if (pinnedIds.has(t.root.id)) continue;
        if (fromHistory.some((x) => x.rootId === t.root.id)) continue;
        fromHistory.push({
          rootId: t.root.id,
          title: threadDisplayTitle(t.root),
          replyCount: t.replyCount,
        });
        if (fromHistory.length >= RECENT_LIMIT) break;
      }
    }
    return fromHistory;
  }, [ready, conversationId, threads, pinnedIds]);

  const pinnedVisible = pinned
    .filter((m) => m.conversationId === conversationId)
    .slice(0, PINNED_LIMIT);

  if (!ready || (!pinnedVisible.length && !recentItems.length)) {
    return null;
  }

  const open = async (rootId: string) => {
    if (!conversationId) return;
    setRouteHash({
      view: "conversation",
      conversationId,
      threadRootId: rootId,
    });
    await openThread(rootId);
    setRecentTick((n) => n + 1);
  };

  const chip =
    "inline-flex max-w-[8.5rem] shrink-0 items-center gap-1 rounded-full border border-line bg-surface-raised px-1.5 py-0.5 text-[10px] leading-tight text-ink-light transition hover:border-accent/40 hover:bg-accent/10 hover:text-ink";

  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-line bg-surface-raised/50 px-2 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {pinnedVisible.length > 0 && (
        <>
          <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-ink-faint">
            Przypięte
          </span>
          {pinnedVisible.map((msg) => (
            <button
              key={msg.id}
              type="button"
              title={threadDisplayTitle(msg)}
              onClick={() => void open(msg.id)}
              className={chip}
            >
              <Pin size={9} className="shrink-0 text-accent" />
              <span className="truncate">{threadDisplayTitle(msg)}</span>
            </button>
          ))}
        </>
      )}
      {pinnedVisible.length > 0 && recentItems.length > 0 && (
        <span className="mx-0.5 h-3 w-px shrink-0 bg-line" aria-hidden />
      )}
      {recentItems.length > 0 && (
        <>
          <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-ink-faint">
            Ostatnie
          </span>
          {recentItems.map((item) => (
            <button
              key={item.rootId}
              type="button"
              title={item.title}
              onClick={() => void open(item.rootId)}
              className={chip}
            >
              {item.replyCount > 0 ? (
                <MessageSquare size={9} className="shrink-0 text-accent" />
              ) : (
                <Clock size={9} className="shrink-0 text-ink-faint" />
              )}
              <span className="truncate">{item.title}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
