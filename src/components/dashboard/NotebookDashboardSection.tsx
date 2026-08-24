import { BookMarked, ImagePlus, StickyNote } from "lucide-react";
import { cloudEnabled } from "@/lib/supabase";
import { useChatStore } from "@/lib/chat/store";
import { findSelfNotesEntry } from "@/lib/chat/feed";
import { openSelfNotes } from "@/lib/chat/init";
import { pushRouteHash } from "@/lib/navigation";
import { formatConversationLastPreview } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";

/**
 * Lekka sekcja Notatnika na Przeglądzie (desktop / mobile).
 * Nie ładuje rejestrów — tylko overview + CTA otwarcia.
 */
export function NotebookDashboardSection({ dense = false }: { dense?: boolean }) {
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const profiles = useChatStore((s) => s.profiles);
  const entry = findSelfNotesEntry(overview, myUserId);

  if (!cloudEnabled || !myUserId) return null;

  const open = () => {
    void openSelfNotes().then((id) => {
      if (!id) return;
      pushRouteHash({ view: "conversation", conversationId: id });
    });
  };

  const preview = entry?.lastMessage
    ? formatConversationLastPreview(
        entry.lastMessage,
        profiles[entry.lastMessage.authorUserId]?.displayName ?? null,
      )
    : null;
  const when = entry?.lastMessageAt
    ? formatMessageTime(entry.lastMessageAt)
    : null;

  return (
    <section
      className={
        dense
          ? "rounded-xl border border-line bg-surface-raised/40 p-3"
          : "mb-5 overflow-hidden rounded-2xl border border-line bg-surface-raised/40 p-4 sm:p-5"
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          <BookMarked size={15} className="shrink-0 text-accent" />
          Notatnik
        </div>
        <button
          type="button"
          onClick={open}
          className="text-xs font-medium text-accent transition hover:brightness-110"
        >
          Otwórz
        </button>
      </div>

      {preview ? (
        <button
          type="button"
          onClick={open}
          className="w-full rounded-xl border border-line/70 bg-surface px-3 py-2.5 text-left transition hover:border-line-strong"
        >
          <div className="truncate text-sm text-ink">{preview}</div>
          {when && (
            <div className="mt-0.5 text-[11px] text-ink-faint">{when}</div>
          )}
        </button>
      ) : (
        <p className="mb-2 text-sm text-ink-faint">
          Prywatne miejsce na myśli, decyzje i galerie zdjęć.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={open}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
        >
          <StickyNote size={12} />
          Szybka notatka
        </button>
        <button
          type="button"
          onClick={open}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
        >
          <ImagePlus size={12} />
          Nowa galeria
        </button>
      </div>
    </section>
  );
}
