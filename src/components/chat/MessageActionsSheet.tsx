import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CalendarPlus,
  CheckSquare,
  Copy,
  CornerUpLeft,
  History,
  ListChecks,
  MessageSquare,
  Pencil,
  Pin,
  Trash2,
  X,
} from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";
import { QUICK_REACTIONS } from "@/lib/chat/polls";

export type MessageAction =
  | "react"
  | "reply"
  | "createTask"
  | "createEvent"
  | "createChecklist"
  | "saveDecision"
  | "openThread"
  | "copy"
  | "edit"
  | "history"
  | "delete";

interface MessageActionsSheetProps {
  msg: ChatMessage | null;
  mine: boolean;
  /** Wątki wyłączone w kontekście (np. wewnątrz wątku / dyskusji itemu). */
  allowThread?: boolean;
  onAction: (action: MessageAction, msg: ChatMessage, arg?: string) => void;
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

  const act = (action: MessageAction, arg?: string) => {
    onAction(action, msg, arg);
    onClose();
  };

  const isTextual = msg.kind === "text" || msg.kind === "poll";

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div
        className="thin-scrollbar relative max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface-overlay p-3 shadow-pop"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
        <div className="mb-2 flex items-start gap-2 px-1">
          <div className="min-w-0 flex-1 truncate text-xs text-ink-faint">
            {msg.body.slice(0, 120) ||
              (msg.kind === "voice"
                ? "🎤 Wiadomość głosowa"
                : msg.kind === "gif"
                  ? "GIF"
                  : "(załącznik)")}
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

        <div className="mb-2 flex justify-between gap-1 px-1">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => act("react", emoji)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-xl transition hover:bg-surface-raised"
              aria-label={`Reaguj ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>

        <ActionRow
          icon={<CornerUpLeft size={16} />}
          label="Odpowiedz (cytuj)"
          onClick={() => act("reply")}
        />
        {allowThread && (
          <ActionRow
            icon={<MessageSquare size={16} />}
            label="Odpowiedz w wątku"
            onClick={() => act("openThread")}
          />
        )}
        {isTextual && (
          <>
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
            <ActionRow
              icon={<ListChecks size={16} />}
              label="Utwórz checklistę"
              onClick={() => act("createChecklist")}
            />
            <ActionRow
              icon={<Pin size={16} />}
              label="Zapisz jako decyzję"
              onClick={() => act("saveDecision")}
            />
            <ActionRow
              icon={<Copy size={16} />}
              label="Kopiuj treść"
              onClick={() => act("copy")}
            />
          </>
        )}
        {msg.editedAt && (
          <ActionRow
            icon={<History size={16} />}
            label="Historia edycji"
            onClick={() => act("history")}
          />
        )}
        {mine && (
          <>
            {msg.kind === "text" && (
              <ActionRow
                icon={<Pencil size={16} />}
                label="Edytuj"
                onClick={() => act("edit")}
              />
            )}
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
