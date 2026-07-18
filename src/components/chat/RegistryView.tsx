import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarPlus,
  CheckSquare,
  ExternalLink,
  Gavel,
  ListChecks,
  MoreHorizontal,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import {
  deleteDecision,
  deleteNote,
  fetchDecisions,
  fetchNotes,
} from "@/lib/chat/api";
import {
  beginConvertToItem,
  decisionToNote,
  noteToDecision,
  type ConvertTarget,
} from "@/lib/chat/convert";
import type { ChatProfile } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";

export type RegistryMode = "decisions" | "notes";

interface RegistryEntry {
  id: string;
  conversationId: string;
  messageId: string | null;
  body: string;
  createdBy: string;
  at: string;
}

interface RegistryViewProps {
  mode: RegistryMode;
  conversationId: string;
  myUserId: string | null;
  profiles: Record<string, ChatProfile>;
  onClose: () => void;
  onJumpTo: (messageId: string) => void;
}

const COPY: Record<
  RegistryMode,
  { title: string; icon: typeof Gavel; empty: string; hint: string; deleteConfirm: string }
> = {
  decisions: {
    title: "Decyzje",
    icon: Gavel,
    empty: "Brak zapisanych decyzji.",
    hint: "„Zapisz jako decyzję”",
    deleteConfirm: "Usunąć decyzję z rejestru?",
  },
  notes: {
    title: "Notatki",
    icon: StickyNote,
    empty: "Brak zapisanych notatek.",
    hint: "„Zapisz jako notatkę”",
    deleteConfirm: "Usunąć notatkę?",
  },
};

/**
 * CHAT6: rejestr decyzji / notatek rozmowy — historia ustaleń i zapisków
 * z autorem, datą, skokiem do źródła i konwersjami (wymienność obiektów:
 * notatka/decyzja → zadanie / wydarzenie / checklista / nawzajem).
 */
export function RegistryView({
  mode,
  conversationId,
  myUserId,
  profiles,
  onClose,
  onJumpTo,
}: RegistryViewProps) {
  const [entries, setEntries] = useState<RegistryEntry[] | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const copy = COPY[mode];
  const Icon = copy.icon;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const list =
        mode === "decisions"
          ? (await fetchDecisions(conversationId)).map((d) => ({
              id: d.id,
              conversationId: d.conversationId,
              messageId: d.messageId,
              body: d.body,
              createdBy: d.createdBy,
              at: d.decidedAt,
            }))
          : (await fetchNotes(conversationId)).map((n) => ({
              id: n.id,
              conversationId: n.conversationId,
              messageId: n.messageId,
              body: n.body,
              createdBy: n.createdBy,
              at: n.notedAt,
            }));
      if (!cancelled) setEntries(list);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [conversationId, mode]);

  const remove = async (id: string) => {
    if (!confirm(copy.deleteConfirm)) return;
    const { error } =
      mode === "decisions" ? await deleteDecision(id) : await deleteNote(id);
    if (error) {
      alert(error);
      return;
    }
    setEntries((d) => (d ? d.filter((x) => x.id !== id) : d));
  };

  const convertToItem = (entry: RegistryEntry, target: ConvertTarget) => {
    setMenuFor(null);
    onClose();
    beginConvertToItem(
      {
        body: entry.body,
        conversationId: entry.conversationId,
        messageId: entry.messageId,
        authorName: profiles[entry.createdBy]?.displayName || "uczestnika rozmowy",
      },
      target,
    );
  };

  const crossConvert = async (entry: RegistryEntry) => {
    setMenuFor(null);
    const { error } =
      mode === "notes"
        ? await noteToDecision({
            id: entry.id,
            conversationId: entry.conversationId,
            messageId: entry.messageId,
            body: entry.body,
            createdBy: entry.createdBy,
            notedAt: entry.at,
          })
        : await decisionToNote({
            id: entry.id,
            conversationId: entry.conversationId,
            messageId: entry.messageId,
            body: entry.body,
            createdBy: entry.createdBy,
            decidedAt: entry.at,
          });
    if (error) alert(error);
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative flex max-h-[80vh] min-h-[40vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface-overlay p-3 shadow-pop sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Icon size={15} className="text-accent" /> {copy.title}
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
          {entries === null && (
            <div className="py-10 text-center text-xs text-ink-faint">Wczytywanie…</div>
          )}
          {entries?.length === 0 && (
            <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
              {copy.empty}
              <br />
              Otwórz menu wiadomości i wybierz{" "}
              <span className="text-ink-light">{copy.hint}</span>.
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {entries?.map((d) => (
              <div
                key={d.id}
                className="relative rounded-xl border border-line bg-surface-raised px-3 py-2"
              >
                <div className="whitespace-pre-wrap break-words text-sm text-ink">
                  {d.body}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
                  <span className="min-w-0 flex-1 truncate">
                    {profiles[d.createdBy]?.displayName || "Nieznany"} ·{" "}
                    {formatMessageTime(d.at)}
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
                  <button
                    type="button"
                    onClick={() => setMenuFor((v) => (v === d.id ? null : d.id))}
                    className="rounded p-0.5 text-ink-faint transition hover:text-ink"
                    aria-label="Konwersje i akcje"
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </div>

                {menuFor === d.id && (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-40 cursor-default"
                      aria-label="Zamknij menu"
                      onClick={() => setMenuFor(null)}
                    />
                    <div className="absolute right-2 top-full z-50 -mt-1 w-48 rounded-xl border border-line bg-surface-overlay p-1 shadow-pop">
                      <button
                        type="button"
                        onClick={() => convertToItem(d, "task")}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition hover:bg-surface-raised"
                      >
                        <CheckSquare size={13} className="text-ink-faint" /> Utwórz
                        zadanie
                      </button>
                      <button
                        type="button"
                        onClick={() => convertToItem(d, "event")}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition hover:bg-surface-raised"
                      >
                        <CalendarPlus size={13} className="text-ink-faint" /> Utwórz
                        wydarzenie
                      </button>
                      <button
                        type="button"
                        onClick={() => convertToItem(d, "checklist")}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition hover:bg-surface-raised"
                      >
                        <ListChecks size={13} className="text-ink-faint" /> Utwórz
                        checklistę
                      </button>
                      <button
                        type="button"
                        onClick={() => void crossConvert(d)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition hover:bg-surface-raised"
                      >
                        {mode === "notes" ? (
                          <>
                            <Gavel size={13} className="text-ink-faint" /> Zapisz jako
                            decyzję
                          </>
                        ) : (
                          <>
                            <StickyNote size={13} className="text-ink-faint" /> Zapisz
                            jako notatkę
                          </>
                        )}
                      </button>
                      {d.createdBy === myUserId && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuFor(null);
                            void remove(d.id);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-400 transition hover:bg-surface-raised"
                        >
                          <Trash2 size={13} /> Usuń
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
