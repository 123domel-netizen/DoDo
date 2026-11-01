import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useBoardsStore } from "@/lib/boards/store";
import { TOPIC_CODE_MAX, TOPIC_LOCALITY_MAX, TOPIC_TITLE_MAX } from "@/lib/boards/types";

/**
 * Szybkie dodawanie tematów / podtematów: opcjonalny kod + tytuł (+ miejscowość).
 * Enter dodaje, pola się czyszczą i fokus wraca do tytułu.
 */
export function QuickAddTopic({
  boardId,
  parentId = null,
  autoFocus = false,
  compact = false,
  onAdded,
}: {
  boardId: string;
  parentId?: string | null;
  autoFocus?: boolean;
  /** Węższy wariant pod listą podtematów. */
  compact?: boolean;
  onAdded?: () => void;
}) {
  const addTopic = useBoardsStore((s) => s.addTopic);
  const localityEnabled = useBoardsStore(
    (s) => s.boards.find((b) => b.id === boardId)?.localityEnabled ?? false,
  );

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [locality, setLocality] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

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
    onAdded?.();
    titleRef.current?.focus();
  };

  const isChild = Boolean(parentId);

  return (
    <form
      className={`flex items-center gap-1.5 transition focus-within:border-accent ${
        compact
          ? "rounded-lg border border-line/70 bg-surface-raised/60 px-2 py-1"
          : "rounded-xl border border-line bg-surface-raised px-2.5 py-1.5"
      }`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Plus size={compact ? 13 : 15} className="shrink-0 text-ink-faint" aria-hidden />
      <input
        value={code}
        maxLength={TOPIC_CODE_MAX}
        enterKeyHint="next"
        onChange={(e) => setCode(e.target.value)}
        placeholder="Kod"
        aria-label={isChild ? "Kod podtematu (opcjonalny)" : "Kod tematu (opcjonalny)"}
        title="Opcjonalny kod, np. N01"
        className={`${compact ? "w-10" : "w-14"} shrink-0 bg-transparent py-1 font-mono text-sm tabular-nums text-ink outline-none placeholder:font-sans placeholder:text-ink-faint`}
      />
      <span className="h-4 w-px shrink-0 bg-line" aria-hidden />
      <input
        ref={titleRef}
        value={title}
        autoFocus={autoFocus}
        maxLength={TOPIC_TITLE_MAX}
        enterKeyHint={localityEnabled ? "next" : "done"}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
        }}
        placeholder={isChild ? "Dodaj podtemat…" : "Dodaj temat…"}
        aria-label={isChild ? "Dodaj podtemat" : "Dodaj temat"}
        className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
      />
      {localityEnabled && (
        <>
          <span className="h-4 w-px shrink-0 bg-line" aria-hidden />
          <input
            value={locality}
            maxLength={TOPIC_LOCALITY_MAX}
            enterKeyHint="done"
            onChange={(e) => setLocality(e.target.value)}
            placeholder="Miejscowość"
            aria-label="Miejscowość (opcjonalna)"
            title="Opcjonalna miejscowość"
            className={`${compact ? "w-24" : "w-[7.5rem] sm:w-36"} shrink-0 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint`}
          />
        </>
      )}
      <button
        type="submit"
        disabled={!title.trim()}
        className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-40"
      >
        Dodaj
      </button>
    </form>
  );
}
