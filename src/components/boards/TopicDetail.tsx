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
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { ConversationView } from "@/components/chat/ConversationView";
import { SnoozeMenu } from "@/components/boards/SnoozeMenu";
import { useTopicActions } from "@/components/boards/topicActions";
import { topicConversationEntry } from "@/lib/boards/entry";
import { isSnoozed } from "@/lib/boards/sections";
import {
  navigateToBoards,
  openTopicConversation,
  setViewingTopic,
  startItemFromTopic,
} from "@/lib/boards/runtime";
import { useBoardsStore } from "@/lib/boards/store";
import {
  TOPIC_DESCRIPTION_MAX,
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

const actionBtn =
  "flex items-center gap-1 rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-ink transition hover:border-line-strong disabled:opacity-50";

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
        className="w-full rounded-md px-1 py-0.5 text-left text-base font-semibold text-ink transition hover:bg-surface-raised"
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
      className="w-full rounded-md border border-accent bg-surface-raised px-1.5 py-0.5 text-base font-semibold text-ink outline-none"
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
        className={`w-full whitespace-pre-wrap rounded-md px-1 py-1 text-left text-sm transition hover:bg-surface-raised ${
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
      rows={4}
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
      className="w-full resize-y rounded-md border border-accent bg-surface-raised px-2 py-1.5 text-sm text-ink outline-none"
    />
  );
}

function LinkedItems({ topic }: { topic: BoardTopic }) {
  const items = useStore((s) => s.items);
  const setEditing = useStore((s) => s.setEditing);
  const unlinkItem = useBoardsStore((s) => s.unlinkItem);
  const setNotice = useBoardsStore((s) => s.setNotice);
  if (topic.items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {topic.items.map((link) => {
        const item = items[link.itemId];
        const Icon = link.itemType === "event" ? CalendarClock : CheckSquare;
        return (
          <li
            key={link.itemId}
            className="flex items-center gap-2 rounded-md border border-line bg-surface-raised/60 px-2 py-1 text-xs"
          >
            <Icon size={13} className="shrink-0 text-ink-faint" />
            {item ? (
              <button
                type="button"
                onClick={() => setEditing(link.itemId)}
                className="min-w-0 flex-1 truncate text-left text-ink transition hover:text-accent"
              >
                {item.title || "(bez tytułu)"}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate text-ink-faint">
                Element niedostępny (usunięty lub nie Twój)
              </span>
            )}
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
  const setNotice = useBoardsStore((s) => s.setNotice);
  const actions = useTopicActions(topic);
  const topicId = topic.id;
  const conversationId = topic.conversationId;

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
      <div className="shrink-0 border-b border-line/80 px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
            aria-label="Wróć do listy tematów"
          >
            {mobile ? <ArrowLeft size={18} /> : <X size={16} />}
          </button>
          <div className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">{board.name}</div>
        </div>

        <EditableTitle topic={topic} />
        <div className="mb-1 px-1 text-[11px] text-ink-faint">
          {author ? `${author} · ` : ""}
          {fmt(topic.createdAt, "d MMM yyyy, HH:mm")}
          {topic.pinnedAt && !closed ? " · przypięty" : ""}
          {snoozed && topic.snoozedUntil && !closed
            ? ` · odłożony do ${fmt(topic.snoozedUntil, "d MMM")}`
            : ""}
          {closed ? " · zamknięty" : ""}
        </div>
        <EditableDescription topic={topic} />

        {!pending && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {!closed && (
              <button type="button" onClick={() => void actions.togglePin()} className={actionBtn}>
                {topic.pinnedAt ? <PinOff size={13} /> : <Pin size={13} />}
                {topic.pinnedAt ? "Odepnij" : "Przypnij"}
              </button>
            )}
            {!closed &&
              (snoozed ? (
                <button type="button" onClick={() => void actions.wake()} className={actionBtn}>
                  <BellOff size={13} />
                  Przywróć teraz
                </button>
              ) : (
                <SnoozeMenu onPick={(until) => void actions.snoozeUntil(until)} />
              ))}
            {closed ? (
              <button type="button" onClick={() => void actions.reopen()} className={actionBtn}>
                <RotateCcw size={13} />
                Otwórz ponownie
              </button>
            ) : (
              <button type="button" onClick={() => void actions.close()} className={actionBtn}>
                <CheckCheck size={13} />
                Zamknij
              </button>
            )}
            <button
              type="button"
              onClick={() => startItemFromTopic(topic, "task", board.name)}
              className={actionBtn}
            >
              <ListPlus size={13} />
              Zadanie
            </button>
            <button
              type="button"
              onClick={() => startItemFromTopic(topic, "event", board.name)}
              className={actionBtn}
            >
              <CalendarPlus size={13} />
              Wydarzenie
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => void onDelete()}
                className={`${actionBtn} ml-auto hover:text-red-400`}
                title="Usuń temat (tylko bez komentarzy)"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}

        {topic.items.length > 0 && (
          <div className="mt-2">
            <LinkedItems topic={topic} />
          </div>
        )}
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
