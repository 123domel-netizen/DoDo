import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, NotebookPen, X } from "lucide-react";
import { useBoardsNow } from "@/hooks/useBoards";
import { groupTopics } from "@/lib/boards/sections";
import { navigateToBoards } from "@/lib/boards/runtime";
import { useBoardsStore } from "@/lib/boards/store";
import type { BoardTopic, TopicSection } from "@/lib/boards/types";
import { QuickAddTopic } from "@/components/boards/QuickAddTopic";
import { TopicRow } from "@/components/boards/TopicRow";
import { CreateBoardDialog } from "@/components/boards/BoardFormDialog";

const EMPTY_TOPICS: BoardTopic[] = [];

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
  children,
}: {
  title: string;
  count: number;
  collapsible?: boolean;
  open: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mb-3">
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="mb-1 flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint transition hover:text-ink-light"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {title} <span className="font-normal">({count})</span>
        </button>
      ) : (
        <h3 className="mb-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {title}
        </h3>
      )}
      {open && <ul className="space-y-0.5">{children}</ul>}
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
  const topicsStatus = useBoardsStore((s) =>
    s.activeBoardId ? s.topicsStatus[s.activeBoardId] : undefined,
  );
  const topicsError = useBoardsStore((s) =>
    s.activeBoardId ? s.topicsError[s.activeBoardId] : undefined,
  );
  const loadBoards = useBoardsStore((s) => s.loadBoards);
  const loadTopics = useBoardsStore((s) => s.loadTopics);

  const [showSnoozed, setShowSnoozed] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);

  const board = boards.find((b) => b.id === activeBoardId) ?? null;
  const now = useBoardsNow(topics);
  const grouped = useMemo(() => groupTopics(topics, now), [topics, now]);

  // Brak wybranej tablicy (np. start, usunięta) → pierwsza z listy.
  useEffect(() => {
    if (boardsStatus !== "ready" || boards.length === 0) return;
    if (!activeBoardId || !boards.some((b) => b.id === activeBoardId)) {
      navigateToBoards({ boardId: boards[0]!.id });
    }
  }, [boardsStatus, boards, activeBoardId]);

  const boardId = board?.id ?? null;
  useEffect(() => {
    if (boardId) void loadTopics(boardId);
  }, [boardId, loadTopics]);

  const openTopic = (topic: BoardTopic) => {
    navigateToBoards({ boardId: topic.boardId, topicId: topic.id }, mobile ? "push" : "replace");
  };

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

  const renderRows = (list: BoardTopic[], section: TopicSection) =>
    list.map((t) => (
      <TopicRow
        key={t.id}
        topic={t}
        board={board}
        section={section}
        now={now}
        active={t.id === activeTopicId}
        onOpen={openTopic}
      />
    ));

  const loadingTopics = !topicsStatus || (topicsStatus === "loading" && topics.length === 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <QuickAddTopic key={board.id} boardId={board.id} autoFocus={!mobile} />
      </div>
      <BoardsNotice />
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar px-2 pb-4">
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
            <Section title="Przypięte" count={grouped.pinned.length} open>
              {renderRows(grouped.pinned, "pinned")}
            </Section>
            <Section title="Tematy" count={grouped.active.length} open>
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
