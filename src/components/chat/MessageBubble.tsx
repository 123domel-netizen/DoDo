import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckSquare,
  Clock,
  CornerUpLeft,
  Download,
  ExternalLink,
  MessageSquare,
  MoreHorizontal,
  Pin,
  RotateCw,
} from "lucide-react";
import { format, isToday } from "date-fns";
import { pl } from "date-fns/locale";
import type { ChatAttachment, ChatMessage } from "@/lib/chat/types";
import { formatFileSize, signedUrlFor } from "@/lib/chat/upload";
import { parseMarkdownLite } from "@/lib/chat/markdown";
import { mentionsUser } from "@/lib/chat/mentions";
import { aggregatePoll, groupReactions } from "@/lib/chat/polls";
import { formatDuration } from "@/lib/chat/voice";
import { useStore } from "@/state/store";

export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return isToday(d) ? format(d, "HH:mm") : format(d, "d MMM, HH:mm", { locale: pl });
}

export function useSignedUrl(path: string | null): string | null {
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

/** Markdown lite + wzmianki (płaski format, bez zagnieżdżeń). */
export function MessageBody({
  body,
  mentionNames,
}: {
  body: string;
  mentionNames: string[];
}) {
  const segments = parseMarkdownLite(body, mentionNames);
  return (
    <div className="whitespace-pre-wrap break-words">
      {segments.map((seg, i) => {
        switch (seg.type) {
          case "bold":
            return <strong key={i}>{seg.text}</strong>;
          case "italic":
            return <em key={i}>{seg.text}</em>;
          case "strike":
            return <s key={i}>{seg.text}</s>;
          case "code":
            return (
              <code
                key={i}
                className="rounded bg-surface-overlay px-1 py-0.5 font-mono text-[0.85em] text-accent"
              >
                {seg.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={seg.href}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-accent underline decoration-accent/40 underline-offset-2 hover:brightness-125"
              >
                {seg.text}
              </a>
            );
          case "mention":
            return (
              <span
                key={i}
                className="rounded bg-accent/20 px-0.5 font-medium text-accent"
              >
                {seg.text}
              </span>
            );
          default:
            return <span key={i}>{seg.text}</span>;
        }
      })}
    </div>
  );
}

function VoiceAttachment({ att, durationSec }: { att: ChatAttachment; durationSec?: number }) {
  const url = useSignedUrl(att.bucketPath);
  return (
    <div className="flex min-w-[12rem] items-center gap-2">
      {url ? (
        <audio controls preload="none" src={url} className="h-9 w-full max-w-[15rem]" />
      ) : (
        <span className="text-xs text-ink-faint">Wczytywanie nagrania…</span>
      )}
      {durationSec != null && (
        <span className="shrink-0 text-[10px] text-ink-faint">
          {formatDuration(durationSec)}
        </span>
      )}
    </div>
  );
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

function LinkPreviewCard({ msg }: { msg: ChatMessage }) {
  const preview = msg.payload.linkPreview;
  if (!preview || (!preview.title && !preview.description)) return null;
  let host = "";
  try {
    host = new URL(preview.url).hostname.replace(/^www\./, "");
  } catch {
    // zostaw puste
  }
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block overflow-hidden rounded-lg border border-line bg-surface-raised transition hover:border-line-strong"
    >
      {preview.imageUrl && (
        <img
          src={preview.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-40 w-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="px-2.5 py-2">
        {preview.title && (
          <div className="line-clamp-2 text-xs font-medium text-ink">{preview.title}</div>
        )}
        {preview.description && (
          <div className="mt-0.5 line-clamp-2 text-[11px] text-ink-faint">
            {preview.description}
          </div>
        )}
        <div className="mt-1 flex items-center gap-1 text-[10px] text-ink-faint">
          <ExternalLink size={9} />
          {preview.siteName || host}
        </div>
      </div>
    </a>
  );
}

function PollBlock({
  msg,
  myUserId,
  onVote,
}: {
  msg: ChatMessage;
  myUserId: string | null;
  onVote?: (msg: ChatMessage, optionId: string) => void;
}) {
  const results = aggregatePoll(msg, myUserId);
  return (
    <div className="mt-1.5 flex min-w-[13rem] flex-col gap-1">
      {results.options.map((o) => (
        <button
          key={o.option.id}
          type="button"
          disabled={!onVote || Boolean(msg.sendState)}
          onClick={() => onVote?.(msg, o.option.id)}
          className={`relative overflow-hidden rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
            o.mine
              ? "border-accent/60 bg-accent/10 text-ink"
              : "border-line bg-surface-raised text-ink hover:border-line-strong"
          }`}
        >
          <span
            className="absolute inset-y-0 left-0 bg-accent/15"
            style={{ width: `${o.percent}%` }}
          />
          <span className="relative flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate">
              {o.mine ? "● " : ""}
              {o.option.label}
            </span>
            <span className="shrink-0 text-[10px] text-ink-faint">
              {o.count > 0 ? `${o.count} · ${o.percent}%` : ""}
            </span>
          </span>
        </button>
      ))}
      <div className="px-0.5 text-[10px] text-ink-faint">
        {results.totalVotes === 0
          ? "Brak głosów — zagłosuj jako pierwszy(a)."
          : `Głosów: ${results.totalVotes}. Kliknij swoją opcję, aby cofnąć głos.`}
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  msg: ChatMessage;
  mine: boolean;
  authorName: string;
  showAuthor: boolean;
  myUserId?: string | null;
  /** Nazwy członków rozmowy (podświetlanie wzmianek). */
  mentionNames?: string[];
  /** Cytowana wiadomość (odpowiedź) + autor. */
  quoted?: { msg: ChatMessage | null; authorName: string } | null;
  flash?: boolean;
  replyCount?: number;
  inThread?: boolean;
  onOpenThread?: (rootId: string) => void;
  onOpenActions?: (msg: ChatMessage, anchor: DOMRect) => void;
  onRetry?: (messageId: string) => void;
  onToggleReaction?: (msg: ChatMessage, emoji: string) => void;
  onVote?: (msg: ChatMessage, optionId: string) => void;
  onJumpTo?: (messageId: string) => void;
}

export function MessageBubble({
  msg,
  mine,
  authorName,
  showAuthor,
  myUserId = null,
  mentionNames = [],
  quoted = null,
  flash = false,
  replyCount = 0,
  inThread = false,
  onOpenThread,
  onOpenActions,
  onRetry,
  onToggleReaction,
  onVote,
  onJumpTo,
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
  const mentioned = !mine && mentionsUser(msg.mentions, myUserId);
  const reactions = groupReactions(msg.reactions, myUserId);
  const voiceAtt =
    msg.kind === "voice"
      ? (msg.attachments ?? []).find((a) => a.mimeType.startsWith("audio/"))
      : undefined;

  return (
    <div
      data-message-id={msg.id}
      className={`group flex px-3 py-0.5 ${mine ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[85%] min-w-0 ${mine ? "items-end" : "items-start"}`}>
        {showAuthor && !mine && (
          <div className="mb-0.5 px-1 text-[11px] font-medium text-ink-light">
            {authorName}
          </div>
        )}
        <div
          onContextMenu={
            !deleted && !pending && !failed && onOpenActions
              ? (e) => {
                  e.preventDefault();
                  onOpenActions(msg, new DOMRect(e.clientX, e.clientY, 0, 0));
                }
              : undefined
          }
          className={`relative rounded-2xl border px-3 py-2 text-sm leading-snug transition-colors ${
            mine
              ? "border-accent/30 bg-accent/15 text-ink"
              : mentioned
                ? "border-accent/50 bg-accent/10 text-ink"
                : "border-line bg-surface-raised text-ink"
          } ${pending ? "opacity-60" : ""} ${failed ? "border-red-500/50" : ""} ${
            flash ? "ring-2 ring-accent" : ""
          }`}
        >
          {deleted ? (
            <span className="italic text-ink-faint">Wiadomość usunięta</span>
          ) : (
            <>
              {quoted && (
                <button
                  type="button"
                  onClick={() =>
                    quoted.msg && onJumpTo ? onJumpTo(quoted.msg.id) : undefined
                  }
                  className="mb-1.5 flex w-full items-start gap-1.5 rounded-lg border-l-2 border-accent/60 bg-surface-overlay/60 px-2 py-1 text-left"
                >
                  <CornerUpLeft size={11} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-medium text-accent">
                      {quoted.authorName}
                    </span>
                    <span className="line-clamp-2 text-[11px] text-ink-faint">
                      {quoted.msg
                        ? quoted.msg.deletedAt
                          ? "Wiadomość usunięta"
                          : quoted.msg.kind === "voice"
                            ? "🎤 Wiadomość głosowa"
                            : quoted.msg.kind === "gif"
                              ? "GIF"
                              : quoted.msg.body || "(załącznik)"
                        : "…"}
                    </span>
                  </span>
                </button>
              )}

              {msg.kind === "poll" ? (
                <>
                  <div className="font-medium">
                    <MessageBody body={msg.body} mentionNames={mentionNames} />
                  </div>
                  <PollBlock msg={msg} myUserId={myUserId} onVote={onVote} />
                </>
              ) : msg.kind === "gif" && msg.payload.gif ? (
                <img
                  src={msg.payload.gif.url}
                  alt="GIF"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="max-h-56 w-auto max-w-full rounded-lg"
                />
              ) : msg.kind === "voice" ? (
                voiceAtt ? (
                  <VoiceAttachment
                    att={voiceAtt}
                    durationSec={msg.payload.voice?.durationSec}
                  />
                ) : (
                  <span className="text-xs text-ink-faint">
                    🎤 Wiadomość głosowa{pending ? " (wysyłanie…)" : ""}
                  </span>
                )
              ) : (
                msg.body && <MessageBody body={msg.body} mentionNames={mentionNames} />
              )}

              {msg.kind !== "voice" && (msg.attachments?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {msg.attachments!.map((att) => (
                    <AttachmentTile key={att.id} att={att} />
                  ))}
                </div>
              )}

              {msg.kind === "text" && <LinkPreviewCard msg={msg} />}

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
            {msg.pinnedAt && !deleted && (
              <Pin size={10} className="text-accent" aria-label="Wątek przypięty" />
            )}
            {msg.editedAt && !deleted && <span>(edytowano)</span>}
            <span>{formatMessageTime(msg.createdAt)}</span>
            {pending && <Clock size={10} aria-label="Wysyłanie…" />}
            {failed && <AlertTriangle size={10} className="text-red-400" aria-label="Nie wysłano" />}
          </div>
        </div>

        {!deleted && reactions.length > 0 && (
          <div className={`mt-0.5 flex flex-wrap gap-1 px-1 ${mine ? "justify-end" : ""}`}>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onToggleReaction?.(msg, r.emoji)}
                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition ${
                  r.mine
                    ? "border-accent/50 bg-accent/15 text-ink"
                    : "border-line bg-surface-raised text-ink-light hover:border-line-strong"
                }`}
              >
                <span>{r.emoji}</span>
                {r.count > 1 && <span className="text-[10px]">{r.count}</span>}
              </button>
            ))}
          </div>
        )}

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
              onClick={(e) => {
                e.stopPropagation();
                onOpenActions(msg, e.currentTarget.getBoundingClientRect());
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenActions(msg, e.currentTarget.getBoundingClientRect());
              }}
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
