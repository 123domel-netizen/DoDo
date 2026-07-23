import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckSquare,
  Clock,
  CornerUpLeft,
  Download,
  ExternalLink,
  Forward,
  MessageSquare,
  MoreHorizontal,
  Pin,
  RotateCw,
} from "lucide-react";
import { format, isToday } from "date-fns";
import { pl } from "date-fns/locale";
import type {
  ChatAttachment,
  ChatMessage,
  MessagePayload,
} from "@/lib/chat/types";
import { messagePreviewLabel } from "@/lib/chat/types";
import { formatFileSize, signedUrlFor } from "@/lib/chat/upload";
import { parseMarkdownLite } from "@/lib/chat/markdown";
import { mentionsUser } from "@/lib/chat/mentions";
import { aggregatePoll, groupReactions, QUICK_REACTIONS } from "@/lib/chat/polls";
import { formatDuration } from "@/lib/chat/voice";
import { isThreadUnread } from "@/lib/chat/recentThreads";
import { fetchMessageById } from "@/lib/chat/api";
import { useChatStore } from "@/lib/chat/store";
import { useStore } from "@/state/store";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { GalleryCard } from "@/components/chat/GalleryCard";

const INLINE_REACTIONS = QUICK_REACTIONS.slice(0, 3);

/** Odtwórz wiadomość ze snapshota przeniesienia (fallback zanim dojdzie live fetch). */
function messageFromMovedPreview(stub: ChatMessage): ChatMessage | null {
  const moved = stub.payload.moved;
  const snap = moved?.preview;
  if (!snap?.kind) return null;
  const payload = (snap.payload ?? {}) as MessagePayload;
  return {
    id: moved?.toMessageId ?? stub.id,
    conversationId: moved?.toConversationId ?? stub.conversationId,
    authorUserId: snap.authorUserId ?? stub.authorUserId,
    kind: snap.kind,
    body: typeof snap.body === "string" ? snap.body : "",
    payload,
    mentions: [],
    threadRootId: null,
    replyToMessageId: null,
    createdAt: snap.createdAt ?? stub.createdAt,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    pinnedBy: null,
    threadTitle: null,
    threadArchivedAt: null,
    attachments: snap.attachments,
  };
}

/** Treść wiadomości (bez chrome akcji) — używana też w stubie przeniesienia. */
function MessageContentPreview({
  msg,
  mentionNames = [],
  onOpenGallery,
}: {
  msg: ChatMessage;
  mentionNames?: string[];
  onOpenGallery?: (galleryId: string) => void;
}) {
  const voiceAtt =
    msg.kind === "voice"
      ? (msg.attachments ?? []).find((a) => a.mimeType.startsWith("audio/"))
      : undefined;

  return (
    <>
      {msg.kind === "poll" ? (
        <>
          <div className="font-medium">
            <MessageBody body={msg.body} mentionNames={mentionNames} />
          </div>
          <PollBlock msg={msg} myUserId={null} />
        </>
      ) : msg.kind === "gif" && msg.payload.gif ? (
        <img
          src={msg.payload.gif.url}
          alt="GIF"
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-44 w-auto max-w-full rounded-xl"
        />
      ) : msg.kind === "gallery" && msg.payload.gallery?.galleryId ? (
        <GalleryCard
          galleryId={msg.payload.gallery.galleryId}
          title={msg.body}
          onOpen={onOpenGallery}
          variant="bubble"
        />
      ) : msg.kind === "gallery" ? (
        <span className="text-xs text-ink-faint">
          {messagePreviewLabel("gallery", msg.body)}
        </span>
      ) : msg.kind === "voice" ? (
        voiceAtt ? (
          <VoiceAttachment
            att={voiceAtt}
            durationSec={msg.payload.voice?.durationSec}
          />
        ) : (
          <span className="text-xs text-ink-faint">🎤 Wiadomość głosowa</span>
        )
      ) : (
        msg.body && <MessageBody body={msg.body} mentionNames={mentionNames} />
      )}

      {msg.kind !== "voice" && (msg.attachments?.length ?? 0) > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {msg.attachments!.map((att) => (
            <AttachmentTile key={att.id} att={att} />
          ))}
        </div>
      )}

      {msg.kind === "text" && <LinkPreviewCard msg={msg} />}
    </>
  );
}

