import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckSquare,
  Clock,
  CornerUpLeft,
  Download,
  ExternalLink,
  Forward,
  ListTree,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pin,
  RotateCw,
  Square,
  X,
} from "lucide-react";
import type { MessageSelectMode } from "@/lib/chat/selectionChecklist";
import { format, isToday } from "date-fns";
import { pl } from "date-fns/locale";
import type {
  ChatAttachment,
  ChatMessage,
  MessagePayload,
} from "@/lib/chat/types";
import { messagePreviewLabel } from "@/lib/chat/types";
import { formatFileSize, signedUrlFor } from "@/lib/chat/upload";
import {
  classifyFile,
  fileExtension,
  fileKindIcon,
  fileKindTone,
  isPdfAttachment,
} from "@/lib/chat/fileKinds";
import { parseMarkdownLite } from "@/lib/chat/markdown";
import { mentionsUser } from "@/lib/chat/mentions";
import { aggregatePoll, groupReactions } from "@/lib/chat/polls";
import { formatDuration } from "@/lib/chat/voice";
import { isThreadUnread } from "@/lib/chat/recentThreads";
import { isItemDeleted } from "@/lib/items";
import { fetchMessageById } from "@/lib/chat/api";
import { useChatStore } from "@/lib/chat/store";
import { useStore } from "@/state/store";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { GalleryCard } from "@/components/chat/GalleryCard";
import { PdfThumb } from "@/components/chat/PdfThumb";
import { ChatImageLightbox } from "@/components/chat/ChatImageLightbox";

const INLINE_REACTIONS = ["👍", "👎", "😂", "😮"];

