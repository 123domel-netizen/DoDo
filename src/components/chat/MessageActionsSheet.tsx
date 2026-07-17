import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CalendarPlus,
  CheckSquare,
  Copy,
  MessageSquare,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";

export type MessageAction =
  | "createTask"
  | "createEvent"
  | "openThread"
  | "copy"
  | "edit"
  | "delete";

interface MessageActionsSheetProps {
  msg: ChatMessage | null;
  mine: boolean;
  /** Wątki wyłączone w kontekście (np. wewnątrz wątku / dyskusji itemu). */
  allowThread?: boolean;
  onAction: (action: MessageAction, msg: ChatMessage) => void;
  onClose: () => void;
}

function ActionRow({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-surface-raised ${
        danger ? "text-red-400" : "text-ink"
      }`}
    >
      <span className={danger ? "text-red-400" : "text-ink-faint"}>{icon}</span>
      {label}
    </button>
  );
}

export function MessageActionsSheet({
  msg,
  mine,
  allowThread = true,
  onAction,
  onClose,
}: MessageActionsSheetProps) {
  if (!msg) return null;

  const act = (action: MessageAction) => {
    onAction(action, msg);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div
        className="relative rounded-t-2xl border-t border-line bg-surface-overlay p-3 shadow-pop"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
        <div className="mb-2 flex items-start gap-2 px-1">
          <div className="min-w-0 flex-1 truncate text-xs text-ink-faint">
            {msg.body.slice(0, 120) || "(załącznik)"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={16} />
          </button>
        </div>

        <ActionRow
          icon={<CheckSquare size={16} />}
          label="Utwórz zadanie"
          onClick={() => act("createTask")}
        />
        <ActionRow
          icon={<CalendarPlus size={16} />}
          label="Utwórz wydarzenie"
          onClick={() => act("createEvent")}
        />
        {allowThread && (
          <ActionRow
            icon={<MessageSquare size={16} />}
            label="Odpowiedz w wątku"
            onClick={() => act("openThread")}
          />
        )}
        <ActionRow icon={<Copy size={16} />} label="Kopiuj treść" onClick={() => act("copy")} />
        {mine && (
          <>
            <ActionRow icon={<Pencil size={16} />} label="Edytuj" onClick={() => act("edit")} />
            <ActionRow
              icon={<Trash2 size={16} />}
              label="Usuń"
              danger
              onClick={() => act("delete")}
            />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
