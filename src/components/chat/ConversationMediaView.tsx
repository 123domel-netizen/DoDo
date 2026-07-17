import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, Image as ImageIcon, Link2, FileText, X } from "lucide-react";
import {
  fetchConversationAttachments,
  fetchConversationLinkMessages,
  type ConversationAttachment,
} from "@/lib/chat/api";
import { extractUrls } from "@/lib/chat/markdown";
import { formatFileSize, signedUrlFor } from "@/lib/chat/upload";
import type { ChatMessage } from "@/lib/chat/types";
import { formatMessageTime, useSignedUrl } from "@/components/chat/MessageBubble";

type MediaTab = "photos" | "files" | "links";

interface ConversationMediaViewProps {
  conversationId: string;
  onClose: () => void;
  onJumpTo: (messageId: string) => void;
}

function PhotoTile({ att }: { att: ConversationAttachment }) {
  const url = useSignedUrl(att.thumbPath ?? att.bucketPath);
  const openFull = async () => {
    const full = await signedUrlFor(att.bucketPath);
    if (full) window.open(full, "_blank", "noopener");
  };
  return (
    <button
      type="button"
      onClick={() => void openFull()}
      className="aspect-square overflow-hidden rounded-lg border border-line bg-surface-raised"
      aria-label={`Otwórz ${att.fileName}`}
    >
      {url ? (
        <img src={url} alt={att.fileName} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-[10px] text-ink-faint">…</div>
      )}
    </button>
  );
}

interface LinkEntry {
  url: string;
  messageId: string;
  createdAt: string;
}

/**
 * Zakładka Media rozmowy: Zdjęcia / Pliki / Linki — szybkie odnajdywanie
 * materiałów bez przewijania całej historii.
 */
export function ConversationMediaView({
  conversationId,
  onClose,
  onJumpTo,
}: ConversationMediaViewProps) {
  const [tab, setTab] = useState<MediaTab>("photos");
  const [attachments, setAttachments] = useState<ConversationAttachment[] | null>(null);
  const [linkMessages, setLinkMessages] = useState<ChatMessage[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchConversationAttachments(conversationId).then((a) => {
      if (!cancelled) setAttachments(a);
    });
    void fetchConversationLinkMessages(conversationId).then((m) => {
      if (!cancelled) setLinkMessages(m);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const photos = useMemo(
    () => (attachments ?? []).filter((a) => a.mimeType.startsWith("image/")),
    [attachments],
  );
  const files = useMemo(
    () =>
      (attachments ?? []).filter(
        (a) => !a.mimeType.startsWith("image/") && !a.mimeType.startsWith("audio/"),
      ),
    [attachments],
  );
  const links = useMemo<LinkEntry[]>(() => {
    const out: LinkEntry[] = [];
    for (const m of linkMessages ?? []) {
      for (const url of extractUrls(m.body)) {
        out.push({ url, messageId: m.id, createdAt: m.createdAt });
      }
    }
    return out;
  }, [linkMessages]);

  const tabs: { id: MediaTab; label: string; icon: typeof ImageIcon; count: number }[] = [
    { id: "photos", label: "Zdjęcia", icon: ImageIcon, count: photos.length },
    { id: "files", label: "Pliki", icon: FileText, count: files.length },
    { id: "links", label: "Linki", icon: Link2, count: links.length },
  ];

  const loading = attachments === null || linkMessages === null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative flex h-[80vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface-overlay p-3 shadow-pop sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-sm font-semibold text-ink">Media i pliki</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mb-2 flex gap-1 rounded-xl border border-line bg-surface-raised p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition ${
                tab === t.id
                  ? "bg-surface-overlay font-medium text-ink shadow-pop"
                  : "text-ink-faint hover:text-ink"
              }`}
            >
              <t.icon size={13} />
              {t.label}
              {t.count > 0 && <span className="text-[10px] text-ink-faint">{t.count}</span>}
            </button>
          ))}
        </div>

        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <div className="py-10 text-center text-xs text-ink-faint">Wczytywanie…</div>
          )}

          {!loading && tab === "photos" && (
            photos.length ? (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {photos.map((att) => (
                  <PhotoTile key={att.id} att={att} />
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-xs text-ink-faint">Brak zdjęć.</div>
            )
          )}

          {!loading && tab === "files" && (
            files.length ? (
              <div className="flex flex-col gap-1.5">
                {files.map((att) => (
                  <button
                    key={att.id}
                    type="button"
                    onClick={() =>
                      void signedUrlFor(att.bucketPath).then(
                        (u) => u && window.open(u, "_blank", "noopener"),
                      )
                    }
                    className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-left transition hover:border-line-strong"
                  >
                    <Download size={14} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-ink">{att.fileName}</span>
                      <span className="text-[10px] text-ink-faint">
                        {formatFileSize(att.sizeBytes)} · {formatMessageTime(att.createdAt)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-xs text-ink-faint">Brak plików.</div>
            )
          )}

          {!loading && tab === "links" && (
            links.length ? (
              <div className="flex flex-col gap-1.5">
                {links.map((l, i) => (
                  <div
                    key={`${l.messageId}-${i}`}
                    className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-2"
                  >
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1"
                    >
                      <span className="block truncate text-xs text-accent underline decoration-accent/40 underline-offset-2">
                        {l.url}
                      </span>
                      <span className="text-[10px] text-ink-faint">
                        {formatMessageTime(l.createdAt)}
                      </span>
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onJumpTo(l.messageId);
                      }}
                      className="shrink-0 rounded p-1 text-ink-faint transition hover:text-ink"
                      aria-label="Pokaż w rozmowie"
                    >
                      <ExternalLink size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-xs text-ink-faint">Brak linków.</div>
            )
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
