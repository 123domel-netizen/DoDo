import { useEffect, useMemo, useState } from "react";
import { CheckSquare, CalendarDays, Link2 } from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import {
  filterOverviewForHubGroup,
  overviewTitle,
} from "@/lib/chat/feed";
import { jumpToMessage, openConversation } from "@/lib/chat/init";
import { fetchRecentItemLinks, type RecentItemLink } from "@/lib/chat/api";
import { formatMessageTime } from "@/components/chat/MessageBubble";
import { setRouteHash } from "@/lib/navigation";
import { itemMatchesGroupFilter } from "@/lib/groups";

/** Lista powiązań wiadomość ↔ zadanie/wydarzenie. */
export function HubLinksPane() {
  const items = useStore((s) => s.items);
  const setEditing = useStore((s) => s.setEditing);
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const hubMatchGroup = useChatStore((s) => s.hubMatchGroup);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const [rows, setRows] = useState<RecentItemLink[] | null>(null);

  const filteredOverview = useMemo(
    () =>
      filterOverviewForHubGroup(overview, {
        matchGroup: hubMatchGroup,
        activeGroupFilter,
        itemGroupId: (itemId) => items[itemId]?.groupId,
      }),
    [overview, hubMatchGroup, activeGroupFilter, items],
  );
  const allowedConvKey = useMemo(
    () => filteredOverview.map((c) => c.id).sort().join(","),
    [filteredOverview],
  );

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    const allowed = new Set(allowedConvKey ? allowedConvKey.split(",") : []);
    void fetchRecentItemLinks(60).then((list) => {
      if (cancelled) return;
      let next = list;
      if (hubMatchGroup && activeGroupFilter) {
        next = list.filter((l) => {
          if (!allowed.has(l.conversationId)) return false;
          const item = items[l.itemId];
          if (!item) return true;
          return itemMatchesGroupFilter(item, activeGroupFilter, "tasks");
        });
      }
      setRows(next);
    });
    return () => {
      cancelled = true;
    };
  }, [hubMatchGroup, activeGroupFilter, allowedConvKey, items]);

  const titleOf = (conversationId: string) => {
    const entry = overview.find((c) => c.id === conversationId);
    return entry
      ? overviewTitle(entry, myUserId, (id) => items[id]?.title)
      : "Rozmowa";
  };

  if (rows === null) {
    return (
      <div className="px-4 py-6 text-center text-xs text-ink-faint">Wczytywanie…</div>
    );
  }
  if (!rows.length) {
    return (
      <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
        Brak powiązań.
        <br />
        Powstają przy konwersji wiadomości / decyzji / notatki na zadanie lub wydarzenie.
      </div>
    );
  }

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
      {rows.map((row) => {
        const item = items[row.itemId];
        const ItemIcon = item?.type === "event" ? CalendarDays : CheckSquare;
        return (
          <div
            key={`${row.messageId}-${row.itemId}`}
            className="flex flex-col gap-1 border-b border-line/50 px-3 py-2.5"
          >
            <div className="flex items-start gap-2">
              <Link2 size={12} className="mt-1 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setEditing(row.itemId)}
                  className="flex w-full items-center gap-1.5 text-left text-sm text-ink hover:underline"
                >
                  <ItemIcon size={13} className="shrink-0 text-ink-faint" />
                  <span className="truncate">
                    {item?.title?.trim() || "Wpis (może być usunięty)"}
                  </span>
                </button>
                <p className="mt-0.5 truncate text-[10px] text-ink-faint">
                  {row.kind === "created_from" ? "utworzono z wiadomości" : "powiązanie"} ·{" "}
                  {titleOf(row.conversationId)} · {formatMessageTime(row.createdAt)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void openConversation(row.conversationId).then(() => {
                  void jumpToMessage(row.conversationId, row.messageId);
                });
                setRouteHash({
                  view: "conversation",
                  conversationId: row.conversationId,
                });
              }}
              className="self-start rounded-md border border-line px-2 py-1 text-[10px] text-ink-light transition hover:text-ink"
            >
              Pokaż wiadomość
            </button>
          </div>
        );
      })}
    </div>
  );
}