function MovedStubBubble({
  stub,
  mentionNames = [],
  onOpenGallery,
}: {
  stub: ChatMessage;
  mentionNames?: string[];
  onOpenGallery?: (galleryId: string) => void;
}) {
  const fromPreview = messageFromMovedPreview(stub);
  const [live, setLive] = useState<ChatMessage | null>(null);

  useEffect(() => {
    const id = stub.payload.moved?.toMessageId;
    if (!id) return;
    let cancelled = false;
    void fetchMessageById(id).then((m) => {
      if (!cancelled && m && !m.deletedAt) setLive(m);
    });
    return () => {
      cancelled = true;
    };
  }, [stub.payload.moved?.toMessageId]);

  const display = live ?? fromPreview;
  const isGallery = display?.kind === "gallery" && Boolean(display.payload.gallery?.galleryId);

  return (
    <div className="my-2.5 flex justify-center px-3">
      <div
        className={`max-w-[min(88%,22rem)] opacity-[0.72] ${
          isGallery ? "w-full max-w-[min(96%,18.5rem)]" : ""
        }`}
      >
        <p className="mb-1 text-center text-[11px] font-medium text-ink-faint">
          Przeniesiono wiadomość
        </p>
        {display ? (
          <div
            className={
              isGallery
                ? "overflow-visible bg-transparent p-0"
                : "rounded-2xl border border-line/60 bg-surface-raised/50 px-2.5 py-[7px] text-[14.5px] leading-[1.35] text-ink shadow-card"
            }
          >
            <MessageContentPreview
              msg={display}
              mentionNames={mentionNames}
              onOpenGallery={onOpenGallery}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-line/60 bg-surface-raised/40 px-3.5 py-2 text-center text-[12px] text-ink-light">
            {stub.body || "Przeniesiono wiadomość"}
          </div>
        )}
      </div>
    </div>
  );
}

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

