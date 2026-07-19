import { useEffect, useMemo, useState } from "react";
import {
  Gavel,
  Layers,
  MessageSquare,
  Pin,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import {
  fetchDecisions,
  fetchNotes,
  fetchThreadsList,
} from "@/lib/chat/api";
import { threadDisplayTitle } from "@/lib/chat/feed";
import type { ChatProfile, ThreadListEntry } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";

type Tab = "threads" | "decisions" | "notes";

interface RegistryRow {
  id: string;
  kind: "decisions" | "notes";
  title?: string;
  body: string;
  messageId: string | null;
  authorId: string;
  at: string;
}

interface ChatContextColumnProps {
  conversationId: string | null;
  profiles: Record<string, ChatProfile>;
  onOpenThread: (rootId: string) => void;
  onJumpTo: (messageId: string) => void;
}

const TABS: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
  { id: "threads", label: "Wątki", icon: MessageSquare },
  { id: "decisions", label: "Decyzje", icon: Gavel },
  { id: "notes", label: "Notatki", icon: StickyNote },
];

function matchesQuery(haystack: string, q: string): boolean {
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

/** Środkowa kolumna czatu: wątki / decyzje / notatki + wyszukiwarka. */
export function ChatContextColumn({
  conversationId,
  profiles,
  onOpenThread,
  onJumpTo,
}: ChatContextColumnProps) {
  const [tab, setTab] = useState<Tab>("threads");
  const [threads, setThreads] = useState<ThreadListEntry[] | null>(null);
  const [decisions, setDecisions] = useState<RegistryRow[] | null>(null);
  const [notes, setNotes] = useState<RegistryRow[] | null>(null);
  const [query, setQuery] = useState("");
  /** false = filtr bieżącej zakładki; true = wspólne wyniki ze wszystkich. */
  const [searchAll, setSearchAll] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setThreads(null);
      setDecisions(null);
      setNotes(null);
      setQuery("");
      return;
    }
    let cancelled = false;
    setThreads(null);
    setDecisions(null);
    setNotes(null);

    void Promise.all([
      fetchThreadsList(conversationId),
      fetchDecisions(conversationId),
      fetchNotes(conversationId),
    ]).then(([t, d, n]) => {
      if (cancelled) return;
      setThreads(t);
      setDecisions(
        d.map((row) => ({
          id: row.id,
          kind: "decisions" as const,
          body: row.body,
          messageId: row.messageId,
          authorId: row.createdBy,
          at: row.decidedAt,
        })),
      );
      setNotes(
        n.map((row) => ({
          id: row.id,
          kind: "notes" as const,
          title: row.title,
          body: row.body,
          messageId: row.messageId,
          authorId: row.createdBy,
          at: row.notedAt,
        })),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const q = query.trim().toLowerCase();

  const filteredThreads = useMemo(() => {
    if (!threads) return null;
    if (!q) return threads;
    return threads.filter(({ root }) => {
      const title = root.deletedAt ? "" : threadDisplayTitle(root);
      const author = profiles[root.authorUserId]?.displayName || "";
      return matchesQuery(`${title} ${root.body} ${author}`, q);
    });
  }, [threads, q, profiles]);

  const filteredDecisions = useMemo(() => {
    if (!decisions) return null;
    if (!q) return decisions;
    return decisions.filter((row) => {
      const author = profiles[row.authorId]?.displayName || "";
      return matchesQuery(`${row.body} ${author}`, q);
    });
  }, [decisions, q, profiles]);

  const filteredNotes = useMemo(() => {
    if (!notes) return null;
    if (!q) return notes;
    return notes.filter((row) => {
      const author = profiles[row.authorId]?.displayName || "";
      return matchesQuery(`${row.title ?? ""} ${row.body} ${author}`, q);
    });
  }, [notes, q, profiles]);

  if (!conversationId) {
    return (
      <div className="flex h-full items-center justify-center px-3 text-center text-[11px] leading-relaxed text-ink-faint">
        Wybierz rozmowę, aby zobaczyć wątki, decyzje i notatki.
      </div>
    );
  }

  const loading = threads === null || decisions === null || notes === null;
  const showCombined = searchAll && Boolean(q);

  const renderThread = ({ root, replyCount }: ThreadListEntry) => (
    <button
      key={`t-${root.id}`}
      type="button"
      onClick={() => onOpenThread(root.id)}
      className="rounded-lg border border-line/70 bg-surface-raised/50 px-2 py-1.5 text-left transition hover:border-line-strong hover:bg-surface-raised"
    >
      <div className="flex items-center gap-1 text-[9px] text-ink-faint">
        {root.pinnedAt && <Pin size={9} className="text-accent" />}
        {showCombined && <span className="text-accent">Wątek</span>}
        <span className="min-w-0 flex-1 truncate">
          {profiles[root.authorUserId]?.displayName || "Nieznany"}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-accent">
          <MessageSquare size={9} /> {replyCount}
        </span>
      </div>
      <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink">
        {root.deletedAt ? "Wiadomość usunięta" : threadDisplayTitle(root)}
      </div>
    </button>
  );

  const renderRegistry = (row: RegistryRow) => (
    <button
      key={`${row.kind}-${row.id}`}
      type="button"
      onClick={() => row.messageId && onJumpTo(row.messageId)}
      disabled={!row.messageId}
      className="rounded-lg border border-line/70 bg-surface-raised/50 px-2 py-1.5 text-left transition hover:border-line-strong hover:bg-surface-raised disabled:cursor-default disabled:opacity-70"
    >
      {showCombined && (
        <div className="mb-0.5 text-[9px] font-medium text-accent">
          {row.kind === "decisions" ? "Decyzja" : "Notatka"}
        </div>
      )}
      <div className="line-clamp-3 text-[11px] leading-snug text-ink">
        {row.kind === "notes" && row.title ? (
          <>
            <span className="font-medium">{row.title}</span>
            {row.body.trim() && row.body.trim() !== row.title.trim() ? (
              <span className="text-ink-faint"> — {row.body}</span>
            ) : null}
          </>
        ) : (
          row.body
        )}
      </div>
      <div className="mt-0.5 truncate text-[9px] text-ink-faint">
        {profiles[row.authorId]?.displayName || "Nieznany"} · {formatMessageTime(row.at)}
      </div>
    </button>
  );

  const emptyForTab =
    tab === "threads" ? "Brak wątków." : tab === "decisions" ? "Brak decyzji." : "Brak notatek.";

  const tabList =
    tab === "threads"
      ? filteredThreads
      : tab === "decisions"
        ? filteredDecisions
        : filteredNotes;

  const combinedEmpty =
    (filteredThreads?.length ?? 0) === 0 &&
    (filteredDecisions?.length ?? 0) === 0 &&
    (filteredNotes?.length ?? 0) === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-0.5 border-b border-line p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              if (!q) setSearchAll(false);
            }}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1 text-[10px] font-medium transition ${
              tab === id && !showCombined
                ? "bg-accent/15 text-ink"
                : "text-ink-faint hover:bg-surface-raised hover:text-ink"
            }`}
            title={label}
          >
            <Icon size={11} />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-line px-1.5 py-1">
        <div className="relative min-w-0 flex-1">
          <Search
            size={11}
            className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              searchAll ? "Szukaj we wszystkim…" : `Szukaj w ${TABS.find((t) => t.id === tab)?.label.toLowerCase()}…`
            }
            className="w-full rounded-md border border-line bg-surface py-1 pl-6 pr-6 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              aria-label="Wyczyść"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSearchAll((v) => !v)}
          className={`shrink-0 rounded-md border p-1.5 transition ${
            searchAll
              ? "border-accent/50 bg-accent/15 text-accent"
              : "border-line text-ink-faint hover:border-line-strong hover:text-ink"
          }`}
          title={
            searchAll
              ? "Szukasz we wszystkich (wątki + decyzje + notatki)"
              : "Szukaj we wszystkich zakładkach"
          }
          aria-label="Szukaj we wszystkich"
          aria-pressed={searchAll}
        >
          <Layers size={12} />
        </button>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading && (
          <div className="py-6 text-center text-[11px] text-ink-faint">Wczytywanie…</div>
        )}

        {!loading && showCombined && (
          <>
            {combinedEmpty ? (
              <div className="px-2 py-6 text-center text-[11px] text-ink-faint">
                Brak wyników dla „{query.trim()}”.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filteredThreads?.map(renderThread)}
                {filteredDecisions?.map(renderRegistry)}
                {filteredNotes?.map(renderRegistry)}
              </div>
            )}
          </>
        )}

        {!loading && !showCombined && (
          <>
            {tabList?.length === 0 && (
              <div className="px-2 py-6 text-center text-[11px] leading-relaxed text-ink-faint">
                {q ? `Brak wyników dla „${query.trim()}”.` : emptyForTab}
              </div>
            )}
            <div className="flex flex-col gap-1">
              {tab === "threads" &&
                filteredThreads?.map((row) => renderThread(row))}
              {tab === "decisions" &&
                filteredDecisions?.map((row) => renderRegistry(row))}
              {tab === "notes" && filteredNotes?.map((row) => renderRegistry(row))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
