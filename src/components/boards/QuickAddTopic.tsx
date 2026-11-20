import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useBoardsStore } from "@/lib/boards/store";
import { TOPIC_CODE_MAX, TOPIC_LOCALITY_MAX, TOPIC_TITLE_MAX } from "@/lib/boards/types";
import type { TopicTextQuery } from "@/lib/boards/topicView";

/**
 * Pasek tematu: pisanie filtruje listę (gdy podano onQueryChange);
 * dodanie tylko po kliknięciu „Dodaj” — Enter nie tworzy tematu.
 */
export function QuickAddTopic({
  boardId,
  parentId = null,
  autoFocus = false,
  compact = false,
  onAdded,
  onQueryChange,
}: {
  boardId: string;
  parentId?: string | null;
  autoFocus?: boolean;
  /** Węższy wariant pod listą podtematów. */
  compact?: boolean;
  onAdded?: () => void;
  /** Live-wyszukiwanie listy tematów (główny pasek tablicy). */
  onQueryChange?: (query: TopicTextQuery) => void;
}) {
  const addTopic = useBoardsStore((s) => s.addTopic);
  const localityEnabled = useBoardsStore(
    (s) => s.boards.find((b) => b.id === boardId)?.localityEnabled ?? false,
  );

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [locality, setLocality] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  const emitQuery = (next: { code: string; title: string; locality: string }) => {
    onQueryChange?.(next);
  };

  const submit = () => {
    if (!title.trim()) return;
    const id = addTopic(
      boardId,
      title,
      code,
      localityEnabled ? locality : undefined,
      parentId,
    );
    if (!id) return;
    setCode("");
    setTitle("");
    setLocality("");
    emitQuery({ code: "", title: "", locality: "" });
    onAdded?.();
    titleRef.current?.focus();
  };

  const isChild = Boolean(parentId);

  return (
    <form
      className={`flex h-8 items-center gap-1.5 transition focus-within:border-accent ${
        compact
          ? "rounded-md border border-line/70 bg-surface-raised/60 px-1.5"
          : "rounded-lg border border-line bg-surface-raised px-2"
      }`}
      onSubmit={(e) => {
        // Enter w polach nie dodaje — tylko przycisk „Dodaj”.
        e.preventDefault();
      }}
    >
      <Plus size={compact ? 12 : 14} className="shrink-0 text-ink-faint" aria-hidden />
      <input
        value={code}
        maxLength={TOPIC_CODE_MAX}
        enterKeyHint="search"
        onChange={(e) => {
          const next = e.target.value;
          setCode(next);
          emitQuery({ code: next, title, locality });
        }}
        placeholder="Kod"
        aria-label={isChild ? "Kod podtematu (opcjonalny)" : "Szukaj lub kod tematu"}
        title="Szukaj po kodzie lub podaj kod nowego tematu"
        className={`${compact ? "w-10" : "w-12"} shrink-0 bg-transparent py-0.5 font-mono text-[13px] tabular-nums text-ink outline-none placeholder:font-sans placeholder:text-ink-faint`}
      />
      <span className="h-3.5 w-px shrink-0 bg-line" aria-hidden />
      <input
        ref={titleRef}
        value={title}
        autoFocus={autoFocus}
        maxLength={TOPIC_TITLE_MAX}
        enterKeyHint="search"
        onChange={(e) => {
          const next = e.target.value;
          setTitle(next);
          emitQuery({ code, title: next, locality });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        placeholder={isChild ? "Dodaj podtemat…" : "Szukaj lub dodaj temat…"}
        aria-label={isChild ? "Dodaj podtemat" : "Szukaj lub dodaj temat"}
        className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] text-ink outline-none placeholder:text-ink-faint"
      />
      {localityEnabled && (
        <>
          <span className="h-3.5 w-px shrink-0 bg-line" aria-hidden />
          <input
            value={locality}
            maxLength={TOPIC_LOCALITY_MAX}
            enterKeyHint="search"
            onChange={(e) => {
              const next = e.target.value;
              setLocality(next);
              emitQuery({ code, title, locality: next });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            placeholder="Miejscowość"
            aria-label="Szukaj lub miejscowość"
            title="Szukaj po miejscowości lub podaj ją dla nowego tematu"
            className={`${compact ? "w-24" : "w-[7rem] sm:w-32"} shrink-0 bg-transparent py-0.5 text-[13px] text-ink outline-none placeholder:text-ink-faint`}
          />
        </>
      )}
      <button
        type="button"
        disabled={!title.trim()}
        onClick={submit}
        className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-white transition hover:brightness-110 disabled:opacity-40"
      >
        Dodaj
      </button>
    </form>
  );
}