function AuthorAvatar({
  userId,
  name,
  avatarUrl,
  size = 28,
}: {
  userId?: string;
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (userId) {
    return <PersonAvatar userId={userId} avatarUrl={avatarUrl} size={size} />;
  }

  const initials = (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-[10px] font-semibold text-ink-faint"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initials}
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
        className="block overflow-hidden rounded-xl border border-line bg-surface-raised"
        aria-label={`Otwórz ${att.fileName}`}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={att.fileName}
            loading="lazy"
            className="max-h-52 w-auto max-w-full object-cover"
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
      className="flex w-full items-center gap-2 rounded-xl border border-line bg-surface-raised px-2.5 py-2 text-left transition hover:border-line-strong"
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
      className="mt-2 block overflow-hidden rounded-xl border border-line bg-surface-overlay/50 transition hover:border-line-strong"
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
    <div className="mt-2 flex min-w-[13rem] flex-col gap-1.5">
      {results.options.map((o) => (
        <button
          key={o.option.id}
          type="button"
          disabled={!onVote || Boolean(msg.sendState)}
          onClick={() => onVote?.(msg, o.option.id)}
          className={`relative overflow-hidden rounded-lg border px-2.5 py-2 text-left text-xs transition ${
            o.mine
              ? "border-accent/60 bg-accent/10 text-ink"
              : "border-line bg-surface-overlay/40 text-ink hover:border-line-strong"
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

function HoverToolbar({
  mine,
  onReply,
  onOpenThread,
  onOpenActions,
  onToggleReaction,
  msg,
  replyCount,
  inThread,
}: {
  mine: boolean;
  msg: ChatMessage;
  replyCount: number;
  inThread: boolean;
  onReply?: (msg: ChatMessage) => void;
  onOpenThread?: (rootId: string) => void;
  onOpenActions?: (msg: ChatMessage, anchor: DOMRect) => void;
  onToggleReaction?: (msg: ChatMessage, emoji: string) => void;
}) {
  return (
    // Wrapper z „mostkiem” (pb) wypełnia lukę do bąbelka — inaczej hover ginie w drodze.
    <div
      className={`pointer-events-none absolute bottom-full z-20 pb-2 opacity-0 transition duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${
        mine ? "right-0" : "left-0"
      }`}
    >
      <div className="flex items-center gap-0.5 rounded-xl border border-line/80 bg-surface-overlay/95 p-0.5 shadow-pop backdrop-blur-md">
        {INLINE_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            title={`Reaguj ${emoji}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleReaction?.(msg, emoji);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sm transition hover:scale-110 hover:bg-ink/5 dark:hover:bg-white/[0.08]"
          >
            {emoji}
          </button>
        ))}
        <span className="mx-0.5 h-4 w-px bg-line/80" aria-hidden />
        {onReply && (
          <button
            type="button"
            title="Odpowiedz"
            onClick={(e) => {
              e.stopPropagation();
              onReply(msg);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-light transition hover:bg-ink/5 hover:text-ink dark:hover:bg-white/[0.08]"
          >
            <CornerUpLeft size={14} />
          </button>
        )}
        {!inThread && onOpenThread && (
          <button
            type="button"
            title={replyCount > 0 ? `Wątek · ${replyCount}` : "Odpowiedz w wątku"}
            onClick={(e) => {
              e.stopPropagation();
              onOpenThread(msg.id);
            }}
            className="relative flex h-7 w-7 items-center justify-center rounded-lg text-ink-light transition hover:bg-white/[0.08] hover:text-ink"
          >
            <MessageSquare size={14} />
            {replyCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-thread px-0.5 text-[8px] font-semibold text-white">
                {replyCount}
              </span>
            )}
          </button>
        )}
        {onOpenActions && (
          <button
            type="button"
            title="Więcej"
            onClick={(e) => {
              e.stopPropagation();
              onOpenActions(msg, e.currentTarget.getBoundingClientRect());
            }}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-light transition hover:bg-ink/5 hover:text-ink dark:hover:bg-white/[0.08]"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  msg: ChatMessage;
  mine: boolean;
  authorName: string;
  authorAvatarUrl?: string | null;
  showAuthor: boolean;
  /** false = ta sama seria (≤5 min od poprzedniej) — bez godziny */
  showTime?: boolean;
  myUserId?: string | null;
  mentionNames?: string[];
  quoted?: { msg: ChatMessage | null; authorName: string } | null;
  flash?: boolean;
  replyCount?: number;
  inThread?: boolean;
  onOpenThread?: (rootId: string) => void;
  onOpenActions?: (msg: ChatMessage, anchor: DOMRect) => void;
  onReply?: (msg: ChatMessage) => void;
  onRetry?: (messageId: string) => void;
  onToggleReaction?: (msg: ChatMessage, emoji: string) => void;
  onVote?: (msg: ChatMessage, optionId: string) => void;
  onJumpTo?: (messageId: string) => void;
  onOpenRegistry?: (msg: ChatMessage) => void;
  onOpenGallery?: (galleryId: string) => void;
}

export function MessageBubble({
  msg,
  mine,
  authorName,
  authorAvatarUrl = null,
  showAuthor,
  showTime = true,
  myUserId = null,
  mentionNames = [],
  quoted = null,
  flash = false,
  replyCount = 0,
  inThread = false,
  onOpenThread,
  onOpenActions,
  onReply,
  onRetry,
  onToggleReaction,
  onVote,
  onJumpTo,
  onOpenRegistry,
  onOpenGallery,
}: MessageBubbleProps) {
  const setEditing = useStore((s) => s.setEditing);
  const items = useStore((s) => s.items);
  const threadLastReply = useChatStore((s) => s.threadLastReply[msg.id]);
  const threadSeenAt = useChatStore((s) => s.threadSeenAt[msg.id]);
  const hasThread = !inThread && replyCount > 0;
  const threadUnread = isThreadUnread({
    replyCount,
    myUserId,
    lastReply: threadLastReply,
    seenAt: threadSeenAt,
  });

  if (msg.kind === "system") {
    if (msg.payload?.movedStub) {
      return (
        <MovedStubBubble
          stub={msg}
          mentionNames={mentionNames}
          onOpenGallery={onOpenGallery}
        />
      );
    }
    const registryKind =
      msg.payload?.registry?.kind ??
      (msg.body.startsWith("📝 Zapisano notatkę")
        ? "note"
        : msg.body.startsWith("📌 Zapisano decyzję")
          ? "decision"
          : null);
    // „Cofnięto decyzję” — chmurka jak zapis, bez otwierania rejestru.
    const clickable = Boolean(registryKind && onOpenRegistry);
    const pill = (
      <div
        className={`max-w-full truncate whitespace-nowrap rounded-full border border-line bg-surface-raised/60 px-3.5 py-1.5 text-center text-[11px] leading-snug text-ink-faint ${
          clickable
            ? "cursor-pointer transition hover:border-accent/40 hover:bg-surface-raised hover:text-ink"
            : ""
        }`}
      >
        {msg.body}
      </div>
    );
    return (
      <div className="my-2.5 flex justify-center px-3">
        {clickable ? (
          <button
            type="button"
            onClick={() => onOpenRegistry?.(msg)}
            className="max-w-[85%] border-0 bg-transparent p-0"
            title={registryKind === "note" ? "Otwórz notatkę" : "Otwórz decyzję"}
          >
            {pill}
          </button>
        ) : (
          <div className="max-w-[85%]">{pill}</div>
        )}
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
  const canAct = !deleted && !pending && !failed;

  const isGallery = msg.kind === "gallery" && !deleted;
  const galleryNeedsChrome = isGallery && (hasThread || threadUnread || Boolean(quoted));
  let bubbleClass: string;
  if (isGallery && !galleryNeedsChrome) {
    bubbleClass = "overflow-visible bg-transparent p-0 shadow-none";
  } else if (isGallery && galleryNeedsChrome) {
    const pad = "overflow-visible px-1.5 pb-2 pt-1.5";
    if (mine) {
      bubbleClass = threadUnread
        ? `${pad} rounded-2xl rounded-br-[5px] border-l-4 border-thread bg-thread/45 text-ink shadow-card ring-1 ring-thread/35`
        : hasThread
          ? `${pad} rounded-2xl rounded-br-[5px] border-l-4 border-thread bg-thread/28 text-ink shadow-card`
          : `${pad} rounded-2xl rounded-br-[5px] bg-accent/30 text-ink shadow-card`;
    } else {
      bubbleClass = threadUnread
        ? `${pad} rounded-2xl rounded-bl-[5px] border-l-4 border-thread bg-thread/30 text-ink shadow-card ring-1 ring-thread/30`
        : hasThread
          ? `${pad} rounded-2xl rounded-bl-[5px] border-l-4 border-thread-soft bg-thread/16 text-ink shadow-card`
          : `${pad} rounded-2xl rounded-bl-[5px] bg-surface-raised text-ink shadow-card`;
    }
  } else {
    const pad = "px-2.5 py-[7px]";
    if (mine) {
      bubbleClass = threadUnread
        ? `${pad} rounded-2xl rounded-br-[5px] border-l-4 border-thread bg-thread/45 text-ink shadow-card ring-1 ring-thread/35`
        : hasThread
          ? `${pad} rounded-2xl rounded-br-[5px] border-l-4 border-thread bg-thread/28 text-ink shadow-card`
          : `${pad} rounded-2xl rounded-br-[5px] bg-accent/45 text-ink shadow-card`;
    } else {
      bubbleClass = threadUnread
        ? `${pad} rounded-2xl rounded-bl-[5px] border-l-4 border-thread bg-thread/30 text-ink shadow-card ring-1 ring-thread/30`
        : hasThread
          ? `${pad} rounded-2xl rounded-bl-[5px] border-l-4 border-thread-soft bg-thread/16 text-ink shadow-card`
          : mentioned
            ? `${pad} rounded-2xl rounded-bl-[5px] bg-surface-raised text-ink shadow-card ring-1 ring-inset ring-accent/45`
            : `${pad} rounded-2xl rounded-bl-[5px] bg-surface-raised text-ink shadow-card`;
    }
  }

  return (
    <div
      data-message-id={msg.id}
      className={`group relative flex gap-2 px-3 ${
        showAuthor ? "mt-3" : "mt-0.5"
      } ${mine ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Awatar — tylko po stronie rozmówcy; placeholder gdy ciąg dalszy */}
      {!mine && (
        <div className="flex w-7 shrink-0 flex-col pt-0.5">
          {showAuthor ? (
            <AuthorAvatar
              userId={msg.authorUserId}
              name={authorName}
              avatarUrl={authorAvatarUrl}
              size={28}
            />
          ) : (
            <span className="h-7 w-7" aria-hidden />
          )}
        </div>
      )}

      <div
        className={`relative flex min-w-0 flex-col ${
          mine ? "items-end" : "items-start"
        } ${
          msg.kind === "gallery" && !deleted
            ? "max-w-[min(96%,18.5rem)]"
            : "max-w-[min(88%,22rem)]"
        }`}
      >
        {showAuthor && (
          <div
            className={`mb-1 px-1 text-[11px] font-medium leading-none tracking-wide ${
              mine ? "text-right text-ink-faint" : "text-left text-ink-light"
            }`}
          >
            {authorName}
          </div>
        )}

        <div className="relative">
          {canAct && (onOpenActions || onReply || onToggleReaction) && (
            <HoverToolbar
              mine={mine}
              msg={msg}
              replyCount={replyCount}
              inThread={inThread}
              onReply={onReply}
              onOpenThread={onOpenThread}
              onOpenActions={onOpenActions}
              onToggleReaction={onToggleReaction}
            />
          )}

          <div
            onContextMenu={
              canAct && onOpenActions
                ? (e) => {
                    e.preventDefault();
                    onOpenActions(msg, new DOMRect(e.clientX, e.clientY, 0, 0));
                  }
                : undefined
            }
            className={`chat-msg-bubble relative box-border flow-root text-[14.5px] leading-[1.35] transition-colors ${bubbleClass} ${
              pending ? "opacity-60" : ""
            } ${failed ? "ring-1 ring-inset ring-red-500/50" : ""} ${
              flash ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""
            }`}
          >
            {deleted ? (
              <span className="italic text-ink-faint">Wiadomość usunięta</span>
            ) : (
              <>
                {msg.payload.forward && !msg.threadRootId && (
                  <div
                    className={`mb-1.5 flex items-center gap-1 text-[11px] font-medium ${
                      mine ? "text-ink-faint" : "text-ink-light"
                    }`}
                  >
                    <Forward size={11} className="shrink-0 opacity-80" />
                    Przesłano dalej
                  </div>
                )}
                {quoted && (
                  <button
                    type="button"
                    onClick={() =>
                      quoted.msg && onJumpTo ? onJumpTo(quoted.msg.id) : undefined
                    }
                    className={`mb-1.5 flex w-full items-start gap-1.5 rounded-md border-l-[3px] border-accent px-2 py-1 text-left ${
                      mine ? "bg-ink/10 dark:bg-black/20" : "bg-ink/15 dark:bg-black/25"
                    }`}
                  >
                    <CornerUpLeft size={11} className="mt-0.5 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-medium text-accent">
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
                                : quoted.msg.kind === "gallery"
                                  ? `🖼 Galeria: ${quoted.msg.body || "…"}`
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
                    className="max-h-44 w-auto max-w-full rounded-xl"
                  />
                ) : msg.kind === "gallery" && msg.payload.gallery?.galleryId ? (
                  <GalleryCard
                    galleryId={msg.payload.gallery.galleryId}
                    title={msg.body}
                    onOpen={onOpenGallery}
                    variant="bubble"
                  />
                ) : msg.kind === "gallery" ? (
                  <span className="text-xs text-ink-faint">🖼 Galeria: {msg.body || "…"}</span>
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
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {msg.attachments!.map((att) => (
                      <AttachmentTile key={att.id} att={att} />
                    ))}
                  </div>
                )}

                {msg.kind === "text" && <LinkPreviewCard msg={msg} />}

                {(msg.links?.length ?? 0) > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
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

            {(showTime ||
              (msg.pinnedAt && !deleted) ||
              (msg.editedAt && !deleted) ||
              pending ||
              failed) && (
              <span
                className={`inline-flex items-center gap-1 text-[11px] leading-none ${
                  isGallery && !galleryNeedsChrome
                    ? "float-right ml-2 mt-0.5 text-ink-faint"
                    : `float-right ml-2 ${isGallery ? "mt-0.5" : "translate-y-[0.4em]"} ${
                        mine
                          ? threadUnread
                            ? "text-white/70"
                            : "text-ink/55"
                          : "text-ink-faint"
                      }`
                }`}
              >
                {msg.pinnedAt && !deleted && (
                  <Pin size={10} className="text-accent" aria-label="Wątek przypięty" />
                )}
                {msg.editedAt && !deleted && <span className="opacity-80">edytowano</span>}
                {showTime && (
                  <span className="tabular-nums">{formatMessageTime(msg.createdAt)}</span>
                )}
                {pending && <Clock size={10} aria-label="Wysyłanie…" />}
                {failed && (
                  <AlertTriangle size={10} className="text-red-400" aria-label="Nie wysłano" />
                )}
              </span>
            )}
          </div>
        </div>

        {!deleted && reactions.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : ""}`}>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onToggleReaction?.(msg, r.emoji)}
                className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition ${
                  r.mine
                    ? "bg-accent/20 text-ink ring-1 ring-inset ring-accent/40"
                    : "bg-surface-raised text-ink-light ring-1 ring-inset ring-white/[0.06] hover:text-ink"
                }`}
              >
                <span>{r.emoji}</span>
                {r.count > 1 && <span className="text-[10px] tabular-nums">{r.count}</span>}
              </button>
            ))}
          </div>
        )}

        {!inThread && replyCount > 0 && onOpenThread && (
          <button
            type="button"
            onClick={() => onOpenThread(msg.id)}
            className={`mt-1 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold transition ${
              threadUnread
                ? "bg-thread/20 text-thread hover:bg-thread/30"
                : "text-thread/90 hover:bg-thread/10"
            } ${mine ? "self-end" : "self-start"}`}
          >
            <MessageSquare
              size={12}
              className={threadUnread ? "fill-thread/35" : undefined}
            />
            {replyCount === 1 ? "1 odpowiedź" : `${replyCount} odpowiedzi`}
            {threadUnread && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-thread" aria-label="Nieodczytane" />
            )}
          </button>
        )}

        {failed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(msg.id)}
            className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-red-400 transition hover:text-red-300"
          >
            <RotateCw size={11} /> Nie wysłano — ponów
          </button>
        )}
      </div>
    </div>
  );
}
