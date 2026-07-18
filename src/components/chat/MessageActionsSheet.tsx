import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CalendarPlus,
  CheckSquare,
  Copy,
  CornerUpLeft,
  Gavel,
  History,
  ListChecks,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  StickyNote,
  Trash2,
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
  | "saveNote"
  | "pinThread"
  | "openThread"
  | "copy"
  | "edit"
  | "history"
  | "delete";

export type MessageActionAnchor = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

interface MessageActionsSheetProps {
  msg: ChatMessage | null;
  mine: boolean;
  anchor: MessageActionAnchor | null;
  /** Wątki wyłączone w kontekście (np. wewnątrz wątku / dyskusji itemu). */
  allowThread?: boolean;
  onAction: (action: MessageAction, msg: ChatMessage, arg?: string) => void;
  onClose: () => void;
}

const MENU_WIDTH = 248;

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
      // pointerdown: unikamy „ghost click” po odmontowaniu portalu (który
      // potrafił od razu zamknąć świeżo otwarty widok wątku).
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] leading-snug transition ${
        danger
          ? "text-red-400 hover:bg-red-500/10"
          : "text-ink hover:bg-white/[0.06]"
      }`}
    >
      <span className={`shrink-0 ${danger ? "text-red-400" : "text-ink-faint"}`}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-line/80" />;
}

function clampMenuPosition(
  anchor: MessageActionAnchor,
  menuH: number,
): { top: number; left: number } {
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pointLike = anchor.width < 4 && anchor.height < 4;

  // Preferuj tuż pod anchorem; jeśli brak miejsca — nad nim.
  const spaceBelow = vh - anchor.bottom - pad;
  const spaceAbove = anchor.top - pad;
  const placeAbove = spaceBelow < menuH && spaceAbove > spaceBelow;

  let top = placeAbove
    ? anchor.top - menuH - (pointLike ? 0 : 6)
    : anchor.bottom + (pointLike ? 0 : 6);
  top = Math.max(pad, Math.min(top, vh - menuH - pad));

  // Przy punkcie (PPM) — menu przy kursorze; przy „⋯” — wyrównaj do prawej.
  let left = pointLike ? anchor.left : anchor.right - MENU_WIDTH;
  left = Math.max(pad, Math.min(left, vw - MENU_WIDTH - pad));

  return { top, left };
}

export function MessageActionsSheet({
  msg,
  mine,
  anchor,
  allowThread = true,
  onAction,
  onClose,
}: MessageActionsSheetProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!msg || !anchor || !menuRef.current) {
      setPos(null);
      return;
    }
    const h = menuRef.current.getBoundingClientRect().height;
    const next = clampMenuPosition(anchor, h);
    setPos({ top: next.top, left: next.left });
  }, [msg, anchor]);

  useEffect(() => {
    if (!msg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [msg, onClose]);

  if (!msg || !anchor) return null;

  const act = (action: MessageAction, arg?: string) => {
    onAction(action, msg, arg);
    onClose();
  };

  const isTextual = msg.kind === "text" || msg.kind === "poll";
  const preview =
    msg.body.slice(0, 72) ||
    (msg.kind === "voice"
      ? "🎤 Wiadomość głosowa"
      : msg.kind === "gif"
        ? "GIF"
        : "(załącznik)");

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/25"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label="Akcje wiadomości"
        className="absolute overflow-hidden rounded-xl border border-line/80 bg-surface-overlay/95 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-md"
        style={{
          width: MENU_WIDTH,
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          opacity: pos ? 1 : 0,
          transformOrigin: "top right",
        }}
      >
        <div className="border-b border-line/60 px-3 py-2">
          <p className="truncate text-[11px] text-ink-faint">{preview}</p>
        </div>

        <div className="flex items-center justify-center gap-0.5 px-2 py-1.5">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                act("react", emoji);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition hover:bg-white/[0.08] hover:scale-110"
              aria-label={`Reaguj ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>

        <Divider />

        <div className="px-1 pb-1">
          <ActionRow
            icon={<CornerUpLeft size={14} />}
            label="Odpowiedz"
            onClick={() => act("reply")}
          />
          {allowThread && (
            <ActionRow
              icon={<MessageSquare size={14} />}
              label="Odpowiedz w wątku"
              onClick={() => act("openThread")}
            />
          )}
          {!msg.threadRootId && msg.kind !== "system" && (
            <ActionRow
              icon={msg.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}
              label={msg.pinnedAt ? "Odepnij wątek" : "Przypnij wątek"}
              onClick={() => act("pinThread")}
            />
          )}

          {isTextual && (
            <>
              <Divider />
              <ActionRow
                icon={<CheckSquare size={14} />}
                label="Utwórz zadanie"
                onClick={() => act("createTask")}
              />
              <ActionRow
                icon={<CalendarPlus size={14} />}
                label="Utwórz wydarzenie"
                onClick={() => act("createEvent")}
              />
              <ActionRow
                icon={<ListChecks size={14} />}
                label="Utwórz checklistę"
                onClick={() => act("createChecklist")}
              />
              <ActionRow
                icon={<Gavel size={14} />}
                label="Zapisz jako decyzję"
                onClick={() => act("saveDecision")}
              />
              <ActionRow
                icon={<StickyNote size={14} />}
                label="Zapisz jako notatkę"
                onClick={() => act("saveNote")}
              />
              <ActionRow
                icon={<Copy size={14} />}
                label="Kopiuj treść"
                onClick={() => act("copy")}
              />
            </>
          )}

          {(msg.editedAt || mine) && <Divider />}

          {msg.editedAt && (
            <ActionRow
              icon={<History size={14} />}
              label="Historia edycji"
              onClick={() => act("history")}
            />
          )}
          {mine && msg.kind === "text" && (
            <ActionRow
              icon={<Pencil size={14} />}
              label="Edytuj"
              onClick={() => act("edit")}
            />
          )}
          {mine && (
            <ActionRow
              icon={<Trash2 size={14} />}
              label="Usuń"
              danger
              onClick={() => act("delete")}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
