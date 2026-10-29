import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownAZ,
  ChevronDown,
  ChevronRight,
  GripVertical,
  NotebookPen,
  X,
} from "lucide-react";
import { useBoardsNow } from "@/hooks/useBoards";
import {
  fullOrderAfterSectionReorder,
  groupTopics,
  type TopicListSort,
} from "@/lib/boards/sections";
import { navigateToBoards } from "@/lib/boards/runtime";
import { useBoardsStore } from "@/lib/boards/store";
import type { BoardTopic, TopicSection } from "@/lib/boards/types";
import { QuickAddTopic } from "@/components/boards/QuickAddTopic";
import { TopicRow } from "@/components/boards/TopicRow";
import { CreateBoardDialog } from "@/components/boards/BoardFormDialog";

const EMPTY_TOPICS: BoardTopic[] = [];
const TOPIC_SORT_KEY = "dodo.boards.topicListSort";

function readTopicListSort(): TopicListSort {
  try {
    const v = localStorage.getItem(TOPIC_SORT_KEY);
    return v === "code" ? "code" : "manual";
  } catch {
    return "manual";
  }
}

function writeTopicListSort(sort: TopicListSort) {
  try {
    localStorage.setItem(TOPIC_SORT_KEY, sort);
  } catch {
    /* ignore */
  }
}

