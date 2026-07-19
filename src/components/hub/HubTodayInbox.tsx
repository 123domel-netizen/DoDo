import { useEffect, useMemo, useState } from "react";
import { isPast, isToday, startOfDay } from "date-fns";
import {
  AtSign,
  CheckSquare,
  Gavel,
  ListChecks,
} from "lucide-react";
import { useTodayDashboardData } from "@/hooks/useTodayDashboardData";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import {
  filterOverviewForHubGroup,
  overviewTitle,
} from "@/lib/chat/feed";
import {
  jumpToMessage,
  openConversation,
  openRegistryInPanel,
  showTodoInPanel,
} from "@/lib/chat/init";
import {
  fetchDecisionsForConversations,
  fetchMyMentions,
} from "@/lib/chat/api";
import type { ChatDecision, ChatMessage } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";
import { setRouteHash } from "@/lib/navigation";

function isSameDayIso(iso: string, day: Date): boolean {
  return isToday(new Date(iso)) || startOfDay(new Date(iso)).getTime() === day.getTime();
}

/** Inbox „Dziś”: zadania na dziś/zaległe + wzmianki + decyzje z dzisiaj. */
export function HubTodayInbox() {
  const { tasks } = useTodayDashboardData();
  const setEditing = useStore((s) => s.setEditing);
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const items = useStore((s) => s.items);
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const profiles = useChatStore((s) => s.profiles);
  const hubMatchGroup = useChatStore((s) => s.hubMatchGroup);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const registryEpoch = useChatStore((s) => s.registryEpoch);

  const [mentions, setMentions] = useState<ChatMessage[] | null>(null);
  const [decisions, setDecisions] = useState<ChatDecision[] | null>(null);

  const filteredOverview = useMemo(
    () =>
      filterOverviewForHubGroup(overview, {
        matchGroup: hubMatchGroup,
        activeGroupFilter,
        itemGroupId: (itemId) => items[itemId]?.groupId,
      }),
    [overview, hubMatchGroup, activeGroupFilter, items],
  );
  const convIds = useMemo(() => filteredOverview.map((c) => c.id), [filteredOverview]);
  const convIdsKey = convIds.join(",");
  const todayKey = startOfDay(new Date()).toISOString();

  const todayTasks = useMemo(() => {
    return tasks
      .filter((it) => {
        if (!it.hasDueDate) return false;
        const due = new Date(it.end);
        return isToday(due) || isPast(due);
      })
      .slice(0, 12);
  }, [tasks]);

  useEffect(() => {
    if (!myUserId) return;
    let cancelled = false;
    const day = new Date(todayKey);
    void fetchMyMentions(myUserId).then((list) => {
      if (cancelled) return;
      const allowed = new Set(convIds);
      const scoped =
        hubMatchGroup && activeGroupFilter
          ? list.filter((m) => allowed.has(m.conversationId))
          : list;
      setMentions(
        scoped.filter((m) => isSameDayIso(m.createdAt, day)).slice(0, 15),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [myUserId, convIdsKey, hubMatchGroup, activeGroupFilter, registryEpoch, todayKey]);

  useEffect(() => {
    let cancelled = false;
    const day = new Date(todayKey);
    void fetchDecisionsForConversations(convIds).then((list) => {
      if (cancelled) return;
      setDecisions(
        list.filter((d) => isSameDayIso(d.decidedAt, day)).slice(0, 15),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [convIdsKey, registryEpoch, todayKey]);

  const titleOf = (conversationId: string) => {
    const entry = overview.find((c) => c.id === conversationId);
    return entry
      ? overviewTitle(entry, myUserId, (id) => items[id]?.title)
      : "Rozmowa";
  };

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
      <section className="border-b border-line/70 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          <ListChecks size={12} /> Zadania dziś / zaległe
        </div>
        {todayTasks.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-ink-faint">Brak zadań na dziś.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {todayTasks.map((it) => {
              const overdue = it.hasDueDate && isPast(new Date(it.end)) && !isToday(new Date(it.end));
              return (
                <div
                  key={it.id}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition hover:bg-surface-raised"
                >
                  <button
                    type="button"
                    onClick={() => toggleTaskDone(it.id)}
                    className="shrink-0 text-ink-faint hover:text-accent"
                    aria-label="Oznacz jako zrobione"
                  >
                    <CheckSquare size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      showTodoInPanel();
                      setEditing(it.id);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-sm text-ink"
                  >
                    {it.title || "(bez tytułu)"}
                    {overdue && (
                      <span className="ml-1 text-[10px] text-red-400">zaległe</span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="border-b border-line/70 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          <AtSign size={12} /> Wzmianki dziś
        </div>
        {mentions === null ? (
          <p className="py-2 text-center text-[11px] text-ink-faint">Wczytywanie…</p>
        ) : mentions.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-ink-faint">Brak wzmianek dziś.</p>
        ) : (
          mentions.map((msg) => (
            <button
              key={msg.id}
              type="button"
              onClick={() => {
                void openConversation(msg.conversationId).then(() => {
                  void jumpToMessage(msg.conversationId, msg.threadRootId ?? msg.id);
                });
                setRouteHash({
                  view: "conversation",
                  conversationId: msg.conversationId,
                });
              }}
              className="flex w-full flex-col gap-0.5 rounded-md px-1.5 py-1.5 text-left transition hover:bg-surface-raised"
            >
              <span className="truncate text-[10px] text-ink-faint">
                {profiles[msg.authorUserId]?.displayName || "Nieznany"} ·{" "}
                {titleOf(msg.conversationId)}
              </span>
              <span className="line-clamp-2 text-sm text-ink">
                {msg.body || "(załącznik)"}
              </span>
            </button>
          ))
        )}
      </section>

      <section className="px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          <Gavel size={12} /> Decyzje dziś
        </div>
        {decisions === null ? (
          <p className="py-2 text-center text-[11px] text-ink-faint">Wczytywanie…</p>
        ) : decisions.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-ink-faint">Brak decyzji dziś.</p>
        ) : (
          decisions.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() =>
                openRegistryInPanel({
                  kind: "decision",
                  id: d.id,
                  conversationId: d.conversationId,
                  messageId: d.messageId,
                  body: d.body,
                  note: d.note,
                  createdBy: d.createdBy,
                  at: d.decidedAt,
                  groupId: d.groupId,
                  tagIds: d.tagIds,
                })
              }
              className="flex w-full flex-col gap-0.5 rounded-md px-1.5 py-1.5 text-left transition hover:bg-surface-raised"
            >
              <span className="line-clamp-2 text-sm text-ink">{d.body}</span>
              <span className="truncate text-[10px] text-ink-faint">
                {titleOf(d.conversationId)} · {formatMessageTime(d.decidedAt)}
              </span>
            </button>
          ))
        )}
      </section>
    </div>
  );
}
