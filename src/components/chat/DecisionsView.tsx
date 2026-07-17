import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Pin, Trash2, X } from "lucide-react";
import { deleteDecision, fetchDecisions } from "@/lib/chat/api";
import type { ChatDecision, ChatProfile } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";

interface DecisionsViewProps {
  conversationId: string;
  myUserId: string | null;
  profiles: Record<string, ChatProfile>;
  onClose: () => void;
  onJumpTo: (messageId: string) => void;
}

/**
 * Rejestr decyzji rozmowy — historia ustaleń („Ustalono odbiór na 12 sierpnia")
 * z autorem, datą i skokiem do źródłowej wiadomości.
 */
export function DecisionsView({
  conversationId,
  myUserId,
  profiles,
  onClose,
  onJumpTo,
}: DecisionsViewProps) {
  const [decisions, setDecisions] = useState<ChatDecision[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchDecisions(conversationId).then((d) => {
      if (!cancelled) setDecisions(d);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const remove = async (id: string) => {
    if (!confirm("Usunąć decyzję z rejestru?")) return;
    const { error } = await deleteDecision(id);
    if (error) {
      alert(error);
      return;
    }
    setDecisions((d) => (d ? d.filter((x) => x.id !== id) : d));
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface-overlay p-3 shadow-pop sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Pin size={15} className="text-accent" /> Decyzje
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={16} />
          </button>
        </div>

        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          {decisions === null && (
            <div className="py-10 text-center text-xs text-ink-faint">Wczytywanie…</div>
          )}
          {decisions?.length === 0 && (
            <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
              Brak zapisanych decyzji.
              <br />
              Przytrzymaj wiadomość z ustaleniem i wybierz{" "}
              <span className="text-ink-light">„Zapisz jako decyzję"</span>.
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {decisions?.map((d) => (
              <div
                key={d.id}
                className="rounded-xl border border-line bg-surface-raised px-3 py-2"
              >
                <div className="whitespace-pre-wrap break-words text-sm text-ink">
                  {d.body}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
                  <span className="min-w-0 flex-1 truncate">
                    {profiles[d.createdBy]?.displayName || "Nieznany"} ·{" "}
                    {formatMessageTime(d.decidedAt)}
                  </span>
                  {d.messageId && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onJumpTo(d.messageId!);
                      }}
                      className="flex items-center gap-1 text-accent transition hover:brightness-125"
                    >
                      <ExternalLink size={11} /> źródło
                    </button>
                  )}
                  {d.createdBy === myUserId && (
                    <button
                      type="button"
                      onClick={() => void remove(d.id)}
                      className="rounded p-0.5 text-ink-faint transition hover:text-red-400"
                      aria-label="Usuń decyzję"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
