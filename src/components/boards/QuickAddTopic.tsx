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
      className={`flex h-8 items-center gap-1.5 transition focus-within:border-accent ${
        compact
          ? "rounded-md border border-line/70 bg-surface-raised/60 px-1.5"
          : "rounded-lg border border-line bg-surface-raised px-2"
      }`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Plus size={compact ? 12 : 14} className="shrink-0 text-ink-faint" aria-hidden />
      <input
        value={code}
        maxLength={TOPIC_CODE_MAX}
        enterKeyHint="next"
        onChange={(e) => setCode(e.target.value)}
        placeholder="Kod"
        aria-label={isChild ? "Kod podtematu (opcjonalny)" : "Kod tematu (opcjonalny)"}
        title="Opcjonalny kod, np. N01"
        className={`${compact ? "w-10" : "w-12"} shrink-0 bg-transparent py-0.5 font-mono text-[13px] tabular-nums text-ink outline-none placeholder:font-sans placeholder:text-ink-faint`}
      />
      <span className="h-3.5 w-px shrink-0 bg-line" aria-hidden />
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
        className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] text-ink outline-none placeholder:text-ink-faint"
      />
      {localityEnabled && (
        <>
          <span className="h-3.5 w-px shrink-0 bg-line" aria-hidden />
          <input
            value={locality}
            maxLength={TOPIC_LOCALITY_MAX}
            enterKeyHint="done"
            onChange={(e) => setLocality(e.target.value)}
            placeholder="Miejscowość"
            aria-label="Miejscowość (opcjonalna)"
            title="Opcjonalna miejscowość"
            className={`${compact ? "w-24" : "w-[7rem] sm:w-32"} shrink-0 bg-transparent py-0.5 text-[13px] text-ink outline-none placeholder:text-ink-faint`}
          />
        </>
      )}
      <button
        type="submit"
        disabled={!title.trim()}
        className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-white transition hover:brightness-110 disabled:opacity-40"
      >
        Dodaj
      </button>
    </form>
  );
}
