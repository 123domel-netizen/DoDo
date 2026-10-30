import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, NotebookPen, X } from "lucide-react";
import { useBoardsNow } from "@/hooks/useBoards";
import { fullOrderAfterSectionReorder, groupTopics } from "@/lib/boards/sections";
import { navigateToBoards } from "@/lib/boards/runtime";
import { useBoardsStore } from "@/lib/boards/store";
import type { BoardField, BoardTopic, TopicSection } from "@/lib/boards/types";
import {
  activeFilterChips,
  applyViewSort,
  EMPTY_VIEW_PREFS,
  filterTopicsByFields,
  readViewPrefs,
  sanitizeViewPrefs,
  writeViewPrefs,
  type BoardTopicViewPrefs,
} from "@/lib/boards/topicView";
import { QuickAddTopic } from "@/components/boards/QuickAddTopic";
import { TopicColumnsHeader, TopicRow } from "@/components/boards/TopicRow";
import { CreateBoardDialog } from "@/components/boards/BoardFormDialog";

const EMPTY_TOPICS: BoardTopic[] = [];
const EMPTY_FIELDS: BoardField[] = [];

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
  hideTitle,
  children,
}: {
  title: string;
  count: number;
  collapsible?: boolean;
  open: boolean;
  onToggle?: () => void;
  /** Ukryj belkę tytułu (np. Tematy — kontrolki są w TopicColumnsHeader). */
  hideTitle?: boolean;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mb-1.5">
      {!hideTitle &&
        (collapsible ? (
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
          </div>
        ) : (
          <div className="mb-0.5 flex items-center gap-1 px-2 py-0.5">
            <h3 className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              {title}
            </h3>
          </div>
        ))}
      {open && <ul className="space-y-px">{children}</ul>}
    </section>
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
  const fields = useBoardsStore((s) =>
    s.activeBoardId ? (s.fieldsByBoard[s.activeBoardId] ?? EMPTY_FIELDS) : EMPTY_FIELDS,
  );
  const topicsStatus = useBoardsStore((s) =>
    s.activeBoardId ? s.topicsStatus[s.activeBoardId] : undefined,
  );
  const topicsError = useBoardsStore((s) =>
    s.activeBoardId ? s.topicsError[s.activeBoardId] : undefined,
  );
  const loadBoards = useBoardsStore((s) => s.loadBoards);
  const loadTopics = useBoardsStore((s) => s.loadTopics);
  const loadFields = useBoardsStore((s) => s.loadFields);
  const reorderTopics = useBoardsStore((s) => s.reorderTopics);
  const setNotice = useBoardsStore((s) => s.setNotice);

  const [showSnoozed, setShowSnoozed] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [viewPrefs, setViewPrefs] = useState<BoardTopicViewPrefs>(EMPTY_VIEW_PREFS);
  const [dragSection, setDragSection] = useState<"pinned" | "active" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const board = boards.find((b) => b.id === activeBoardId) ?? null;
  const boardId = board?.id ?? null;

  useEffect(() => {
    if (!boardId) {
      setViewPrefs(EMPTY_VIEW_PREFS);
      return;
    }
    setViewPrefs(readViewPrefs(boardId));
  }, [boardId]);

  const prefs = useMemo(() => sanitizeViewPrefs(viewPrefs, fields), [viewPrefs, fields]);

  const changePrefs = useCallback(
    (next: BoardTopicViewPrefs) => {
      if (!boardId) return;
      const clean = sanitizeViewPrefs(next, fields);
      setViewPrefs(clean);
      writeViewPrefs(boardId, clean);
      setDragSection(null);
      setDragId(null);
      setOverId(null);
    },
    [boardId, fields],
  );

  const now = useBoardsNow(topics);
  const filteredTopics = useMemo(
    () => filterTopicsByFields(topics, fields, prefs.filters),
    [topics, fields, prefs.filters],
  );
  const grouped = useMemo(() => {
    const base = groupTopics(
      filteredTopics,
      now,
      prefs.sort.mode === "code" ? "code" : "manual",
    );
    if (prefs.sort.mode !== "field") return base;
    return applyViewSort(base, prefs.sort, fields);
  }, [filteredTopics, now, prefs.sort, fields]);

  // DnD tylko w trybie ręcznym bez filtrów (inaczej permutacja sekcji ≠ pełna lista).
  const columnFields = useMemo(
    () => prefs.columnIds.map((id) => fields.find((f) => f.id === id)).filter(Boolean) as BoardField[],
    [prefs.columnIds, fields],
  );
  const chips = useMemo(
    () => activeFilterChips(prefs.filters, fields),
    [prefs.filters, fields],
  );
  // DnD tylko w trybie ręcznym bez filtrów (inaczej permutacja sekcji ≠ pełna lista).
  const canDrag = prefs.sort.mode === "manual" && chips.length === 0;

  useEffect(() => {
    if (boardsStatus !== "ready" || boards.length === 0) return;
    if (!activeBoardId || !boards.some((b) => b.id === activeBoardId)) {
      navigateToBoards({ boardId: boards[0]!.id });
    }
  }, [boardsStatus, boards, activeBoardId]);

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
      // Reorder against full (unfiltered) topic set so filtered-out topics keep place.
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
        columnFields={columnFields}
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

  const loadingTopics = !topicsStatus || (topicsStatus === "loading" && topics.length === 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-1.5 pt-2">
        <QuickAddTopic key={board.id} boardId={board.id} autoFocus={!mobile} />
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {chips.map((c) => (
              <button
                key={`${c.fieldId}:${c.optionId}`}
                type="button"
                onClick={() => {
                  const next = { ...prefs.filters };
                  const ids = (next[c.fieldId] ?? []).filter((id) => id !== c.optionId);
                  if (ids.length === 0) delete next[c.fieldId];
                  else next[c.fieldId] = ids;
                  changePrefs({ ...prefs, filters: next });
                }}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-raised px-1.5 py-0.5 text-[10px] text-ink-light transition hover:border-line-strong hover:text-ink"
                title="Usuń filtr"
              >
                <span className="text-ink-faint">{c.fieldName}:</span> {c.label}
                <X size={10} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => changePrefs({ ...prefs, filters: {} })}
              className="px-1.5 text-[10px] text-ink-faint hover:text-ink-light"
            >
              Wyczyść
            </button>
          </div>
        )}
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
        ) : filteredTopics.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-ink-faint">
            Żaden temat nie pasuje do filtrów.{" "}
            <button
              type="button"
              onClick={() => changePrefs({ ...prefs, filters: {} })}
              className="text-accent hover:underline"
            >
              Wyczyść filtry
            </button>
          </div>
        ) : (
          <>
            <TopicColumnsHeader
              columnFields={columnFields}
              allFields={fields}
              prefs={prefs}
              onChange={changePrefs}
            />
            <Section title="Przypięte" count={grouped.pinned.length} open>
              {renderRows(grouped.pinned, "pinned")}
            </Section>
            <Section title="Tematy" count={grouped.active.length} open hideTitle>
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
