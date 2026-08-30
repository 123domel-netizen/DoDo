import { useEffect, useState } from "react";
import { BookMarked, ImagePlus, StickyNote } from "lucide-react";
import { cloudEnabled } from "@/lib/supabase";
import { useChatStore } from "@/lib/chat/store";
import { findSelfNotesEntry, notebookDashboardPreview } from "@/lib/chat/feed";
import { loadConversationMessages, openSelfNotes, type SelfNotesOpenIntent } from "@/lib/chat/init";
import { pushRouteHash, setMobileConversationReturn } from "@/lib/navigation";
import { formatConversationLastPreview } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";
import { MobileSectionToggle } from "@/components/mobile/dashboard/MobileSectionToggle";
import { useMobileSectionExpanded } from "@/components/mobile/dashboard/sectionCollapse";

const sectionTitleBtn =
  "inline-flex min-w-0 max-w-full shrink items-center truncate rounded-md border border-line bg-surface-raised/60 px-2 py-1 text-left text-sm font-medium uppercase tracking-wide text-ink-light transition hover:border-line-strong hover:bg-surface-overlay hover:text-ink active:bg-surface-overlay";

const quickActionBtn =
  "inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-grad px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-white shadow-glow transition hover:brightness-110 disabled:opacity-50";

/**
 * Lekka sekcja Notatnika na Przeglądzie (desktop / mobile).
 * Nie ładuje rejestrów — tylko overview + CTA otwarcia.
 */
export function NotebookDashboardSection({
  dense = false,
  layout = "card",
  onOpenNotebook,
}: {
  dense?: boolean;
  layout?: "card" | "mobile";
  onOpenNotebook?: () => void;
}) {
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const profiles = useChatStore((s) => s.profiles);
  const entry = findSelfNotesEntry(overview, myUserId);
  const notebookMessages = useChatStore((s) =>
    entry ? (s.messagesByConv[entry.id] ?? []) : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, toggleExpanded] = useMobileSectionExpanded(
    "notebook",
    false,
  );

  useEffect(() => {
    if (!entry?.id) return;
    void loadConversationMessages(entry.id);
  }, [entry?.id]);

  if (!cloudEnabled || !myUserId) return null;

  const open = (intent?: SelfNotesOpenIntent) => {
    if (busy) return;
    if (onOpenNotebook && !intent) {
      onOpenNotebook();
      return;
    }
    setBusy(true);
    setError(null);
    setMobileConversationReturn("dashboard");
    void openSelfNotes(intent ? { intent } : undefined)
      .then((id) => {
        if (!id) {
          setError(
            "Nie udało się otworzyć Notatnika. Sprawdź połączenie lub migrację bazy.",
          );
          return;
        }
        pushRouteHash({ view: "conversation", conversationId: id });
      })
      .finally(() => setBusy(false));
  };

  const previewSource = notebookDashboardPreview(
    entry ?? { lastMessage: null, lastMessageAt: null },
    notebookMessages,
  );
  const preview = previewSource.message
    ? formatConversationLastPreview(
        previewSource.message,
        profiles[previewSource.message.authorUserId]?.displayName ?? null,
      )
    : null;
  const when = previewSource.at ? formatMessageTime(previewSource.at) : null;
  const empty = !preview;

  if (layout === "mobile") {
    return (
      <section className="border-b border-line p-3 pb-4">
        <div
          className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
            empty && !expanded ? "mb-0" : "mb-1.5"
          }`}
        >
          <BookMarked size={14} className="shrink-0" />
          <button
            type="button"
            onClick={() => open()}
            disabled={busy}
            className={sectionTitleBtn}
            title="Otwórz notatnik"
          >
            Notatnik
          </button>
          <span className="min-w-0 flex-1" aria-hidden />
          {empty && !expanded ? (
            <span className="text-[10px] font-normal normal-case tracking-normal text-ink-faint">
              Pusty
            </span>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => open("compose")}
            className={quickActionBtn}
          >
            <StickyNote size={12} strokeWidth={2.5} />
            Notatka
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => open("gallery")}
            className={quickActionBtn}
          >
            <ImagePlus size={12} strokeWidth={2.5} />
            Galeria
          </button>
          <MobileSectionToggle expanded={expanded} onToggle={toggleExpanded} />
        </div>

        {preview ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => open()}
            className="w-full rounded-lg border border-line/60 bg-surface-raised/30 px-2.5 py-2 text-left transition hover:border-line-strong hover:bg-surface-overlay/60 disabled:opacity-50"
          >
            <div className="truncate text-[13px] text-ink">{preview}</div>
            {when ? (
              <div className="mt-0.5 text-[10px] text-ink-faint">{when}</div>
            ) : null}
          </button>
        ) : null}

        {empty && expanded ? (
          <p className="py-2 text-center text-[12px] text-ink-faint">
            Prywatne miejsce na myśli, decyzje i galerie zdjęć.
          </p>
        ) : null}

        {error ? (
          <p className="mt-2 text-[11px] text-red-400" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

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
          disabled={busy}
          onClick={() => open()}
          className="text-xs font-medium text-accent transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Otwieranie…" : "Otwórz"}
        </button>
      </div>

      {preview ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => open()}
          className="w-full rounded-xl border border-line/70 bg-surface px-3 py-2.5 text-left transition hover:border-line-strong disabled:opacity-50"
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

      {error && (
        <p className="mt-2 text-[11px] text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => open("compose")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-medium text-ink-light transition hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          <StickyNote size={12} />
          Szybka notatka
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => open("gallery")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-medium text-ink-light transition hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          <ImagePlus size={12} />
          Nowa galeria
        </button>
      </div>
    </section>
  );
}
