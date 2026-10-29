import { AlertCircle, CheckSquare, CalendarClock, MessageSquare, Pin, PinOff } from "lucide-react";
import { effectiveUnread, commentPreviewText, formatTopicTime } from "@/lib/boards/sections";
import { useBoardsStore } from "@/lib/boards/store";
import type { Board, BoardTopic, TopicSection } from "@/lib/boards/types";
import { fmt } from "@/lib/format";
import { useTopicActions } from "@/components/boards/topicActions";

function authorLabel(board: Board, userId: string | undefined, myUserId: string | null): string {
  if (!userId) return "";
  if (userId === myUserId) return "Ty";
  const name = board.members.find((m) => m.userId === userId)?.displayName?.trim();
  return name ? name.split(/\s+/)[0]! : "";
}

export function TopicRow({
  topic,
  board,
  section,
  now,
  active,
  onOpen,
}: {
  topic: BoardTopic;
  board: Board;
  section: TopicSection;
  now: Date;
  active: boolean;
  onOpen: (topic: BoardTopic) => void;
}) {
  const myUserId = useBoardsStore((s) => s.userId);
  const readAt = useBoardsStore((s) => s.locallyReadAt[topic.id]);
  const retryTopic = useBoardsStore((s) => s.retryTopic);
  const discardLocalTopic = useBoardsStore((s) => s.discardLocalTopic);
  const actions = useTopicActions(topic);

  const unread = active ? 0 : effectiveUnread(topic, readAt);
  const local = Boolean(topic.sendState);
  const preview = topic.lastComment ? commentPreviewText(topic.lastComment) : "";
  const who = topic.lastComment ? authorLabel(board, topic.lastComment.authorUserId, myUserId) : "";
  const taskCount = topic.items.filter((i) => i.itemType === "task").length;
  const eventCount = topic.items.filter((i) => i.itemType === "event").length;
  const muted = section === "closed" || section === "snoozed";

  return (
    <li
      className={`group relative flex items-stretch gap-1 rounded-lg border transition ${
        active
          ? "border-accent/50 bg-accent/10"
          : "border-transparent hover:border-line hover:bg-surface-raised/60"
      }`}
    >
      <button
        type="button"
        disabled={local && topic.sendState === "pending" && !topic.conversationId}
        onClick={() => onOpen(topic)}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2.5 py-2 text-left disabled:cursor-default"
        aria-current={active ? "true" : undefined}
      >
        <span className="mt-0.5 w-3 shrink-0">
          {unread > 0 ? (
            <span className="block h-2 w-2 rounded-full bg-accent" aria-hidden />
          ) : topic.pinnedAt && section === "pinned" ? (
            <Pin size={11} className="text-accent" aria-hidden />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                unread > 0 ? "font-semibold text-ink" : muted ? "text-ink-light" : "text-ink"
              }`}
            >
              {topic.title}
            </span>
            {!local && (
              <span className="shrink-0 text-[11px] text-ink-faint">
                {formatTopicTime(topic.lastActivityAt, now)}
              </span>
            )}
          </span>
          {topic.sendState === "pending" ? (
            <span className="block truncate text-xs text-ink-faint">Zapisywanie…</span>
          ) : topic.sendState === "failed" ? (
            <span className="flex items-center gap-1 truncate text-xs text-red-400">
              <AlertCircle size={12} />
              {topic.sendError ?? "Nie udało się zapisać tematu."}
            </span>
          ) : (
            <span className="flex items-center gap-2 text-xs text-ink-faint">
              <span className="min-w-0 flex-1 truncate">
                {section === "snoozed" && topic.snoozedUntil
                  ? `Wróci ${fmt(topic.snoozedUntil, "EEE d MMM")}`
                  : preview
                    ? `${who ? `${who}: ` : ""}${preview}`
                    : "Brak komentarzy"}
              </span>
              {taskCount > 0 && (
                <span className="flex shrink-0 items-center gap-0.5" title="Powiązane zadania">
                  <CheckSquare size={11} />
                  {taskCount}
                </span>
              )}
              {eventCount > 0 && (
                <span className="flex shrink-0 items-center gap-0.5" title="Powiązane wydarzenia">
                  <CalendarClock size={11} />
                  {eventCount}
                </span>
              )}
              {topic.commentCount > 0 && (
                <span className="flex shrink-0 items-center gap-0.5" title="Komentarze">
                  <MessageSquare size={11} />
                  {topic.commentCount}
                </span>
              )}
            </span>
          )}
        </span>
        {unread > 0 && (
          <span
            className="mt-0.5 flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white"
            aria-label={`${unread} nieprzeczytanych`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {topic.sendState === "failed" ? (
        <div className="flex shrink-0 items-center gap-1 pr-2 text-[11px]">
          <button
            type="button"
            onClick={() => retryTopic(topic.id)}
            className="rounded px-1.5 py-0.5 text-accent transition hover:bg-accent/10"
          >
            Ponów
          </button>
          <button
            type="button"
            onClick={() => discardLocalTopic(topic.id)}
            className="rounded px-1.5 py-0.5 text-ink-faint transition hover:bg-surface-overlay hover:text-ink"
          >
            Usuń
          </button>
        </div>
      ) : (
        !local &&
        section !== "closed" && (
          <button
            type="button"
            onClick={() => void actions.togglePin()}
            className="my-1 mr-1.5 hidden shrink-0 items-center self-center rounded-md p-1.5 text-ink-faint transition hover:bg-surface-overlay hover:text-ink focus-visible:flex group-hover:flex"
            aria-label={topic.pinnedAt ? "Odepnij temat" : "Przypnij temat"}
            title={topic.pinnedAt ? "Odepnij" : "Przypnij"}
          >
            {topic.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
        )
      )}
    </li>
  );
}
