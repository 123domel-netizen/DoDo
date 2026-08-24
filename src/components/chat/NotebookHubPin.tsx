import { BookMarked } from "lucide-react";
import { cloudEnabled } from "@/lib/supabase";
import { useChatStore } from "@/lib/chat/store";
import { findSelfNotesEntry } from "@/lib/chat/feed";
import { openSelfNotes } from "@/lib/chat/init";
import { pushRouteHash } from "@/lib/navigation";
import { formatConversationLastPreview } from "@/lib/chat/types";

/** Przypięty kafelek Notatnika nad listą rozmów (hub desktop / mobile). */
export function NotebookHubPin({
  compact = false,
  onOpened,
}: {
  compact?: boolean;
  onOpened?: () => void;
}) {
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const profiles = useChatStore((s) => s.profiles);
  const activeId = useChatStore((s) => s.activeConversationId);
  const entry = findSelfNotesEntry(overview, myUserId);
  const active = Boolean(entry && entry.id === activeId);

  if (!cloudEnabled || !myUserId) return null;

  const preview = entry?.lastMessage
    ? formatConversationLastPreview(
        entry.lastMessage,
        profiles[entry.lastMessage.authorUserId]?.displayName ?? null,
      )
    : "Prywatne notatki, decyzje i galerie";

  const open = () => {
    void openSelfNotes().then((id) => {
      if (!id) return;
      pushRouteHash({ view: "conversation", conversationId: id });
      onOpened?.();
    });
  };

  return (
    <button
      type="button"
      onClick={open}
      className={`flex w-full items-center gap-2.5 border-b border-line/60 px-3 text-left transition ${
        compact ? "py-2" : "py-2.5"
      } ${
        active
          ? "bg-accent/10 text-ink"
          : "text-ink hover:bg-surface-raised"
      }`}
      aria-label="Notatnik"
    >
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent ${
          compact ? "h-8 w-8" : "h-9 w-9"
        }`}
      >
        <BookMarked size={compact ? 15 : 17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">Notatnik</span>
        {!compact && (
          <span className="block truncate text-[11px] text-ink-faint">{preview}</span>
        )}
      </span>
    </button>
  );
}
