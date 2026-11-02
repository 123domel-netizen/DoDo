import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BellOff,
  CalendarPlus,
  CheckCheck,
  CheckSquare,
  CalendarClock,
  ListPlus,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { ConversationView } from "@/components/chat/ConversationView";
import { PingButton } from "@/components/chat/PingButton";
import { SnoozeMenu } from "@/components/boards/SnoozeMenu";
import { TopicFields } from "@/components/boards/TopicFields";
import { useTopicActions } from "@/components/boards/topicActions";
import { topicConversationEntry } from "@/lib/boards/entry";
import {
  deletedTopicItemIds,
  isSnoozed,
  normalizeTopicCode,
  normalizeTopicLocality,
  visibleTopicItems,
} from "@/lib/boards/sections";
import {
  navigateToBoards,
  openTopicConversation,
  setViewingTopic,
  startItemFromTopic,
} from "@/lib/boards/runtime";
import { useBoardsStore } from "@/lib/boards/store";
import {
  TOPIC_CODE_MAX,
  TOPIC_DESCRIPTION_MAX,
  TOPIC_LOCALITY_MAX,
  TOPIC_TITLE_MAX,
  type Board,
  type BoardTopic,
} from "@/lib/boards/types";
import { fmt } from "@/lib/format";
import { goBackOr } from "@/lib/navigation";
import { useStore } from "@/state/store";

function findTopic(
  topicsByBoard: Record<string, BoardTopic[]>,
  topicId: string,
): BoardTopic | undefined {
  for (const list of Object.values(topicsByBoard)) {
    const hit = list.find((t) => t.id === topicId);
    if (hit) return hit;
  }
  return undefined;
}

/** Ikona + title — żeby pasek akcji mieścił się w jednym wierszu panelu. */
const actionBtn =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-raised text-ink transition hover:border-line-strong disabled:opacity-50";

function EditableCode({ topic }: { topic: BoardTopic }) {
  const actions = useTopicActions(topic);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(topic.code ?? "");

  useEffect(() => {
    if (!editing) setValue(topic.code ?? "");
  }, [topic.code, editing]);

  const commit = () => {
    setEditing(false);
    const clean = normalizeTopicCode(value);
    if (clean !== topic.code) void actions.setCode(clean);
    else setValue(topic.code ?? "");
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`shrink-0 rounded px-0.5 py-px font-mono text-[12px] tabular-nums transition hover:bg-surface-raised ${
          topic.code ? "text-ink-light" : "text-ink-faint"
        }`}
        title="Kliknij, aby nadać kod (np. N01)"
      >
        {topic.code ?? "Kod"}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={value}
      maxLength={TOPIC_CODE_MAX}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setValue(topic.code ?? "");
          setEditing(false);
        }
      }}
      placeholder="N01"
      aria-label="Kod tematu"
      className="w-14 shrink-0 rounded border border-accent bg-surface-raised px-1 py-px font-mono text-[12px] tabular-nums text-ink outline-none"
    />
  );
}

function EditableTitle({ topic }: { topic: BoardTopic }) {
  const actions = useTopicActions(topic);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(topic.title);

  useEffect(() => {
    if (!editing) setValue(topic.title);
  }, [topic.title, editing]);

  const commit = () => {
    setEditing(false);
    const clean = value.replace(/\s+/g, " ").trim();
    if (clean && clean !== topic.title) void actions.rename(clean);
    else setValue(topic.title);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-w-0 flex-1 rounded px-0.5 py-px text-left text-[15px] font-semibold leading-snug text-ink transition hover:bg-surface-raised"
        title="Kliknij, aby zmienić tytuł"
      >
        {topic.title}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={value}
      maxLength={TOPIC_TITLE_MAX}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setValue(topic.title);
          setEditing(false);
        }
      }}
      aria-label="Tytuł tematu"
      className="min-w-0 flex-1 rounded border border-accent bg-surface-raised px-1 py-px text-[15px] font-semibold text-ink outline-none"
    />
  );
}

