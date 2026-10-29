import { useEffect, useMemo, useState } from "react";
import { BellRing, X } from "lucide-react";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { resolveBoardConversation } from "@/lib/chat/api";
import {
  addBoardConversationRef,
  getBoardConversationRef,
} from "@/lib/chat/boardBridge";
import { overviewTitle } from "@/lib/chat/feed";
import { playIncomingMessageAlert } from "@/lib/chat/notifySound";
import {
  PING_ALERT_DISPLAY_MS,
  usePingAlerts,
} from "@/lib/chat/pingAlerts";
import { useChatStore } from "@/lib/chat/store";
import { useBoardsStore } from "@/lib/boards/store";
import { navigateToBoards } from "@/lib/boards/runtime";
import { navigateTo } from "@/lib/navigation";
import { useStore } from "@/state/store";

/**
 * Globalny czerwony alert PINGa (max 15 s): Zamknij / Otwórz rozmowę.
 */
export function PingAlert() {
  const queue = usePingAlerts((s) => s.queue);
  const dismiss = usePingAlerts((s) => s.dismiss);
  const alert = queue[0] ?? null;

  const profiles = useChatStore((s) => s.profiles);
  const overview = useChatStore((s) => s.overview);
  const myUserId = useChatStore((s) => s.userId);
  const items = useStore((s) => s.items);
  const boards = useBoardsStore((s) => s.boards);
  const topicsByBoard = useBoardsStore((s) => s.topicsByBoard);

  const [remainingMs, setRemainingMs] = useState(PING_ALERT_DISPLAY_MS);

  const senderName =
    (alert &&
      (profiles[alert.senderId]?.displayName ||
        overview
          .find((c) => c.id === alert.conversationId)
          ?.members.find((m) => m.userId === alert.senderId)?.displayName ||
        boards
          .flatMap((b) => b.members)
          .find((m) => m.userId === alert.senderId)?.displayName)) ||
    "Ktoś";

  const conversationLabel = useMemo(() => {
    if (!alert) return "";
    const boardRef = getBoardConversationRef(alert.conversationId);
    if (boardRef) {
      const board = boards.find((b) => b.id === boardRef.boardId);
      const topic = (topicsByBoard[boardRef.boardId] ?? []).find(
        (t) => t.id === boardRef.topicId,
      );
      if (board && topic) return `Tablica: ${board.name} · ${topic.title}`;
      if (topic) return topic.title;
      return "Temat na Tablicy";
    }
    // Fallback: conversation may be a board topic not yet in the ref map.
    for (const [boardId, topics] of Object.entries(topicsByBoard)) {
      const topic = topics.find((t) => t.conversationId === alert.conversationId);
      if (topic) {
        const board = boards.find((b) => b.id === boardId);
        return board ? `Tablica: ${board.name} · ${topic.title}` : topic.title;
      }
    }
    const entry = overview.find((c) => c.id === alert.conversationId);
    if (!entry) return "Rozmowa";
    return overviewTitle(entry, myUserId, (id) => items[id]?.title);
  }, [alert, overview, myUserId, items, boards, topicsByBoard]);

  const alertPingId = alert?.pingId ?? null;

  useEffect(() => {
    if (!alertPingId) return;
    setRemainingMs(PING_ALERT_DISPLAY_MS);
    playIncomingMessageAlert();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([200, 100, 200, 100, 400]);
      } catch {
        /* ignore */
      }
    }

    const started = Date.now();
    const tick = window.setInterval(() => {
      const left = PING_ALERT_DISPLAY_MS - (Date.now() - started);
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        window.clearInterval(tick);
        dismiss(alertPingId);
      }
    }, 100);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss(alertPingId);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.clearInterval(tick);
      window.removeEventListener("keydown", onKey);
    };
  }, [alertPingId, dismiss]);

  if (!alert) return null;

  const progress = remainingMs / PING_ALERT_DISPLAY_MS;

  const openConversation = () => {
    const pingId = alert.pingId;
    const conversationId = alert.conversationId;
    dismiss(pingId);

    void (async () => {
      let boardRef = getBoardConversationRef(conversationId);
      if (!boardRef) {
        for (const [boardId, topics] of Object.entries(topicsByBoard)) {
          const topic = topics.find((t) => t.conversationId === conversationId);
          if (topic) {
            boardRef = { boardId, topicId: topic.id };
            break;
          }
        }
      }
      if (!boardRef) {
        const resolved = await resolveBoardConversation(conversationId);
        if (resolved) {
          boardRef = resolved;
          addBoardConversationRef(conversationId, resolved);
        }
      }
      if (boardRef) {
        navigateToBoards(
          { boardId: boardRef.boardId, topicId: boardRef.topicId },
          "push",
        );
      } else {
        navigateTo({ view: "conversation", conversationId }, "push");
      }
    })();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ping-alert-title"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border-2 border-red-500 bg-surface-overlay shadow-pop">
        <div
          className="absolute left-0 top-0 h-1 bg-red-500 transition-[width] duration-100 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
        <div className="flex flex-col items-center gap-3 px-6 pb-5 pt-7 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg">
            <BellRing size={28} />
          </div>
          <PersonAvatar
            userId={alert.senderId}
            avatarUrl={profiles[alert.senderId]?.avatarUrl}
            size={48}
            className="border-2 border-red-500"
          />
          <div>
            <h2
              id="ping-alert-title"
              className="text-lg font-bold text-red-500"
            >
              PING od {senderName}
            </h2>
            <p className="mt-1 text-sm font-medium text-ink">{conversationLabel}</p>
            <p className="mt-2 text-sm text-ink-light">
              Potrzebuję, żebyś teraz spojrzał na tę rozmowę
            </p>
          </div>
          <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => dismiss(alert.pingId)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface-raised px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-surface"
            >
              <X size={16} />
              Zamknij
            </button>
            <button
              type="button"
              onClick={openConversation}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              <BellRing size={16} />
              Otwórz rozmowę
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
