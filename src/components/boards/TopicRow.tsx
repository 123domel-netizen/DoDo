import type { DragEvent } from "react";
import {
  AlertCircle,
  CheckSquare,
  CalendarClock,
  GripVertical,
  MessageSquare,
  Pin,
  PinOff,
} from "lucide-react";
import {
  effectiveUnread,
  commentPreviewText,
  formatTopicTime,
  visibleTopicItems,
} from "@/lib/boards/sections";
import { useBoardsStore } from "@/lib/boards/store";
import type { Board, BoardField, BoardTopic, TopicSection } from "@/lib/boards/types";
import { formatFieldCell } from "@/lib/boards/topicView";
import { fmt } from "@/lib/format";
import { useTopicActions } from "@/components/boards/topicActions";
import { useStore } from "@/state/store";

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
  columnFields = [],
  draggable: canDrag = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dragging,
  dropTarget,
}: {
  topic: BoardTopic;
  board: Board;
  section: TopicSection;
  now: Date;
  active: boolean;
  onOpen: (topic: BoardTopic) => void;
  columnFields?: BoardField[];
  draggable?: boolean;
  onDragStart?: (topicId: string) => void;
  onDragOver?: (topicId: string) => void;
  onDrop?: (topicId: string) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  dropTarget?: boolean;
}) {
  const myUserId = useBoardsStore((s) => s.userId);
  const readAt = useBoardsStore((s) => s.locallyReadAt[topic.id]);
  const retryTopic = useBoardsStore((s) => s.retryTopic);
  const discardLocalTopic = useBoardsStore((s) => s.discardLocalTopic);
  const items = useStore((s) => s.items);
  const actions = useTopicActions(topic);

  const unread = active ? 0 : effectiveUnread(topic, readAt);
  const local = Boolean(topic.sendState);
  const preview = topic.lastComment ? commentPreviewText(topic.lastComment) : "";
  const who = topic.lastComment ? authorLabel(board, topic.lastComment.authorUserId, myUserId) : "";
  const visible = visibleTopicItems(topic.items, items);
  const taskCount = visible.filter((i) => i.itemType === "task").length;
  const eventCount = visible.filter((i) => i.itemType === "event").length;
  const muted = section === "closed" || section === "snoozed";

  const handleDragStart = (e: DragEvent) => {
    if (!canDrag || local) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", topic.id);
    onDragStart?.(topic.id);
  };

  return (
    <li
      className={`group relative flex items-stretch gap-0.5 rounded-md transition ${
        active
          ? "bg-accent/10 ring-1 ring-accent/40"
          : dropTarget
            ? "bg-accent/5 ring-1 ring-accent/25"
            : "hover:bg-surface-raised/50"
      } ${dragging ? "opacity-50" : ""}`}
      onDragOver={
        canDrag
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              onDragOver?.(topic.id);
            }
          : undefined
      }
      onDrop={
        canDrag
          ? (e) => {
              e.preventDefault();
              onDrop?.(topic.id);
            }
          : undefined
      }
    >
      {canDrag && !local ? (
        <button
          type="button"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={() => onDragEnd?.()}
          className="flex w-5 shrink-0 cursor-grab items-center justify-center self-stretch text-ink-faint opacity-40 transition hover:text-ink hover:opacity-100 active:cursor-grabbing group-hover:opacity-70"
          aria-label="Przeciągnij, aby zmienić kolejność"
          title="Przeciągnij"
        >
          <GripVertical size={14} />
        </button>
      ) : (
        <span className="w-1.5 shrink-0" aria-hidden />
      )}

      <button
        type="button"
        disabled={local && topic.sendState === "pending" && !topic.conversationId}
        onClick={() => onOpen(topic)}
        className="flex min-w-0 flex-1 items-start gap-1.5 rounded-md px-1.5 py-1 text-left disabled:cursor-default"
        aria-current={active ? "true" : undefined}
      >
        <span className="mt-0.5 w-2.5 shrink-0">
          {unread > 0 ? (
            <span className="block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          ) : topic.pinnedAt && section === "pinned" ? (
            <Pin size={10} className="text-accent" aria-hidden />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            {topic.code && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
                {topic.code}
              </span>
            )}
            <span
              className={`min-w-0 flex-1 truncate text-[13px] leading-snug ${
                unread > 0 ? "font-semibold text-ink" : muted ? "text-ink-light" : "text-ink"
              }`}
            >
              {topic.title}
            </span>
            {columnFields.length > 0 && (
              <span className="hidden min-w-0 max-w-[45%] shrink items-center gap-2 sm:flex">
                {columnFields.map((f) => {
                  const cell = formatFieldCell(topic, f);
                  return (
                    <span
                      key={f.id}
                      className="min-w-0 max-w-[7rem] truncate text-[11px] text-ink-faint"
                      title={`${f.name}: ${cell}`}
                    >
                      <span className="text-ink-faint/70">{f.name}: </span>
                      {cell}
                    </span>
                  );
                })}
              </span>
            )}
            {!local && (
              <span className="shrink-0 text-[10px] text-ink-faint">
                {formatTopicTime(topic.lastActivityAt, now)}
              </span>
            )}
          </span>
          {columnFields.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 sm:hidden">
              {columnFields.map((f) => {
                const cell = formatFieldCell(topic, f);
                return (
                  <span key={f.id} className="text-[10px] text-ink-faint" title={`${f.name}: ${cell}`}>
                    <span className="opacity-70">{f.name}: </span>
                    {cell}
                  </span>
                );
              })}
            </span>
          )}
          {topic.sendState === "pending" ? (
            <span className="block truncate text-[11px] text-ink-faint">Zapisywanie…</span>
          ) : topic.sendState === "failed" ? (
            <span className="flex items-center gap-1 truncate text-[11px] text-red-400">
              <AlertCircle size={11} />
              {topic.sendError ?? "Nie udało się zapisać tematu."}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] leading-snug text-ink-faint">
              <span className="min-w-0 flex-1 truncate">
                {section === "snoozed" && topic.snoozedUntil
                  ? `Wróci ${fmt(topic.snoozedUntil, "EEE d MMM")}`
                  : preview
                    ? `${who ? `${who}: ` : ""}${preview}`
                    : "Brak komentarzy"}
              </span>
              {taskCount > 0 && (
                <span className="flex shrink-0 items-center gap-0.5" title="Powiązane zadania">
                  <CheckSquare size={10} />
                  {taskCount}
                </span>
              )}
              {eventCount > 0 && (
                <span className="flex shrink-0 items-center gap-0.5" title="Powiązane wydarzenia">
                  <CalendarClock size={10} />
                  {eventCount}
                </span>
              )}
              {topic.commentCount > 0 && (
                <span className="flex shrink-0 items-center gap-0.5" title="Komentarze">
                  <MessageSquare size={10} />
                  {topic.commentCount}
                </span>
              )}
            </span>
          )}
        </span>
        {unread > 0 && (
          <span
            className="mt-0.5 flex h-3.5 min-w-[0.875rem] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none text-white"
            aria-label={`${unread} nieprzeczytanych`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {topic.sendState === "failed" ? (
        <div className="flex shrink-0 items-center gap-1 pr-1.5 text-[11px]">
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
            className="my-0.5 mr-1 hidden shrink-0 items-center self-center rounded-md p-1 text-ink-faint transition hover:bg-surface-overlay hover:text-ink focus-visible:flex group-hover:flex"
            aria-label={topic.pinnedAt ? "Odepnij temat" : "Przypnij temat"}
            title={topic.pinnedAt ? "Odepnij" : "Przypnij"}
          >
            {topic.pinnedAt ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
        )
      )}
    </li>
  );
}