function EditableLocality({ topic }: { topic: BoardTopic }) {
  const actions = useTopicActions(topic);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(topic.locality ?? "");

  useEffect(() => {
    if (!editing) setValue(topic.locality ?? "");
  }, [topic.locality, editing]);

  const commit = () => {
    setEditing(false);
    const clean = normalizeTopicLocality(value);
    if (clean !== topic.locality) void actions.setLocality(clean);
    else setValue(topic.locality ?? "");
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`shrink-0 rounded px-0.5 py-px text-[13px] transition hover:bg-surface-raised ${
          topic.locality ? "text-ink" : "text-ink-faint/70"
        }`}
        title="Kliknij, aby ustawić miejscowość"
      >
        {topic.locality ? (
          <>
            <span className="text-ink-faint">- </span>
            {topic.locality}
          </>
        ) : (
          <>- miejscowość</>
        )}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={value}
      maxLength={TOPIC_LOCALITY_MAX}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setValue(topic.locality ?? "");
          setEditing(false);
        }
      }}
      placeholder="Miejscowość"
      aria-label="Miejscowość tematu"
      className="w-28 shrink-0 rounded border border-accent bg-surface-raised px-1 py-px text-[13px] text-ink outline-none"
    />
  );
}

function EditableDescription({ topic }: { topic: BoardTopic }) {
  const actions = useTopicActions(topic);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(topic.description);

  useEffect(() => {
    if (!editing) setValue(topic.description);
  }, [topic.description, editing]);

  const commit = () => {
    setEditing(false);
    if (value !== topic.description) void actions.setDescription(value.trim());
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`w-full whitespace-pre-wrap rounded px-0.5 py-0.5 text-left text-[12px] leading-snug transition hover:bg-surface-raised ${
          topic.description ? "text-ink-light" : "text-ink-faint"
        }`}
      >
        {topic.description || "Dodaj opis…"}
      </button>
    );
  }
  return (
    <textarea
      autoFocus
      value={value}
      rows={3}
      maxLength={TOPIC_DESCRIPTION_MAX}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setValue(topic.description);
          setEditing(false);
        }
      }}
      aria-label="Opis tematu"
      className="w-full resize-y rounded border border-accent bg-surface-raised px-1.5 py-1 text-[12px] text-ink outline-none"
    />
  );
}

