import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowDownAZ,
  CheckSquare,
  CalendarClock,
  Filter,
  GripVertical,
  MessageSquare,
  Pin,
  PinOff,
} from "lucide-react";
import { BoardTopicViewMenu } from "@/components/boards/BoardTopicViewMenu";
import { TopicFieldEditor } from "@/components/boards/TopicFieldEditor";
import { useTopicActions } from "@/components/boards/topicActions";
import {
  effectiveUnread,
  commentPreviewText,
  formatTopicTime,
  visibleTopicItems,
} from "@/lib/boards/sections";
import { useBoardsStore } from "@/lib/boards/store";
import type { Board, BoardField, BoardTopic, TopicSection } from "@/lib/boards/types";
import type { BoardTopicViewPrefs, TopicFieldFilters } from "@/lib/boards/topicView";
import { fmt } from "@/lib/format";
import { useStore } from "@/state/store";

/** Stała szerokość komórki pola — nagłówek i wiersze muszą się zgadzać. */
export const TOPIC_FIELD_COL_CLASS = "w-[5.75rem] shrink-0 truncate px-0.5 text-[11px]";
/** Gutter przeciągania (zawsze zarezerwowany). */
export const TOPIC_DRAG_GUTTER = "w-5 shrink-0";
/** Gutter przypięcia (zawsze zarezerwowany — kolumny się nie ruszają). */
export const TOPIC_PIN_GUTTER = "w-7 shrink-0";
export const TOPIC_TIME_SLOT = "w-11 shrink-0 text-right text-[10px] text-ink-faint";
export const TOPIC_META_DOT = "w-2.5 shrink-0";

function authorLabel(board: Board, userId: string | undefined, myUserId: string | null): string {
  if (!userId) return "";
  if (userId === myUserId) return "Ty";
  const name = board.members.find((m) => m.userId === userId)?.displayName?.trim();
  return name ? name.split(/\s+/)[0]! : "";
}

export function SortModeChip({
  prefs,
  fields,
  onChange,
}: {
  prefs: BoardTopicViewPrefs;
  fields: BoardField[];
  onChange: (next: BoardTopicViewPrefs) => void;
}) {
  const sort = prefs.sort;
  const fieldName =
    sort.mode === "field" ? fields.find((f) => f.id === sort.fieldId)?.name : null;

  if (sort.mode === "field" && fieldName) {
    return (
      <button
        type="button"
        onClick={() => onChange({ ...prefs, sort: { mode: "manual" } })}
        className="inline-flex max-w-[9rem] shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent transition hover:bg-surface-raised"
        title={`Sort wg „${fieldName}”. Kliknij: kolejność ręczna`}
      >
        <ArrowDownAZ size={12} />
        <span className="truncate">{fieldName}</span>
      </button>
    );
  }

  const isCode = sort.mode === "code";
  return (
    <button
      type="button"
      onClick={() => onChange({ ...prefs, sort: { mode: isCode ? "manual" : "code" } })}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint transition hover:bg-surface-raised hover:text-ink-light"
      title={
        isCode
          ? "Wg kodu. Kliknij: ręczne + przeciąganie"
          : "Ręczne (przeciąganie). Kliknij: sortuj wg kodu"
      }
    >
      {isCode ? <ArrowDownAZ size={12} /> : <GripVertical size={12} />}
      <span>{isCode ? "Kod" : "Ręczne"}</span>
    </button>
  );
}

function toggleFilterOption(
  prefs: BoardTopicViewPrefs,
  fieldId: string,
  optionId: string,
): BoardTopicViewPrefs {
  const filters: TopicFieldFilters = { ...prefs.filters };
  const cur = new Set(filters[fieldId] ?? []);
  if (cur.has(optionId)) cur.delete(optionId);
  else cur.add(optionId);
  if (cur.size === 0) delete filters[fieldId];
  else filters[fieldId] = [...cur];
  return { ...prefs, filters };
}

