import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/** Popularne emotki do wstawiania w composerze (bez zewnętrznej zależności). */
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Częste",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😉",
      "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😋", "😜",
      "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐",
      "😑", "😶", "😏", "😒", "🙄", "😬", "😮‍💨", "🤥", "😌", "😔",
      "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🥵", "🥶",
      "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓", "🧐", "😕", "😟",
      "🙁", "☹️", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨",
      "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩",
      "😫", "🥱", "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "☠️",
    ],
  },
  {
    label: "Gestykulacja",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞",
      "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍",
      "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝",
      "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🦵", "🦶", "👂", "👃",
    ],
  },
  {
    label: "Serca i symbole",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "✅",
      "❌", "⭐", "🌟", "💫", "✨", "🔥", "💥", "💢", "💦", "💨",
      "💬", "💭", "💤", "🔔", "💯", "🔴", "🟠", "🟡", "🟢", "🔵",
    ],
  },
  {
    label: "Obiekty",
    emojis: [
      "🎉", "🎊", "🎈", "🎁", "🏆", "🥇", "🥈", "🥉", "⚽", "🏀",
      "🎯", "🎮", "🎲", "🧩", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹",
      "📱", "💻", "⌨️", "🖥️", "📷", "📸", "💡", "💰", "💳", "💎",
      "🔧", "🔑", "📌", "📍", "📎", "✂️", "🗑️", "🔒", "🔓", "📦",
    ],
  },
  {
    label: "Jedzenie",
    emojis: [
      "🍎", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🍒", "🍑", "🥭",
      "🍍", "🥝", "🍅", "🥑", "🥕", "🌽", "🌶️", "🥦", "🍞", "🥐",
      "🧀", "🍔", "🍟", "🍕", "🌭", "🌮", "🌯", "🥗", "🍝", "🍜",
      "🍣", "🍱", "🍦", "🍩", "🍪", "🎂", "🍰", "☕", "🍵", "🧃",
      "🍺", "🍻", "🥂", "🍷", "🍸", "🍹", "🧋", "🧉", "🍾", "🧊",
    ],
  },
];

interface EmojiPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
}

export function EmojiPicker({ open, onClose, onPick }: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const visible = q
    ? EMOJI_GROUPS.filter((g) => g.label.toLowerCase().includes(q))
    : EMOJI_GROUPS;
  const groups = visible.length ? visible : EMOJI_GROUPS;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default"
        aria-label="Zamknij emotikony"
        onClick={onClose}
      />
      <div
        className="absolute bottom-full right-0 z-50 mb-1 flex h-72 w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface-overlay shadow-pop"
        role="dialog"
        aria-label="Emotikony"
      >
        <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
          <Search size={13} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj kategorii…"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={14} />
          </button>
        </div>
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          {groups.map((g) => (
            <div key={g.label} className="mb-2">
              <p className="mb-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                {g.label}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {g.emojis.map((emoji) => (
                  <button
                    key={`${g.label}-${emoji}`}
                    type="button"
                    title={emoji}
                    onClick={() => onPick(emoji)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition hover:bg-surface-raised"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