function LinkedItems({ topic }: { topic: BoardTopic }) {
  const items = useStore((s) => s.items);
  const setEditing = useStore((s) => s.setEditing);
  const unlinkItem = useBoardsStore((s) => s.unlinkItem);
  const setNotice = useBoardsStore((s) => s.setNotice);
  const visible = visibleTopicItems(topic.items, items);

  // Soft-delete w kalendarzu zostawia tombstone — odpinamy link (trigger i tak posprząta).
  useEffect(() => {
    const dead = deletedTopicItemIds(topic.items, items);
    for (const itemId of dead) {
      void unlinkItem(topic.id, itemId);
    }
  }, [topic.id, topic.items, items, unlinkItem]);

  if (visible.length === 0) return null;
  return (
    <ul className="space-y-1">
      {visible.map((link) => {
        const item = items[link.itemId]!;
        const Icon = link.itemType === "event" ? CalendarClock : CheckSquare;
        return (
          <li
            key={link.itemId}
            className="flex items-center gap-2 rounded-md border border-line bg-surface-raised/60 px-2 py-1 text-xs"
          >
            <Icon size={13} className="shrink-0 text-ink-faint" />
            <button
              type="button"
              onClick={() => setEditing(link.itemId)}
              className="min-w-0 flex-1 truncate text-left text-ink transition hover:text-accent"
            >
              {item.title || "(bez tytułu)"}
            </button>
            <button
              type="button"
              onClick={() =>
                void unlinkItem(topic.id, link.itemId).then((res) => {
                  if (res.error) setNotice(res.error);
                })
              }
              className="shrink-0 text-ink-faint transition hover:text-red-400"
              aria-label="Odepnij od tematu"
              title="Odepnij od tematu (element zostaje)"
            >
              <X size={12} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Szczegóły tematu: tytuł, opis, akcje, powiązane zadania/wydarzenia i komentarze (czat osadzony). */
export function TopicDetail({ topicId, mobile = false }: { topicId: string; mobile?: boolean }) {
  const topic = useBoardsStore((s) => findTopic(s.topicsByBoard, topicId));
  const boards = useBoardsStore((s) => s.boards);
  const activeBoardId = useBoardsStore((s) => s.activeBoardId);
  const topicsStatus = useBoardsStore((s) =>
    activeBoardId ? s.topicsStatus[activeBoardId] : undefined,
  );
  const loadTopics = useBoardsStore((s) => s.loadTopics);

  const board = topic ? boards.find((b) => b.id === topic.boardId) : undefined;
  const boardId = topic?.boardId ?? activeBoardId;

  useEffect(() => {
    if (boardId && !topicsStatus) void loadTopics(boardId);
  }, [boardId, topicsStatus, loadTopics]);

  const close = () => {
    if (!boardId) return;
    if (mobile) goBackOr(() => navigateToBoards({ boardId }));
    else navigateToBoards({ boardId });
  };

  if (!topic || !board) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-ink-faint">
        {topicsStatus === "ready" || topicsStatus === "error" ? (
          <>
            <div>Ten temat jest niedostępny.</div>
            <button type="button" onClick={close} className={actionBtn}>
              Wróć do listy
            </button>
          </>
        ) : (
          "Ładowanie tematu…"
        )}
      </div>
    );
  }

  return <TopicDetailBody topic={topic} board={board} mobile={mobile} close={close} />;
}

function TopicDetailBody({
  topic,
  board,
  mobile,
  close,
}: {
  topic: BoardTopic;
  board: Board;
  mobile: boolean;
  close: () => void;
}) {
  const myUserId = useBoardsStore((s) => s.userId);
  const deleteTopic = useBoardsStore((s) => s.deleteTopic);
  const addTopic = useBoardsStore((s) => s.addTopic);
  const setNotice = useBoardsStore((s) => s.setNotice);
  const actions = useTopicActions(topic);
  const localityEnabled = board.localityEnabled;
  const topicId = topic.id;
  const conversationId = topic.conversationId;
  const isRoot = !topic.parentId;
  const parentTitle = useBoardsStore((s) => {
    if (!topic.parentId) return null;
    return (
      (s.topicsByBoard[topic.boardId] ?? []).find((t) => t.id === topic.parentId)?.title ?? null
    );
  });

  // Oglądany temat: komentarze od razu „przeczytane”, wiadomości załadowane.
  useEffect(() => {
    if (!conversationId) return;
    setViewingTopic(topicId);
    openTopicConversation({ id: topicId, conversationId });
    return () => setViewingTopic(null);
  }, [topicId, conversationId]);

  const entry = useMemo(() => topicConversationEntry(topic, board), [topic, board]);

  const pending = Boolean(topic.sendState);
  const closed = Boolean(topic.closedAt);
  const snoozed = isSnoozed(topic, new Date());
  const canDelete = !pending && (topic.createdBy === myUserId || board.myRole === "owner");
  const author = board.members.find((m) => m.userId === topic.createdBy)?.displayName || "";

  const onDelete = async () => {
    if (!window.confirm("Usunąć ten temat? Tej operacji nie można cofnąć.")) return;
    const res = await deleteTopic(topic.id);
    if (res.error) setNotice(res.error);
    else close();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-line/80 px-2.5 py-1.5">
        <div className="mb-0.5 flex items-center gap-1">
          <div className="min-w-0 flex-1 truncate text-[10px] text-ink-faint">{board.name}</div>
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded p-1 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
            aria-label="Wróć do listy tematów"
          >
            {mobile ? <ArrowLeft size={18} /> : <X size={16} />}
          </button>
        </div>

        <div className="flex items-baseline gap-0.5">
          <EditableCode topic={topic} />
          <EditableTitle topic={topic} />
          {localityEnabled && <EditableLocality topic={topic} />}
        </div>
        <div className="truncate px-0.5 text-[10px] leading-tight text-ink-faint">
          {parentTitle ? (
            <>
              Podtemat · {parentTitle}
              {" · "}
            </>
          ) : null}
          {author ? `${author} · ` : ""}
          {fmt(topic.createdAt, "d MMM yyyy, HH:mm")}
          {topic.pinnedAt && !closed && isRoot ? " · przypięty" : ""}
          {snoozed && topic.snoozedUntil && !closed
            ? ` · odłożony do ${fmt(topic.snoozedUntil, "d MMM")}`
            : ""}
          {closed ? " · zamknięty" : ""}
        </div>
        <EditableDescription topic={topic} />
        <TopicFields topic={topic} />

        {!pending && (
          <div className="mt-1.5 flex flex-nowrap items-center gap-1 overflow-x-auto thin-scrollbar">
            {conversationId && (
              <PingButton
                conversationId={conversationId}
                myUserId={myUserId}
                participants={board.members.map((m) => ({
                  userId: m.userId,
                  displayName: m.displayName,
                  avatarUrl: m.avatarUrl,
                }))}
                variant="action"
              />
            )}
            {!closed && isRoot && (
              <button
                type="button"
                onClick={() => void actions.togglePin()}
                className={actionBtn}
                title={topic.pinnedAt ? "Odepnij" : "Przypnij"}
                aria-label={topic.pinnedAt ? "Odepnij temat" : "Przypnij temat"}
              >
                {topic.pinnedAt ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
            )}
            {!closed && isRoot && (
              <button
                type="button"
                onClick={() => {
                  const id = addTopic(board.id, "Nowy podtemat", undefined, undefined, topic.id);
                  if (id) navigateToBoards({ boardId: board.id, topicId: id }, mobile ? "push" : "replace");
                }}
                className={actionBtn}
                title="Dodaj podtemat"
                aria-label="Dodaj podtemat"
              >
                <Plus size={13} />
              </button>
            )}
            {!closed &&
              (snoozed ? (
                <button
                  type="button"
                  onClick={() => void actions.wake()}
                  className={actionBtn}
                  title="Przywróć teraz"
                  aria-label="Przywróć temat teraz"
                >
                  <BellOff size={13} />
                </button>
              ) : (
                <SnoozeMenu onPick={(until) => void actions.snoozeUntil(until)} label="" />
              ))}
            {closed ? (
              <button
                type="button"
                onClick={() => void actions.reopen()}
                className={actionBtn}
                title="Otwórz ponownie"
                aria-label="Otwórz temat ponownie"
              >
                <RotateCcw size={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void actions.close()}
                className={actionBtn}
                title="Zamknij"
                aria-label="Zamknij temat"
              >
                <CheckCheck size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={() => startItemFromTopic(topic, "task", board.name)}
              className={actionBtn}
              title="Zadanie"
              aria-label="Dodaj zadanie"
            >
              <ListPlus size={13} />
            </button>
            <button
              type="button"
              onClick={() => startItemFromTopic(topic, "event", board.name)}
              className={actionBtn}
              title="Wydarzenie"
              aria-label="Dodaj wydarzenie"
            >
              <CalendarPlus size={13} />
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => void onDelete()}
                className={`${actionBtn} ml-auto hover:text-red-400`}
                title="Usuń temat (tylko bez komentarzy)"
                aria-label="Usuń temat"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}

        <div className="mt-1.5">
          <LinkedItems topic={topic} />
        </div>
      </div>

      {closed && (
        <div className="shrink-0 border-b border-line/60 bg-surface-raised/50 px-3 py-1.5 text-[11px] text-ink-faint">
          Temat zamknięty — nowy komentarz otworzy go ponownie.
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col [&>div]:min-h-0 [&>div]:flex-1">
        {pending || !conversationId ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-ink-faint">
            {topic.sendState === "failed"
              ? "Temat nie został zapisany — ponów zapis na liście tematów."
              : "Zapisywanie tematu…"}
          </div>
        ) : (
          <ConversationView
            key={conversationId}
            conversationId={conversationId}
            embedded
            entryOverride={entry}
          />
        )}
      </div>
    </div>
  );
}