function ColumnFilterHeader({
  field,
  prefs,
  onChange,
}: {
  field: BoardField;
  prefs: BoardTopicViewPrefs;
  onChange: (next: BoardTopicViewPrefs) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const canFilter = field.kind === "single" || field.kind === "multi";
  const selected = prefs.filters[field.id] ?? [];
  const active = selected.length > 0;
  const panelW = 176;

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      let left = r.right - panelW;
      left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));
      setPos({ top: r.bottom + 4, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!canFilter) {
    return (
      <span
        className={`${TOPIC_FIELD_COL_CLASS} font-semibold uppercase tracking-wide text-ink-faint`}
        title={field.name}
      >
        {field.name}
      </span>
    );
  }

  return (
    <div ref={rootRef} className={`relative ${TOPIC_FIELD_COL_CLASS}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-0.5 truncate text-left font-semibold uppercase tracking-wide transition hover:text-ink-light ${
          active ? "text-accent" : "text-ink-faint"
        }`}
        title={active ? `${field.name} · filtr aktywny` : `Filtr: ${field.name}`}
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate">{field.name}</span>
        <Filter size={9} className={`shrink-0 ${active ? "opacity-100" : "opacity-50"}`} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, left: pos.left, width: panelW }}
            className="fixed z-[80] max-h-48 overflow-y-auto thin-scrollbar rounded-lg border border-line bg-surface-overlay p-1.5 shadow-panel"
          >
            {field.options.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-surface-raised"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o.id)}
                  onChange={() => onChange(toggleFilterOption(prefs, field.id, o.id))}
                  className="accent-accent"
                />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </label>
            ))}
            {active && (
              <button
                type="button"
                onClick={() => {
                  const filters = { ...prefs.filters };
                  delete filters[field.id];
                  onChange({ ...prefs, filters });
                }}
                className="mt-0.5 w-full rounded-md px-1.5 py-1 text-left text-[11px] text-ink-faint hover:bg-surface-raised hover:text-ink-light"
              >
                Wyczyść
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Sticky belka: Temat + sort/widok + nagłówki kolumn z filtrami. */
export function TopicColumnsHeader({
  columnFields,
  allFields,
  prefs,
  onChange,
}: {
  columnFields: BoardField[];
  allFields: BoardField[];
  prefs: BoardTopicViewPrefs;
  onChange: (next: BoardTopicViewPrefs) => void;
}) {
  return (
    <div
      className="sticky top-0 z-10 mb-0.5 flex items-center gap-0.5 border-b border-line/60 bg-surface px-0 py-1"
      role="row"
    >
      <span className={TOPIC_DRAG_GUTTER} aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5">
        <span className={TOPIC_META_DOT} aria-hidden />
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Temat
          </span>
          <SortModeChip prefs={prefs} fields={allFields} onChange={onChange} />
          <BoardTopicViewMenu fields={allFields} prefs={prefs} onChange={onChange} />
        </div>
        {columnFields.length > 0 && (
          <span className="hidden items-center sm:flex">
            {columnFields.map((f) => (
              <ColumnFilterHeader key={f.id} field={f} prefs={prefs} onChange={onChange} />
            ))}
          </span>
        )}
        <span className={TOPIC_TIME_SLOT} aria-hidden />
      </div>
      <span className={TOPIC_PIN_GUTTER} aria-hidden />
    </div>
  );
}

function TopicFieldCell({
  field,
  topic,
  disabled,
}: {
  field: BoardField;
  topic: BoardTopic;
  disabled?: boolean;
}) {
  return (
    <TopicFieldEditor
      field={field}
      topic={topic}
      disabled={disabled}
      trigger={({ summary, empty, disabled: d, toggle }) => (
        <button
          type="button"
          disabled={d}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className={`${TOPIC_FIELD_COL_CLASS} rounded text-left transition hover:bg-surface-raised hover:text-ink disabled:cursor-default disabled:opacity-50 ${
            empty ? "text-ink-faint" : "text-ink-light"
          }`}
          title={`${field.name}: ${summary}`}
        >
          {summary}
        </button>
      )}
    />
  );
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
  const showPin = !local && section !== "closed";
  const fieldDisabled = local;

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
          className={`${TOPIC_DRAG_GUTTER} flex cursor-grab items-center justify-center self-stretch text-ink-faint opacity-40 transition hover:text-ink hover:opacity-100 active:cursor-grabbing group-hover:opacity-70`}
          aria-label="Przeciągnij, aby zmienić kolejność"
          title="Przeciągnij"
        >
          <GripVertical size={14} />
        </button>
      ) : (
        <span className={TOPIC_DRAG_GUTTER} aria-hidden />
      )}

      <div className="flex min-w-0 flex-1 items-start gap-1.5 px-1.5 py-1">
        <span className={`mt-0.5 ${TOPIC_META_DOT}`}>
          {unread > 0 ? (
            <span className="block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          ) : topic.pinnedAt && section === "pinned" ? (
            <Pin size={10} className="text-accent" aria-hidden />
          ) : null}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={local && topic.sendState === "pending" && !topic.conversationId}
              onClick={() => onOpen(topic)}
              className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded-md text-left disabled:cursor-default"
              aria-current={active ? "true" : undefined}
            >
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
                {topic.locality ? (
                  <span className="font-normal text-ink-faint"> — {topic.locality}</span>
                ) : null}
              </span>
            </button>

            {columnFields.length > 0 && (
              <div className="hidden items-center sm:flex">
                {columnFields.map((f) => (
                  <TopicFieldCell key={f.id} field={f} topic={topic} disabled={fieldDisabled} />
                ))}
              </div>
            )}

            {!local ? (
              <span className={TOPIC_TIME_SLOT}>{formatTopicTime(topic.lastActivityAt, now)}</span>
            ) : (
              <span className={TOPIC_TIME_SLOT} aria-hidden />
            )}
          </div>

          {columnFields.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-x-1 gap-y-0.5 sm:hidden">
              {columnFields.map((f) => (
                <TopicFieldEditor
                  key={f.id}
                  field={f}
                  topic={topic}
                  disabled={fieldDisabled}
                  trigger={({ summary, empty, disabled: d, toggle }) => (
                    <button
                      type="button"
                      disabled={d}
                      onClick={toggle}
                      className={`rounded px-1 py-0.5 text-[10px] transition hover:bg-surface-raised disabled:opacity-50 ${
                        empty ? "text-ink-faint" : "text-ink-light"
                      }`}
                      title={`${f.name}: ${summary}`}
                    >
                      <span className="opacity-60">{f.name}:</span> {summary}
                    </button>
                  )}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={local && topic.sendState === "pending" && !topic.conversationId}
            onClick={() => onOpen(topic)}
            className="mt-0.5 flex w-full items-center gap-1.5 text-left text-[11px] leading-snug text-ink-faint disabled:cursor-default"
          >
            {topic.sendState === "pending" ? (
              <span className="block truncate">Zapisywanie…</span>
            ) : topic.sendState === "failed" ? (
              <span className="flex items-center gap-1 truncate text-red-400">
                <AlertCircle size={11} />
                {topic.sendError ?? "Nie udało się zapisać tematu."}
              </span>
            ) : (
              <>
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
                {unread > 0 && (
                  <span
                    className="flex h-3.5 min-w-[0.875rem] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none text-white"
                    aria-label={`${unread} nieprzeczytanych`}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {topic.sendState === "failed" ? (
        <div
          className={`${TOPIC_PIN_GUTTER} flex flex-col items-center justify-center gap-0.5 pr-0.5 text-[10px]`}
        >
          <button
            type="button"
            onClick={() => retryTopic(topic.id)}
            className="rounded px-0.5 text-accent transition hover:bg-accent/10"
          >
            Ponów
          </button>
          <button
            type="button"
            onClick={() => discardLocalTopic(topic.id)}
            className="rounded px-0.5 text-ink-faint transition hover:bg-surface-overlay hover:text-ink"
          >
            Usuń
          </button>
        </div>
      ) : showPin ? (
        <button
          type="button"
          onClick={() => void actions.togglePin()}
          className={`${TOPIC_PIN_GUTTER} my-0.5 flex items-center justify-center self-center rounded-md text-ink-faint opacity-0 transition hover:bg-surface-overlay hover:text-ink group-hover:opacity-100 focus-visible:opacity-100`}
          aria-label={topic.pinnedAt ? "Odepnij temat" : "Przypnij temat"}
          title={topic.pinnedAt ? "Odepnij" : "Przypnij"}
        >
          {topic.pinnedAt ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
      ) : (
        <span className={TOPIC_PIN_GUTTER} aria-hidden />
      )}
    </li>
  );
}
