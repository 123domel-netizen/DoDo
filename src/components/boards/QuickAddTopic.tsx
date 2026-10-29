import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useBoardsStore } from "@/lib/boards/store";
import { TOPIC_CODE_MAX, TOPIC_TITLE_MAX } from "@/lib/boards/types";

/**
 * Szybkie dodawanie tematów: opcjonalny kod + tytuł. Enter dodaje temat,
 * pola się czyszczą i fokus wraca do tytułu — można wpisać kilka pod rząd.
 */
export function QuickAddTopic({ boardId, autoFocus = false }: { boardId: string; autoFocus?: boolean }) {
  const addTopic = useBoardsStore((s) => s.addTopic);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!title.trim()) return;
    addTopic(boardId, title, code);
    setCode("");
    setTitle("");
    titleRef.current?.focus();
  };

  return (
    <form
      className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 transition focus-within:border-accent"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Plus size={15} className="shrink-0 text-ink-faint" aria-hidden />
      <input
        value={code}
        maxLength={TOPIC_CODE_MAX}
        enterKeyHint="next"
        onChange={(e) => setCode(e.target.value)}
        placeholder="Kod"
        aria-label="Kod tematu (opcjonalny)"
        title="Opcjonalny kod, np. N01"
        className="w-14 shrink-0 bg-transparent py-1 font-mono text-sm tabular-nums text-ink outline-none placeholder:font-sans placeholder:text-ink-faint"
      />
      <span className="h-4 w-px shrink-0 bg-line" aria-hidden />
      <input
        ref={titleRef}
        value={title}
        autoFocus={autoFocus}
        maxLength={TOPIC_TITLE_MAX}
        enterKeyHint="done"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          // Enter w trakcie kompozycji IME (np. podpowiedź) nie dodaje tematu.
          if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
        }}
        placeholder="Dodaj temat…"
        aria-label="Dodaj temat"
        className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
      />
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
