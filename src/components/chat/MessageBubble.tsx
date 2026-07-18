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
    <span className="whitespace-pre-wrap break-words">
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
    </span>
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
      className={`group relative flex px-2 py-px ${mine ? "justify-end" : "justify-start"}`}
    >
      <div className={`relative max-w-[88%] min-w-0 ${mine ? "items-end" : "items-start"}`}>
        {showAuthor && !mine && (
          <div className="mb-px px-1 text-[10px] font-medium leading-tight text-ink-light">
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
          className={`relative rounded-xl border px-2 py-1 text-[13px] leading-snug transition-colors ${
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
                  className="mb-1 flex w-full items-start gap-1 rounded border-l-2 border-accent/60 bg-surface-overlay/60 px-1.5 py-0.5 text-left"
                >
                  <CornerUpLeft size={10} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-medium text-accent">
                      {quoted.authorName}
                    </span>
                    <span className="line-clamp-1 text-[10px] text-ink-faint">
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
                  className="max-h-40 w-auto max-w-full rounded-lg"
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
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {msg.attachments!.map((att) => (
                    <AttachmentTile key={att.id} att={att} />
                  ))}
                </div>
              )}

              {msg.kind === "text" && <LinkPreviewCard msg={msg} />}

              {(msg.links?.length ?? 0) > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {msg.links!.map((link) => {
                    const item = items[link.itemId];
                    const isTask = item ? item.type === "task" : true;
                    return (
                      <button
                        key={link.itemId}
                        type="button"
                        onClick={() => setEditing(link.itemId)}
                        className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-px text-[10px] text-ink transition hover:bg-accent/20"
                      >
                        {isTask ? <CheckSquare size={10} /> : <CalendarDays size={10} />}
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

          {/* Meta w jednej linii z treścią — oszczędza wysokość */}
          <span className="ml-1.5 inline-flex translate-y-px items-center gap-1 whitespace-nowrap align-bottom text-[10px] leading-none text-ink-faint">
            {msg.pinnedAt && !deleted && (
              <Pin size={9} className="text-accent" aria-label="Wątek przypięty" />
            )}
            {msg.editedAt && !deleted && <span>(ed.)</span>}
            <span>{formatMessageTime(msg.createdAt)}</span>
            {pending && <Clock size={9} aria-label="Wysyłanie…" />}
            {failed && (
              <AlertTriangle size={9} className="text-red-400" aria-label="Nie wysłano" />
            )}
            {!inThread && replyCount > 0 && onOpenThread && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenThread(msg.id);
                }}
                className="inline-flex items-center gap-0.5 rounded text-accent transition hover:brightness-125"
                aria-label={`Otwórz wątek (${replyCount})`}
                title={`Wątek · ${replyCount}`}
              >
                <MessageSquare size={9} />
                <span>{replyCount}</span>
              </button>
            )}
          </span>
        </div>

        {/* Akcje obok bąbelka (hover), nie pod nim */}
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
            className={`absolute top-1/2 z-10 -translate-y-1/2 rounded-md border border-line bg-surface-overlay p-0.5 text-ink-faint opacity-0 shadow-sm transition hover:text-ink group-hover:opacity-100 ${
              mine ? "-left-7" : "-right-7"
            }`}
          >
            <MoreHorizontal size={12} />
          </button>
        )}

        {!deleted && reactions.length > 0 && (
          <div className={`mt-px flex flex-wrap gap-0.5 px-0.5 ${mine ? "justify-end" : ""}`}>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onToggleReaction?.(msg, r.emoji)}
                className={`flex items-center gap-0.5 rounded-full border px-1 py-px text-[10px] transition ${
                  r.mine
                    ? "border-accent/50 bg-accent/15 text-ink"
                    : "border-line bg-surface-raised text-ink-light hover:border-line-strong"
                }`}
              >
                <span>{r.emoji}</span>
                {r.count > 1 && <span className="text-[9px]">{r.count}</span>}
              </button>
            ))}
          </div>
        )}

        {failed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(msg.id)}
            className="mt-px flex items-center gap-1 px-1 text-[10px] text-red-400 transition hover:text-red-300"
          >
            <RotateCw size={10} /> Nie wysłano — ponów
          </button>
        )}
      </div>
    </div>
  );
}
