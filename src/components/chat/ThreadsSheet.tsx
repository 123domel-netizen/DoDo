import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Trash2,
  X,
} from "lucide-react";
import { fetchThreadsList } from "@/lib/chat/api";
import {
  archiveThread,
  dissolveThread,
  saveThreadTitle,
} from "@/lib/chat/init";
import type { ChatMessage, ChatProfile, ThreadListEntry } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";
import { NameThreadDialog } from "@/components/chat/NameThreadDialog";

interface ThreadsSheetProps {
  conversationId: string;
  profiles: Record<string, ChatProfile>;
  onClose: () => void;
  onOpenThread: (rootId: string) => void;
}

/** CHAT6: lista wątków rozmowy + archiwum, edycja nazwy, usuwanie pustych. */
export function ThreadsSheet({
  conversationId,
  profiles,
  onClose,
  onOpenThread,
}: ThreadsSheetProps) {
  const [threads, setThreads] = useState<ThreadListEntry[] | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renameMsg, setRenameMsg] = useState<ChatMessage | null>(null);
  const [showArchive, setShowArchive] = useState(false);

  const reload = () => {
    void fetchThreadsList(conversationId).then(setThreads);
  };

  useEffect(() => {
    let cancelled = false;
    void fetchThreadsList(conversationId).then((t) => {
      if (!cancelled) setThreads(t);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const active = (threads ?? []).filter((t) => !t.root.threadArchivedAt);
  const archived = (threads ?? []).filter((t) => Boolean(t.root.threadArchivedAt));

  const renderRow = ({ root, replyCount }: ThreadListEntry, inArchive: boolean) => (
    <div
      key={root.id}
      className="relative rounded-xl border border-line bg-surface-raised px-3 py-2"
    >
      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenThread(root.id);
        }}
        className="w-full text-left"
      >
        <div className="flex items-center gap-1.5 pr-7 text-[10px] text-ink-faint">
          {root.pinnedAt && <Pin size={10} className="text-accent" />}
          <span className="min-w-0 flex-1 truncate">
            {profiles[root.authorUserId]?.displayName || "Nieznany"} ·{" "}
            {formatMessageTime(root.createdAt)}
          </span>
          {replyCount > 0 ? (
            <span className="flex shrink-0 items-center gap-0.5 text-accent">
              <MessageSquare size={10} /> {replyCount}
            </span>
          ) : (
            <span className="shrink-0 text-ink-faint">bez odpowiedzi</span>
          )}
        </div>
        <div className="mt-0.5 line-clamp-2 break-words text-sm text-ink">
          {root.deletedAt
            ? "Wiadomość usunięta"
            : root.threadTitle?.trim() ||
              root.body ||
              (root.kind === "gif" ? "GIF" : "(załącznik)")}
        </div>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuFor((v) => (v === root.id ? null : root.id));
        }}
        className="absolute right-2 top-2 rounded-md p-1 text-ink-faint transition hover:bg-surface-overlay hover:text-ink"
        aria-label="Opcje wątku"
      >
        <MoreHorizontal size={14} />
      </button>

      {menuFor === root.id && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Zamknij menu"
            onClick={() => setMenuFor(null)}
          />
          <div className="absolute right-2 top-8 z-50 w-48 rounded-xl border border-line bg-surface-overlay p-1 shadow-pop">
            <button
              type="button"
              onClick={() => {
                setMenuFor(null);
                setRenameMsg(root);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition hover:bg-surface-raised"
            >
              <Pencil size={13} className="text-ink-faint" /> Edytuj nazwę
            </button>
            {inArchive ? (
              <button
                type="button"
                onClick={() => {
                  setMenuFor(null);
                  void archiveThread(root, false).then(({ error }) => {
                    if (error) alert(error);
                    else reload();
                  });
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition hover:bg-surface-raised"
              >
                <ArchiveRestore size={13} className="text-ink-faint" /> Przywróć
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMenuFor(null);
                  void archiveThread(root, true).then(({ error }) => {
                    if (error) alert(error);
                    else {
                      setShowArchive(true);
                      reload();
                    }
                  });
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition hover:bg-surface-raised"
              >
                <Archive size={13} className="text-ink-faint" /> Archiwizuj
              </button>
            )}
            {replyCount === 0 && (
              <button
                type="button"
                onClick={() => {
                  setMenuFor(null);
                  if (!confirm("Usunąć ten pusty wątek z listy? Wiadomość w czacie zostanie.")) {
                    return;
                  }
                  void dissolveThread(root).then(({ error }) => {
                    if (error) alert(error);
                    else reload();
                  });
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-400 transition hover:bg-surface-raised"
              >
                <Trash2 size={13} /> Usuń wątek
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

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
            <MessageSquare size={15} className="text-accent" /> Wątki
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
          {threads === null && (
            <div className="py-10 text-center text-xs text-ink-faint">Wczytywanie…</div>
          )}
          {threads && active.length === 0 && (
            <div className="px-6 py-8 text-center text-xs leading-relaxed text-ink-faint">
              Brak aktywnych wątków w tej rozmowie.
              <br />
              Otwórz menu wiadomości i wybierz{" "}
              <span className="text-ink-light">„Odpowiedz w wątku”</span>.
            </div>
          )}
          <div className="flex flex-col gap-1.5">{active.map((t) => renderRow(t, false))}</div>

          {archived.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <button
                type="button"
                onClick={() => setShowArchive((v) => !v)}
                className="mb-1.5 flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint transition hover:text-ink"
              >
                <Archive size={12} />
                Archiwum · {archived.length}
                <span className="ml-auto normal-case tracking-normal">
                  {showArchive ? "zwiń" : "rozwiń"}
                </span>
              </button>
              {showArchive && (
                <div className="flex flex-col gap-1.5 opacity-90">
                  {archived.map((t) => renderRow(t, true))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {renameMsg && (
        <NameThreadDialog
          msg={renameMsg}
          heading="Edytuj nazwę wątku"
          confirmLabel="Zapisz"
          onCancel={() => setRenameMsg(null)}
          onConfirm={(named) => {
            const root = renameMsg;
            setRenameMsg(null);
            void saveThreadTitle(root, named).then(({ error }) => {
              if (error) alert(error);
              else reload();
            });
          }}
        />
      )}
    </div>,
    document.body,
  );
}
