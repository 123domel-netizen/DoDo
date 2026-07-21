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
import {
  EMPTY_HUB_LIST_FILTERS,
  matchesHubListFilters,
  type HubListFilterState,
} from "@/lib/chat/hubListFilters";

/** Lista powiązań wiadomość ↔ zadanie/wydarzenie — zwarty wiersz jak Media/All. */
export function HubLinksPane({
  listFilters = EMPTY_HUB_LIST_FILTERS,
}: {
  listFilters?: HubListFilterState;
} = {}) {
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

  const visible = rows.filter((row) => {
    const item = items[row.itemId];
    return matchesHubListFilters(
      {
        conversationId: row.conversationId,
        at: row.createdAt,
        textParts: [item?.title],
      },
      listFilters,
    );
  });

  if (!visible.length) {
    return (
      <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
        Brak powiązań dla wybranych filtrów.
      </div>
    );
  }

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
      {visible.map((row) => {
        const item = items[row.itemId];
        const ItemIcon = item?.type === "event" ? CalendarDays : CheckSquare;
        const label = item?.title?.trim() || "Wpis (może być usunięty)";
        return (
          <div
            key={`${row.messageId}-${row.itemId}`}
            className="flex w-full items-center gap-2.5 border-b border-line/50 px-3 py-1.5"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-raised text-ink-faint">
              <ItemIcon size={14} />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <button
                type="button"
                onClick={() => setEditing(row.itemId)}
                className="block w-full truncate text-left text-[13px] font-medium text-ink hover:underline"
              >
                {label}
              </button>
              <p className="mt-px truncate text-[11px] text-ink-faint">
                {titleOf(row.conversationId)} ·{" "}
                {row.kind === "created_from" ? "z wiadomości" : "powiązanie"} ·{" "}
                {formatMessageTime(row.createdAt)}
              </p>
            </div>
            <button
              type="button"
              title="Pokaż wiadomość"
              onClick={() => {
                void openConversation(row.conversationId).then(() => {
                  void jumpToMessage(row.conversationId, row.messageId);
                });
                setRouteHash({
                  view: "conversation",
                  conversationId: row.conversationId,
                });
              }}
              className="shrink-0 rounded-md p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
            >
              <Link2 size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
