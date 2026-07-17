import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckSquare,
  Clock,
  Download,
  MessageSquare,
  MoreHorizontal,
  RotateCw,
} from "lucide-react";
import { format, isToday } from "date-fns";
import { pl } from "date-fns/locale";
import type { ChatAttachment, ChatMessage } from "@/lib/chat/types";
import { formatFileSize, signedUrlFor } from "@/lib/chat/upload";
import { useStore } from "@/state/store";

export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return isToday(d) ? format(d, "HH:mm") : format(d, "d MMM, HH:mm", { locale: pl });
}

function useSignedUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    void signedUrlFor(path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url;
}

function AttachmentTile({ att }: { att: ChatAttachment }) {
  const isImage = att.mimeType.startsWith("image/");
  const thumbUrl = useSignedUrl(isImage ? (att.thumbPath ?? att.bucketPath) : null);

  const openFull = async () => {
    const url = await signedUrlFor(att.bucketPath);
    if (url) window.open(url, "_blank", "noopener");
  };

  if (isImage) {
    return (
      <button
        type="button"
        onClick={() => void openFull()}
        className="block overflow-hidden rounded-lg border border-line bg-surface-raised"
        aria-label={`Otwórz ${att.fileName}`}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={att.fileName}
            loading="lazy"
            className="max-h-48 w-auto max-w-full object-cover"
          />
        ) : (
          <div className="flex h-24 w-32 items-center justify-center text-xs text-ink-faint">
            Obraz…
          </div>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void openFull()}
      className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-left transition hover:border-line-strong"
    >
      <Download size={14} className="shrink-0 text-ink-faint" />
      <span className="min-w-0 flex-1 truncate text-xs text-ink">{att.fileName}</span>
      <span className="shrink-0 text-[10px] text-ink-faint">
        {formatFileSize(att.sizeBytes)}
      </span>
    </button>
  );
}

interface MessageBubbleProps {
  msg: ChatMessage;
  mine: boolean;
  authorName: string;
  showAuthor: boolean;
  replyCount?: number;
  inThread?: boolean;
  onOpenThread?: (rootId: string) => void;
  onOpenActions?: (msg: ChatMessage) => void;
  onRetry?: (messageId: string) => void;
}

export function MessageBubble({
  msg,
  mine,
  authorName,
  showAuthor,
  replyCount = 0,
  inThread = false,
  onOpenThread,
  onOpenActions,
  onRetry,
}: MessageBubbleProps) {
  const setEditing = useStore((s) => s.setEditing);
  const items = useStore((s) => s.items);

  if (msg.kind === "system") {
    return (
      <div className="my-1 flex justify-center px-3">
        <div className="max-w-[85%] rounded-full border border-line bg-surface-raised/60 px-3 py-1 text-center text-[11px] text-ink-faint">
          {msg.body}
        </div>
      </div>
    );
  }

  const deleted = Boolean(msg.deletedAt);
  const pending = msg.sendState === "pending";
  const failed = msg.sendState === "failed";

  return (
    <div className={`group flex px-3 py-0.5 ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] min-w-0 ${mine ? "items-end" : "items-start"}`}>
        {showAuthor && !mine && (
          <div className="mb-0.5 px-1 text-[11px] font-medium text-ink-light">
            {authorName}
          </div>
        )}
        <div
          className={`relative rounded-2xl border px-3 py-2 text-sm leading-snug ${
            mine
              ? "border-accent/30 bg-accent/15 text-ink"
              : "border-line bg-surface-raised text-ink"
          } ${pending ? "opacity-60" : ""} ${failed ? "border-red-500/50" : ""}`}
        >
          {deleted ? (
            <span className="italic text-ink-faint">Wiadomość usunięta</span>
          ) : (
            <>
              <div className="whitespace-pre-wrap break-words">{msg.body}</div>

              {(msg.attachments?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {msg.attachments!.map((att) => (
                    <AttachmentTile key={att.id} att={att} />
                  ))}
                </div>
              )}

              {(msg.links?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.links!.map((link) => {
                    const item = items[link.itemId];
                    const isTask = item ? item.type === "task" : true;
                    return (
                      <button
                        key={link.itemId}
                        type="button"
                        onClick={() => setEditing(link.itemId)}
                        className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-ink transition hover:bg-accent/20"
                      >
                        {isTask ? <CheckSquare size={11} /> : <CalendarDays size={11} />}
                        <span className="max-w-[10rem] truncate">
                          {item?.title?.trim() || (item ? "(bez tytułu)" : "Usunięty wpis")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-ink-faint">
            {msg.editedAt && !deleted && <span>(edytowano)</span>}
            <span>{formatMessageTime(msg.createdAt)}</span>
            {pending && <Clock size={10} aria-label="Wysyłanie…" />}
            {failed && <AlertTriangle size={10} className="text-red-400" aria-label="Nie wysłano" />}
          </div>
        </div>

        {failed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(msg.id)}
            className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-red-400 transition hover:text-red-300"
          >
            <RotateCw size={11} /> Nie wysłano — ponów
          </button>
        )}

        <div className="mt-0.5 flex items-center gap-2 px-1">
          {!inThread && replyCount > 0 && onOpenThread && (
            <button
              type="button"
              onClick={() => onOpenThread(msg.id)}
              className="flex items-center gap-1 text-[11px] text-accent transition hover:brightness-125"
            >
              <MessageSquare size={11} />
              Wątek ({replyCount})
            </button>
          )}
          {!deleted && !pending && !failed && onOpenActions && (
            <button
              type="button"
              onClick={() => onOpenActions(msg)}
              aria-label="Akcje wiadomości"
              className="rounded p-0.5 text-ink-faint opacity-60 transition hover:bg-surface-overlay hover:text-ink group-hover:opacity-100"
            >
              <MoreHorizontal size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
