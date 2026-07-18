import { useState } from "react";
import {
  ArrowLeft,
  CalendarPlus,
  CheckSquare,
  ExternalLink,
  Gavel,
  ListChecks,
  StickyNote,
  Trash2,
} from "lucide-react";
import { deleteDecision, deleteNote } from "@/lib/chat/api";
import {
  beginConvertToItem,
  decisionToNote,
  noteToDecision,
  type ConvertTarget,
} from "@/lib/chat/convert";
import {
  closeChatDetailPanel,
  jumpToMessage,
  openConversation,
  showTodoInPanel,
} from "@/lib/chat/init";
import { useChatStore } from "@/lib/chat/store";
import { overviewTitle } from "@/lib/chat/feed";
import { useStore } from "@/state/store";
import { formatMessageTime } from "@/components/chat/MessageBubble";
import { setRouteHash } from "@/lib/navigation";

/**
 * Detal decyzji/notatki w prawym panelu (hub → klik).
 */
export function RegistryDetailPanel() {
  const focus = useChatStore((s) => s.registryFocus);
  const profiles = useChatStore((s) => s.profiles);
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const bumpRegistryEpoch = useChatStore((s) => s.bumpRegistryEpoch);
  const items = useStore((s) => s.items);
  const [busy, setBusy] = useState(false);

  if (!focus) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-faint">
        Wybierz wpis z listy w hubie.
      </div>
    );
  }

  const isDecision = focus.kind === "decision";
  const conv = overview.find((c) => c.id === focus.conversationId);
  const convTitle = conv
    ? overviewTitle(conv, myUserId, (id) => items[id]?.title)
    : "Rozmowa";

  const remove = async () => {
    if (!confirm(isDecision ? "Usunąć decyzję z rejestru?" : "Usunąć notatkę?")) return;
    setBusy(true);
    const { error } = isDecision
      ? await deleteDecision(focus.id)
      : await deleteNote(focus.id);
    setBusy(false);
    if (error) {
      alert(error);
      return;
    }
    bumpRegistryEpoch();
    closeChatDetailPanel();
  };

  const convertToItem = (target: ConvertTarget) => {
    beginConvertToItem(
      {
        body: focus.body,
        conversationId: focus.conversationId,
        messageId: focus.messageId,
        authorName: profiles[focus.createdBy]?.displayName || "uczestnika rozmowy",
      },
      target,
    );
  };

  const crossConvert = async () => {
    setBusy(true);
    const { error } = isDecision
      ? await decisionToNote({
          id: focus.id,
          conversationId: focus.conversationId,
          messageId: focus.messageId,
          body: focus.body,
          createdBy: focus.createdBy,
          decidedAt: focus.at,
        })
      : await noteToDecision({
          id: focus.id,
          conversationId: focus.conversationId,
          messageId: focus.messageId,
          body: focus.body,
          createdBy: focus.createdBy,
          notedAt: focus.at,
        });
    setBusy(false);
    if (error) alert(error);
    else {
      bumpRegistryEpoch();
      showTodoInPanel();
    }
  };

  const openSource = async () => {
    await openConversation(focus.conversationId);
    setRouteHash({ view: "conversation", conversationId: focus.conversationId });
    if (focus.messageId) void jumpToMessage(focus.conversationId, focus.messageId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <button
          type="button"
          onClick={() => showTodoInPanel()}
          className="rounded-lg p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
          aria-label="Wróć do zadań"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-semibold text-ink">
          {isDecision ? (
            <Gavel size={14} className="shrink-0 text-accent" />
          ) : (
            <StickyNote size={14} className="shrink-0 text-accent" />
          )}
          <span className="truncate">{isDecision ? "Decyzja" : "Notatka"}</span>
        </span>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-2 truncate text-[11px] text-ink-faint">{convTitle}</p>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
          {focus.body}
        </div>
        <p className="mt-3 text-[11px] text-ink-faint">
          {profiles[focus.createdBy]?.displayName || "Nieznany"} ·{" "}
          {formatMessageTime(focus.at)}
        </p>

        <div className="mt-4 flex flex-col gap-1">
          {focus.messageId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void openSource()}
              className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
            >
              <ExternalLink size={14} className="text-accent" /> Pokaż w rozmowie
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => convertToItem("task")}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
          >
            <CheckSquare size={14} className="text-ink-faint" /> Utwórz zadanie
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => convertToItem("event")}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
          >
            <CalendarPlus size={14} className="text-ink-faint" /> Utwórz wydarzenie
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => convertToItem("checklist")}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
          >
            <ListChecks size={14} className="text-ink-faint" /> Utwórz checklistę
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void crossConvert()}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
          >
            {isDecision ? (
              <>
                <StickyNote size={14} className="text-ink-faint" /> Zapisz jako notatkę
              </>
            ) : (
              <>
                <Gavel size={14} className="text-ink-faint" /> Zapisz jako decyzję
              </>
            )}
          </button>
          {focus.createdBy === myUserId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-red-400 transition hover:bg-surface-raised"
            >
              <Trash2 size={14} /> Usuń
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