/** Lista osób, które dały daną reakcję (podgląd — bez przełączania). */
function ReactionUsersPopover({
  emoji,
  userIds,
  onClose,
}: {
  emoji: string;
  userIds: string[];
  onClose: () => void;
}) {
  const profiles = useChatStore((s) => s.profiles);
  const myUserId = useChatStore((s) => s.userId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={`Reakcje ${emoji}`}
        className="relative z-10 w-full max-h-[70vh] overflow-hidden rounded-t-2xl border border-line bg-surface-overlay shadow-pop sm:max-w-sm sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            <span className="mr-1.5 text-base">{emoji}</span>
            {userIds.length === 1
              ? "1 osoba"
              : `${userIds.length} osób`}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={18} />
          </button>
        </div>
        <ul className="max-h-[min(55vh,320px)] overflow-y-auto thin-scrollbar p-2">
          {userIds.map((uid) => {
            const profile = profiles[uid];
            const name =
              uid === myUserId
                ? "Ty"
                : profile?.displayName?.trim() || "Nieznany";
            return (
              <li
                key={uid}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2"
              >
                <PersonAvatar
                  userId={uid}
                  avatarUrl={profile?.avatarUrl}
                  size={32}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {name}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line/60 px-4 py-2 text-[11px] text-ink-faint">
          Reakcję dodasz lub usuniesz z menu wiadomości (przytrzymaj).
        </p>
      </div>
    </div>,
    document.body,
  );
}

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
      ) : msg.kind === "checklist" ? (
        <>
          <div className="font-medium">
            <MessageBody body={msg.body} mentionNames={mentionNames} />
          </div>
          <ChecklistBlock msg={msg} />
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
        <div className="mt-1.5 flex w-fit max-w-full min-w-0 flex-col items-start gap-1.5">
          {msg.attachments!.map((att) => (
            <AttachmentTile key={att.id} att={att} />
          ))}
        </div>
      )}

      {msg.kind === "text" &&
        !msg.body &&
        (msg.attachments?.length ?? 0) === 0 && (
          <span className="text-xs text-ink-faint">Plik</span>
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
        className={`max-w-[min(85%,28rem)] opacity-[0.72] ${
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
                : "rounded-2xl border border-line/60 bg-surface-raised/50 px-3.5 py-2 text-[15px] leading-[1.45] text-ink shadow-card"
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
  const kind = classifyFile(att.mimeType, att.fileName);
  const isPdf = !isImage && isPdfAttachment(att.mimeType, att.fileName);
  const isVideo = !isImage && !isPdf && kind === "video";
  const isUploading =
    att.bucketPath === "pending:" || att.bucketPath.startsWith("pending:");
  const isEditable =
    !isUploading && att.attachIntent === "editable" && Boolean(att.spShareUrl);
  const Icon = fileKindIcon(kind);
  const tone = fileKindTone(kind);
  const ext = fileExtension(att.fileName) || kind.toUpperCase();
  const [imageOpen, setImageOpen] = useState(false);
  const thumbUrl = useSignedUrl(
    !isUploading && isImage ? (att.thumbPath ?? att.bucketPath) : null,
  );
  const fileUrl = useSignedUrl(!isUploading && isPdf ? att.bucketPath : null);
  const videoUrl = useSignedUrl(!isUploading && isVideo ? att.bucketPath : null);

  const openFull = async () => {
    if (isUploading) return;
    if (isImage) {
      setImageOpen(true);
      return;
    }
    if (isEditable && att.spShareUrl) {
      window.open(att.spShareUrl, "_blank", "noopener");
      return;
    }
    const url = await signedUrlFor(att.bucketPath);
    if (url) window.open(url, "_blank", "noopener");
  };

  if (isImage) {
    return (
      <>
        <button
          type="button"
          onClick={() => void openFull()}
          className="inline-block max-w-full overflow-hidden rounded-xl border border-line bg-surface-raised align-top"
          aria-label={`Podgląd ${att.fileName}`}
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={att.fileName}
              loading="lazy"
              className="block max-h-52 max-w-full h-auto w-auto"
            />
          ) : (
            <div className="flex h-24 w-32 items-center justify-center text-xs text-ink-faint">
              Obraz…
            </div>
          )}
        </button>
        {imageOpen && !isUploading && (
          <ChatImageLightbox
            bucketPath={att.bucketPath}
            fileName={att.fileName}
            onClose={() => setImageOpen(false)}
          />
        )}
      </>
    );
  }

  if (isVideo) {
    return (
      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-line bg-surface-raised">
        {isUploading ? (
          <div className="flex h-36 items-center justify-center gap-2 text-xs text-ink-faint">
            <Clock size={14} className="animate-pulse" />
            Wysyłanie wideo…
          </div>
        ) : videoUrl ? (
          <video
            controls
            playsInline
            preload="metadata"
            src={videoUrl}
            className="block max-h-72 w-full bg-black"
            aria-label={att.fileName}
          >
            Twoja przeglądarka nie obsługuje odtwarzania wideo.
          </video>
        ) : (
          <div className="flex h-36 items-center justify-center text-xs text-ink-faint">
            Wczytywanie wideo…
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2 border-t border-line px-2.5 py-1.5">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tone.bg} ${tone.fg}`}
          >
            <Icon size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-ink">
              {att.fileName}
            </div>
            <div className="text-[10px] text-ink-faint">
              {formatFileSize(att.sizeBytes)}
            </div>
          </div>
          {!isUploading ? (
            <button
              type="button"
              onClick={() => void openFull()}
              className="rounded-md p-1 text-ink-faint transition hover:bg-surface-overlay hover:text-ink"
              title="Otwórz / pobierz"
              aria-label={`Pobierz ${att.fileName}`}
            >
              <Download size={14} />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (isPdf) {
    return (
      <button
        type="button"
        onClick={() => void openFull()}
        className="flex w-full max-w-[11.5rem] flex-col overflow-hidden rounded-xl border border-line bg-surface-raised text-left transition hover:border-line-strong"
        aria-label={`Otwórz ${att.fileName}`}
      >
        <PdfThumb
          url={fileUrl}
          fileName={att.fileName}
          className="h-36 w-full"
        />
        <div className="flex min-w-0 items-center gap-2 border-t border-line px-2.5 py-2">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.bg} ${tone.fg}`}
          >
            <Icon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-ink">{att.fileName}</div>
            <div className="text-[10px] text-ink-faint">
              PDF · {formatFileSize(att.sizeBytes)}
            </div>
          </div>
          <Download size={14} className="shrink-0 text-ink-faint" />
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void openFull()}
      disabled={isUploading}
      className={`flex w-full min-w-0 max-w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition ${
        isEditable
          ? "border border-accent/40 bg-accent/12 hover:border-accent/55 hover:bg-accent/18"
          : "border border-line bg-surface-raised hover:border-line-strong"
      } ${isUploading ? "cursor-wait opacity-70" : ""}`}
      aria-label={
        isUploading
          ? `Wysyłanie ${att.fileName}`
          : isEditable
            ? `Otwórz do edycji ${att.fileName}`
            : `Otwórz ${att.fileName}`
      }
    >
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone.bg} ${tone.fg}`}
        >
          <Icon size={20} />
        </span>
        <span
          className={`absolute -bottom-0.5 -right-0.5 max-w-[2.6rem] truncate rounded px-1 py-px text-[8px] font-bold leading-none ${tone.badge}`}
        >
          {ext.slice(0, 4) || "FILE"}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink">
          {att.fileName || "Plik"}
        </span>
        <span
          className={`block text-[10px] ${
            isEditable ? "font-medium text-accent" : "text-ink-faint"
          }`}
        >
          {isUploading
            ? "Wysyłanie…"
            : isEditable
              ? att.spShareScope === "organization"
                ? `Do edycji (org) · ${formatFileSize(att.sizeBytes)}`
                : `Do edycji · ${formatFileSize(att.sizeBytes)}`
              : formatFileSize(att.sizeBytes)}
        </span>
      </span>
      {isUploading ? (
        <Clock size={14} className="shrink-0 animate-pulse text-ink-faint" />
      ) : isEditable ? (
        <ExternalLink size={14} className="shrink-0 text-accent" />
      ) : (
        <Download size={14} className="shrink-0 text-ink-faint" />
      )}
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

function ChecklistBlock({
  msg,
  onToggle,
}: {
  msg: ChatMessage;
  onToggle?: (msg: ChatMessage, itemId: string) => void;
}) {
  const items = msg.payload.checklist?.items ?? [];
  const doneCount = items.filter((it) => it.done).length;
  return (
    <div className="mt-2 flex min-w-[13rem] flex-col gap-1">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          disabled={!onToggle || Boolean(msg.sendState) || Boolean(msg.deletedAt)}
          onClick={() => onToggle?.(msg, it.id)}
          className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition ${
            it.done
              ? "border-line/60 bg-surface-overlay/30 text-ink-faint"
              : "border-line bg-surface-overlay/40 text-ink hover:border-line-strong"
          } disabled:opacity-60`}
        >
          <span
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
              it.done
                ? "border-accent bg-accent text-white"
                : "border-line-strong bg-surface-raised"
            }`}
          >
            {it.done && <Check size={11} strokeWidth={3} />}
          </span>
          <span className={`min-w-0 flex-1 leading-snug ${it.done ? "line-through" : ""}`}>
            {it.text}
          </span>
        </button>
      ))}
      <div className="px-0.5 text-[10px] text-ink-faint">
        {items.length === 0
          ? "Brak punktów."
          : `${doneCount}/${items.length} ukończone`}
      </div>
    </div>
  );
}

function HoverToolbar({
  mine,
  onReply,
  onOpenThread,
  onDetachFromThread,
  onOpenActions,
  onToggleReaction,
  onToggleSelect,
  selectMode,
  msg,
  replyCount,
  inThread,
}: {
  mine: boolean;
  msg: ChatMessage;
  replyCount: number;
  inThread: boolean;
  selectMode?: MessageSelectMode | null;
  onReply?: (msg: ChatMessage) => void;
  onOpenThread?: (rootId: string) => void;
  onDetachFromThread?: (msg: ChatMessage) => void;
  onOpenActions?: (msg: ChatMessage, anchor: DOMRect) => void;
  onToggleReaction?: (msg: ChatMessage, emoji: string) => void;
  onToggleSelect?: (msg: ChatMessage, opts?: { forceSplit?: boolean }) => void;
}) {
  const canDetach = Boolean(inThread && msg.threadRootId && onDetachFromThread);

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
        {canDetach && (
          <button
            type="button"
            title="Wyłącz z wątku"
            onClick={(e) => {
              e.stopPropagation();
              onDetachFromThread?.(msg);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-light transition hover:bg-ink/5 hover:text-ink dark:hover:bg-white/[0.08]"
          >
            <LogOut size={14} />
          </button>
        )}
        {onToggleSelect && (
          <button
            type="button"
            title={
              selectMode === "split"
                ? "Odznacz (wiele punktów)"
                : selectMode === "whole"
                  ? "Wiele punktów (klik) / odznacz"
                  : "Zaznacz wiadomość"
            }
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(msg);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleSelect(msg, { forceSplit: true });
            }}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-ink/5 dark:hover:bg-white/[0.08] ${
              selectMode
                ? "text-accent"
                : "text-ink-light hover:text-ink"
            }`}
          >
            {selectMode === "split" ? (
              <ListTree size={14} />
            ) : selectMode === "whole" ? (
              <CheckSquare size={14} />
            ) : (
              <Square size={14} />
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
  onDetachFromThread?: (msg: ChatMessage) => void;
  onOpenActions?: (msg: ChatMessage, anchor: DOMRect) => void;
  onReply?: (msg: ChatMessage) => void;
  onRetry?: (messageId: string) => void;
  onToggleReaction?: (msg: ChatMessage, emoji: string) => void;
  onVote?: (msg: ChatMessage, optionId: string) => void;
  onToggleChecklist?: (msg: ChatMessage, itemId: string) => void;
  onJumpTo?: (messageId: string) => void;
  onOpenRegistry?: (msg: ChatMessage) => void;
  onOpenGallery?: (galleryId: string) => void;
  /** Tryb zaznaczenia: null = niezaznaczona. */
  selectMode?: MessageSelectMode | null;
  /** Czy w rozmowie jest już jakieś zaznaczenie (klik w bańkę przełącza). */
  selectionActive?: boolean;
  onToggleSelect?: (msg: ChatMessage, opts?: { forceSplit?: boolean }) => void;
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
  onDetachFromThread,
  onOpenActions,
  onReply,
  onRetry,
  onToggleReaction,
  onVote,
  onToggleChecklist,
  onJumpTo,
  onOpenRegistry,
  onOpenGallery,
  selectMode = null,
  selectionActive = false,
  onToggleSelect,
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
  const attachmentsStretch =
    !msg.deletedAt &&
    (msg.attachments?.some((a) => !a.mimeType.startsWith("image/")) ?? false);
  const [reactionPreview, setReactionPreview] = useState<string | null>(null);

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
    const created = msg.payload?.createdItem;
    const createdItem = created ? items[created.itemId] : undefined;
    const createdGone = Boolean(
      created && (!createdItem || isItemDeleted(createdItem)),
    );
    const createdLabel =
      created?.type === "task"
        ? "Zadanie"
        : created?.type === "checklist"
          ? "Checklista"
          : "Wydarzenie";
    const createdTitle =
      createdItem?.title?.trim() ||
      msg.body.replace(/^Utworzono (?:zadanie|wydarzenie|checklistę):\s*/i, "").trim() ||
      "";

    const registryKind =
      msg.payload?.registry?.kind ??
      (msg.body.startsWith("📝 Zapisano notatkę")
        ? "note"
        : msg.body.startsWith("📌 Zapisano decyzję")
          ? "decision"
          : null);
    // „Cofnięto decyzję” — chmurka jak zapis, bez otwierania rejestru.
    const openCreated = Boolean(created && !createdGone);
    const openRegistry = Boolean(registryKind && onOpenRegistry);
    const clickable = openCreated || openRegistry;
    const removedLabel =
      created?.type === "task"
        ? "Usunięto zadanie"
        : created?.type === "checklist"
          ? "Usunięto checklistę"
          : "Usunięto wydarzenie";
    const pillText = createdGone
      ? createdTitle
        ? `${removedLabel}: ${createdTitle}`
        : created?.type === "checklist"
          ? "Checklista została usunięta"
          : `${createdLabel} zostało usunięte`
      : msg.body;
    const pill = (
      <div
        className={`max-w-full truncate whitespace-nowrap rounded-full border border-line bg-surface-raised/60 px-3.5 py-1.5 text-center text-[11px] leading-snug text-ink-faint ${
          clickable
            ? "cursor-pointer transition hover:border-accent/40 hover:bg-surface-raised hover:text-ink"
            : ""
        }`}
      >
        {pillText}
      </div>
    );
    return (
      <div className="my-2.5 flex justify-center px-3">
        {clickable ? (
          <button
            type="button"
            onClick={() => {
              if (openCreated && created) {
                setEditing(created.itemId);
                return;
              }
              onOpenRegistry?.(msg);
            }}
            className="max-w-[85%] border-0 bg-transparent p-0"
            title={
              openCreated
                ? `Otwórz ${createdLabel.toLowerCase()}`
                : registryKind === "note"
                  ? "Otwórz notatkę"
                  : "Otwórz decyzję"
            }
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
    const pad = "px-3.5 py-2";
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
      className={`group relative z-0 flex gap-2 px-3 hover:z-30 focus-within:z-30 ${
        showAuthor ? "mt-4" : "mt-1.5"
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
        className={`relative flex min-w-0 w-full flex-col ${
          mine ? "items-end" : "items-start"
        } ${
          msg.kind === "gallery" && !deleted
            ? "max-w-[min(96%,18.5rem)]"
            : "max-w-[min(85%,28rem)]"
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

        <div
          className={`relative max-w-full ${attachmentsStretch ? "w-full" : ""}`}
        >
          {canAct && (onOpenActions || onReply || onToggleReaction || onToggleSelect) && (
            <HoverToolbar
              mine={mine}
              msg={msg}
              replyCount={replyCount}
              inThread={inThread}
              selectMode={selectMode}
              onReply={onReply}
              onOpenThread={onOpenThread}
              onDetachFromThread={onDetachFromThread}
              onOpenActions={onOpenActions}
              onToggleReaction={onToggleReaction}
              onToggleSelect={onToggleSelect}
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
            onClick={
              canAct && onToggleSelect && (selectionActive || selectMode)
                ? (e) => {
                    const t = e.target as HTMLElement;
                    if (t.closest("a,button,input,textarea,[role='button']")) return;
                    onToggleSelect(msg);
                  }
                : undefined
            }
            className={`chat-msg-bubble relative box-border max-w-full min-w-0 overflow-hidden flow-root text-[15px] leading-[1.45] transition-colors ${
              attachmentsStretch ? "w-full" : ""
            } ${bubbleClass} ${pending ? "opacity-60" : ""} ${
              failed ? "ring-1 ring-inset ring-red-500/50" : ""
            } ${
              flash ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""
            } ${
              selectMode === "split"
                ? "ring-2 ring-thread ring-offset-1 ring-offset-surface"
                : selectMode === "whole"
                  ? "ring-2 ring-accent/70 ring-offset-1 ring-offset-surface"
                  : ""
            } ${
              canAct && onToggleSelect && (selectionActive || selectMode)
                ? "cursor-pointer"
                : ""
            }`}
          >
            {selectMode ? (
              <div
                className={`mb-1.5 flex items-center gap-1 text-[10px] font-medium ${
                  selectMode === "split" ? "text-thread" : "text-accent"
                }`}
              >
                {selectMode === "split" ? (
                  <>
                    <ListTree size={11} /> wiele punktów
                  </>
                ) : (
                  <>
                    <CheckSquare size={11} /> zaznaczona
                  </>
                )}
              </div>
            ) : null}
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
                                  : quoted.msg.kind === "checklist"
                                    ? `✅ ${quoted.msg.body || "Checklista"}`
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
                ) : msg.kind === "checklist" ? (
                  <>
                    <div className="font-medium">
                      <MessageBody body={msg.body} mentionNames={mentionNames} />
                    </div>
                    <ChecklistBlock msg={msg} onToggle={onToggleChecklist} />
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
                  <>
                    {msg.body && (
                      <MessageBody body={msg.body} mentionNames={mentionNames} />
                    )}
                    {!msg.body &&
                      (msg.attachments?.length ?? 0) === 0 &&
                      msg.kind === "text" && (
                        <span className="text-xs text-ink-faint">
                          {pending
                            ? "Wysyłanie pliku…"
                            : failed
                              ? "Nie udało się dołączyć pliku"
                              : "Plik"}
                        </span>
                      )}
                  </>
                )}

                {msg.kind !== "voice" && (msg.attachments?.length ?? 0) > 0 && (
                  <div
                    className={`mt-1.5 flex min-w-0 flex-col gap-1.5 ${
                      attachmentsStretch ? "w-full" : "w-fit max-w-full"
                    } ${mine ? "items-end" : "items-start"}`}
                  >
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
                title="Zobacz, kto zareagował"
                onClick={(e) => {
                  e.stopPropagation();
                  setReactionPreview(r.emoji);
                }}
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

        {reactionPreview ? (
          <ReactionUsersPopover
            emoji={reactionPreview}
            userIds={(msg.reactions ?? [])
              .filter((r) => r.emoji === reactionPreview)
              .map((r) => r.userId)}
            onClose={() => setReactionPreview(null)}
          />
        ) : null}

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

        {failed && (
          <div className="mt-1 space-y-0.5 px-1">
            {msg.sendError && (
              <p className="max-w-[18rem] text-[11px] leading-snug text-red-400/90">
                {msg.sendError}
              </p>
            )}
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(msg.id)}
                className="flex items-center gap-1.5 text-[11px] text-red-400 transition hover:text-red-300"
              >
                <RotateCw size={11} /> Nie wysłano — ponów
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
