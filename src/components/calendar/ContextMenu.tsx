import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface MenuAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  actions: MenuAction[];
  onClose: () => void;
}

export function ContextMenu({ x, y, actions, onClose }: ContextMenuProps) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - actions.length * 36 - 12);

  return createPortal(
    <div
      className="fixed z-[60] min-w-[208px] overflow-hidden rounded-xl border border-line bg-surface-overlay py-1 shadow-pop"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {actions.map((a, i) => (
        <button
          key={i}
          disabled={a.disabled}
          onClick={() => {
            a.onClick();
            onClose();
          }}
          className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
            a.disabled
              ? "cursor-not-allowed text-ink-faint"
              : a.danger
                ? "text-red-400 hover:bg-red-500/10"
                : "text-ink hover:bg-surface-raised"
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
