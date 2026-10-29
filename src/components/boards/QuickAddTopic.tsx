import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useBoardsStore } from "@/lib/boards/store";
import { TOPIC_TITLE_MAX } from "@/lib/boards/types";

/**
 * Szybkie dodawanie tematów: Enter dodaje temat, pole się czyści i zachowuje fokus,
 * więc można wpisać kilka tematów pod rząd. Temat pojawia się natychmiast (zapis w tle).
 */
export function QuickAddTopic({ boardId, autoFocus = false }: { boardId: string; autoFocus?: boolean }) {
  const addTopic = useBoardsStore((s) => s.addTopic);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!value.trim()) return;
    addTopic(boardId, value);
    setValue("");
    inputRef.current?.focus();
  };

  return (
    <form
      className="flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 transition focus-within:border-accent"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Plus size={15} className="shrink-0 text-ink-faint" aria-hidden />
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        maxLength={TOPIC_TITLE_MAX}
        enterKeyHint="done"
        onChange={(e) => setValue(e.target.value)}
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
        disabled={!value.trim()}
        className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-40"
      >
        Dodaj
      </button>
    </form>
  );
}
