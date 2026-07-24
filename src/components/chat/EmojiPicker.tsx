import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Film, Search, X } from "lucide-react";

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
  /** Otwórz wyszukiwarkę GIF (zamyka panel emotek). */
  onOpenGifs?: () => void;
}

export function EmojiPicker({ open, onClose, onPick, onOpenGifs }: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    // Na telefonie nie focusuj wyszukiwarki — klawiatura zasłania panel.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse) return;
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

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij emotikony"
        onClick={onClose}
      />
      <div
        className="relative flex h-[min(24rem,70vh)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-line bg-surface-overlay shadow-pop sm:h-80 sm:rounded-2xl"
        role="dialog"
        aria-label="Emotikony"
      >
        <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-2">
          {onOpenGifs && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenGifs();
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-accent/40 bg-accent/20 px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:border-accent/60 hover:bg-accent/30"
            >
              <Film size={13} />
              GIFy
            </button>
          )}
          <Search size={14} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj kategorii…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={16} />
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
                    className="flex h-9 w-full items-center justify-center rounded-lg text-xl transition hover:bg-surface-raised active:bg-surface-raised"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