/** Krótkie komunikaty (np. błąd zapisu, „temat otwarty ponownie”) — znikają same. */
export function BoardsNotice() {
  const notice = useBoardsStore((s) => s.notice);
  const setNotice = useBoardsStore((s) => s.setNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);

  if (!notice) return null;
  return (
    <div
      role="status"
      className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-ink"
    >
      <span className="min-w-0 flex-1">{notice}</span>
      <button
        type="button"
        onClick={() => setNotice(null)}
        className="shrink-0 text-ink-faint transition hover:text-ink"
        aria-label="Zamknij komunikat"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function Section({
  title,
  count,
  collapsible,
  open,
  onToggle,
  headerExtra,
  children,
}: {
  title: string;
  count: number;
  collapsible?: boolean;
  open: boolean;
  onToggle?: () => void;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mb-1.5">
      {collapsible ? (
        <div className="mb-0.5 flex items-center gap-1 px-2 py-0.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint transition hover:text-ink-light"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {title} <span className="font-normal">({count})</span>
          </button>
          {headerExtra}
        </div>
      ) : (
        <div className="mb-0.5 flex items-center gap-1 px-2 py-0.5">
          <h3 className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            {title}
          </h3>
          {headerExtra}
        </div>
      )}
      {open && <ul className="space-y-px">{children}</ul>}
    </section>
  );
}

function TopicSortToggle({
  sort,
  onChange,
}: {
  sort: TopicListSort;
  onChange: (next: TopicListSort) => void;
}) {
  const isCode = sort === "code";
  return (
    <button
      type="button"
      onClick={() => onChange(isCode ? "manual" : "code")}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint transition hover:bg-surface-raised hover:text-ink-light"
      aria-label={
        isCode
          ? "Sortowanie wg kodu — kliknij, aby wrócić do kolejności ręcznej"
          : "Kolejność ręczna — kliknij, aby sortować wg kodu"
      }
      title={
        isCode
          ? "Wg kodu (A…, potem 001, 2…). Kliknij: ręczne + przeciąganie"
          : "Ręczne (przeciąganie). Kliknij: sortuj wg kodu"
      }
    >
      {isCode ? <ArrowDownAZ size={12} /> : <GripVertical size={12} />}
      <span>{isCode ? "Kod" : "Ręczne"}</span>
    </button>
  );
}

/**
 * Lista tematów wybranej tablicy (obszar główny desktopu / ekran „tematy” na mobile).
 * Nazwy tablic (chipy) renderuje nadrzędny widok.
 */
export function BoardsCanvas({ mobile = false }: { mobile?: boolean }) {
  const boards = useBoardsStore((s) => s.boards);
  const boardsStatus = useBoardsStore((s) => s.boardsStatus);
  const boardsError = useBoardsStore((s) => s.boardsError);
  const activeBoardId = useBoardsStore((s) => s.activeBoardId);
  const activeTopicId = useBoardsStore((s) => s.activeTopicId);
  const topics = useBoardsStore((s) =>
    s.activeBoardId ? (s.topicsByBoard[s.activeBoardId] ?? EMPTY_TOPICS) : EMPTY_TOPICS,
  );
  const topicsStatus = useBoardsStore((s) =>
    s.activeBoardId ? s.topicsStatus[s.activeBoardId] : undefined,
  );
  const topicsError = useBoardsStore((s) =>
    s.activeBoardId ? s.topicsError[s.activeBoardId] : undefined,
  );
  const loadBoards = useBoardsStore((s) => s.loadBoards);
  const loadTopics = useBoardsStore((s) => s.loadTopics);
  const reorderTopics = useBoardsStore((s) => s.reorderTopics);
  const setNotice = useBoardsStore((s) => s.setNotice);

  const [showSnoozed, setShowSnoozed] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [listSort, setListSort] = useState<TopicListSort>(() => readTopicListSort());
  const [dragSection, setDragSection] = useState<"pinned" | "active" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const board = boards.find((b) => b.id === activeBoardId) ?? null;
  const now = useBoardsNow(topics);
  const grouped = useMemo(() => groupTopics(topics, now, listSort), [topics, now, listSort]);
  const canDrag = listSort === "manual";

  // Brak wybranej tablicy (np. start, usunięta) → pierwsza z listy.
  useEffect(() => {
    if (boardsStatus !== "ready" || boards.length === 0) return;
    if (!activeBoardId || !boards.some((b) => b.id === activeBoardId)) {
      navigateToBoards({ boardId: boards[0]!.id });
    }
  }, [boardsStatus, boards, activeBoardId]);

  const boardId = board?.id ?? null;
  const loadFields = useBoardsStore((s) => s.loadFields);
  useEffect(() => {
    if (boardId) {
      void loadTopics(boardId);
      void loadFields(boardId);
    }
  }, [boardId, loadTopics, loadFields]);

  const openTopic = (topic: BoardTopic) => {
    navigateToBoards({ boardId: topic.boardId, topicId: topic.id }, mobile ? "push" : "replace");
  };

  const clearDrag = useCallback(() => {
    setDragSection(null);
    setDragId(null);
    setOverId(null);
  }, []);

  const changeListSort = useCallback(
    (next: TopicListSort) => {
      setListSort(next);
      writeTopicListSort(next);
      clearDrag();
    },
    [clearDrag],
  );

  const commitReorder = useCallback(
    async (section: "pinned" | "active", fromId: string, toId: string) => {
      if (!board || fromId === toId) {
        clearDrag();
        return;
      }
      const list = grouped[section].map((t) => t.id);
      const from = list.indexOf(fromId);
      const to = list.indexOf(toId);
      if (from < 0 || to < 0) {
        clearDrag();
        return;
      }
      const next = [...list];
      next.splice(from, 1);
      next.splice(to, 0, fromId);
      const full = fullOrderAfterSectionReorder(topics, now, section, next);
      clearDrag();
      const res = await reorderTopics(board.id, full);
      if (res.error) setNotice(res.error);
    },
    [board, grouped, topics, now, reorderTopics, setNotice, clearDrag],
  );

  if (boardsStatus === "idle" || (boardsStatus === "loading" && boards.length === 0)) {
    return <div className="flex flex-1 items-center justify-center text-xs text-ink-faint">Ładowanie tablic…</div>;
  }

  if (boardsStatus === "error" && boards.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-sm text-ink">Nie udało się wczytać tablic.</div>
        <div className="text-xs text-ink-faint">{boardsError}</div>
        <button
          type="button"
          onClick={() => void loadBoards()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  if (boards.length === 0 || !board) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <NotebookPen size={28} className="text-ink-faint" />
        <div className="text-sm font-medium text-ink">Nie masz jeszcze żadnej tablicy</div>
        <div className="max-w-xs text-xs text-ink-faint">
          Tablica to wspólny notes z osobą lub zespołem: lista tematów, a pod każdym komentarze.
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110"
        >
          Utwórz tablicę
        </button>
        <CreateBoardDialog open={creating} onClose={() => setCreating(false)} />
      </div>
    );
  }

  const renderRows = (list: BoardTopic[], section: TopicSection) => {
    const sortable = canDrag && (section === "pinned" || section === "active");
    return list.map((t) => (
      <TopicRow
        key={t.id}
        topic={t}
        board={board}
        section={section}
        now={now}
        active={t.id === activeTopicId}
        onOpen={openTopic}
        draggable={sortable}
        dragging={dragId === t.id}
        dropTarget={sortable && dragSection === section && overId === t.id && dragId !== t.id}
        onDragStart={
          sortable
            ? (id) => {
                setDragSection(section);
                setDragId(id);
              }
            : undefined
        }
        onDragOver={sortable && dragSection === section ? (id) => setOverId(id) : undefined}
        onDrop={
          sortable && dragSection === section && dragId
            ? (id) => void commitReorder(section, dragId, id)
            : undefined
        }
        onDragEnd={clearDrag}
      />
    ));
  };

  const sortToggle = <TopicSortToggle sort={listSort} onChange={changeListSort} />;

  const loadingTopics = !topicsStatus || (topicsStatus === "loading" && topics.length === 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-1.5 pt-2">
        <QuickAddTopic key={board.id} boardId={board.id} autoFocus={!mobile} />
      </div>
      <BoardsNotice />
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar px-1.5 pb-3">
        {topicsStatus === "error" && topics.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <div className="text-sm text-ink">Nie udało się wczytać tematów.</div>
            <div className="text-xs text-ink-faint">{topicsError}</div>
            <button
              type="button"
              onClick={() => void loadTopics(board.id)}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
            >
              Spróbuj ponownie
            </button>
          </div>
        ) : loadingTopics ? (
          <div className="px-3 py-10 text-center text-xs text-ink-faint">Ładowanie tematów…</div>
        ) : topics.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-ink-faint">
            Brak tematów. Wpisz pierwszy powyżej i naciśnij Enter.
          </div>
        ) : (
          <>
            <Section
              title="Przypięte"
              count={grouped.pinned.length}
              open
              headerExtra={grouped.active.length === 0 ? sortToggle : undefined}
            >
              {renderRows(grouped.pinned, "pinned")}
            </Section>
            <Section title="Tematy" count={grouped.active.length} open headerExtra={sortToggle}>
              {renderRows(grouped.active, "active")}
            </Section>
            <Section
              title="Odłożone"
              count={grouped.snoozed.length}
              collapsible
              open={showSnoozed}
              onToggle={() => setShowSnoozed((v) => !v)}
            >
              {renderRows(grouped.snoozed, "snoozed")}
            </Section>
            <Section
              title="Zamknięte"
              count={grouped.closed.length}
              collapsible
              open={showClosed}
              onToggle={() => setShowClosed((v) => !v)}
            >
              {renderRows(grouped.closed, "closed")}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
