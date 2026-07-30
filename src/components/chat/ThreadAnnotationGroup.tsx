import { MessageSquare } from "lucide-react";
import { format, isToday } from "date-fns";
import { pl } from "date-fns/locale";
import type { ChatMessage } from "@/lib/chat/types";
import { messagePreviewLabel } from "@/lib/chat/types";
import { threadDisplayTitle } from "@/lib/chat/feed";
import { useChatStore } from "@/lib/chat/store";

interface ThreadAnnotationGroupProps {
  messages: ChatMessage[];
  rootId: string;
  threadTitle?: string;
  profiles: Record<string, { displayName?: string | null }>;
  myUserId: string | null;
  showTime: boolean;
  flashMessageId?: string | null;
  onOpenThread?: (rootId: string) => void;
}

function linePreview(msg: ChatMessage): string {
  if (msg.deletedAt) return "Wiadomość usunięta";
  return (
    messagePreviewLabel(msg.kind, msg.body).trim() ||
    (msg.attachments?.length ? "(załącznik)" : "…")
  );
}

export function ThreadAnnotationGroup({
  messages,
  rootId,
  threadTitle: threadTitleProp,
  profiles,
  myUserId,
  showTime,
  flashMessageId,
  onOpenThread,
}: ThreadAnnotationGroupProps) {
  const last = messages[messages.length - 1]!;
  const resolvedThreadTitle = useChatStore((s) => {
    if (threadTitleProp) return threadTitleProp;
    const conversationId = last.conversationId;
    const root =
      s.messagesByConv[conversationId]?.find((m) => m.id === rootId) ??
      s.threadByRoot[rootId]?.find((m) => m.id === rootId) ??
      s.pinnedByConv[conversationId]?.find((m) => m.id === rootId) ??
      s.focusFeed?.messages.find((m) => m.id === rootId);
    return threadDisplayTitle(root);
  });

  const allMine = messages.every((m) => m.authorUserId === myUserId);
  const flash = Boolean(flashMessageId && messages.some((m) => m.id === flashMessageId));
  const timeLabel = showTime
    ? format(
        new Date(last.createdAt),
        isToday(new Date(last.createdAt)) ? "HH:mm" : "d MMM HH:mm",
        { locale: pl },
      )
    : null;

  return (
    <button
      type="button"
      data-message-id={last.id}
      onClick={() => onOpenThread?.(rootId)}
      title="Otwórz wątek"
      className={`mx-3 my-0.5 flex w-[calc(100%-1.5rem)] max-w-full flex-col gap-0.5 rounded-lg border-l-[3px] border-thread bg-thread/12 px-2.5 py-1.5 text-left transition hover:bg-thread/20 ${
        flash ? "ring-2 ring-thread/50 ring-offset-1 ring-offset-surface" : ""
      } ${allMine ? "ml-auto mr-3" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] leading-none text-thread">
        <MessageSquare size={10} className="shrink-0" />
        <span className="min-w-0 truncate font-semibold">
          {resolvedThreadTitle || "Wątek"}
        </span>
        {timeLabel && (
          <span className="ml-auto shrink-0 tabular-nums text-ink-faint">{timeLabel}</span>
        )}
      </div>
      {messages.map((msg, i) => {
        const authorName = profiles[msg.authorUserId]?.displayName || "Nieznany";
        const prevAuthor = i > 0 ? messages[i - 1]!.authorUserId : null;
        const showAuthorName = msg.authorUserId !== prevAuthor;
        const preview = linePreview(msg);
        return (
          <div
            key={msg.id}
            data-message-id={msg.id}
            className="line-clamp-2 min-w-0 text-[12px] leading-snug text-ink-light"
          >
            {showAuthorName ? (
              <>
                <span className="font-medium text-ink">{authorName}</span>
                <span className="text-ink-faint">: </span>
              </>
            ) : null}
            <span className={msg.deletedAt ? "italic text-ink-faint" : "text-ink"}>
              {preview}
            </span>
          </div>
        );
      })}
    </button>
  );
}
