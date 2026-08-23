import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  /** Nazwa okna dla czytników ekranu. */
  label?: string;
  /** Id nagłówka wewnątrz okna — ma pierwszeństwo przed `label`. */
  labelledBy?: string;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Liczba otwartych okien — przy zagnieżdżonych dialogach blokadę scrolla wolno
 * zdjąć dopiero po zamknięciu ostatniego z nich.
 */
let openModalCount = 0;

export function Modal({
  open,
  onClose,
  children,
  width = 560,
  label,
  labelledBy,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const fallbackLabelId = useId();

  // Escape + pułapka na Tab. Trzymamy to w jednym listenerze, bo obie rzeczy
  // dotyczą tego samego zdarzenia klawiatury.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Focus poza oknem (np. po kliknięciu w tło) — wciągnij go z powrotem.
      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Ustawienie focusu przy otwarciu i przywrócenie go przy zamknięciu.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    // Przycisk „Zamknij" jest pierwszy w DOM, ale focus ma trafić na pierwsze
    // pole treści — inaczej Enter po otwarciu zamykałby okno.
    const candidates = panel
      ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      : [];
    const firstField = candidates.find((el) => el.dataset.modalClose !== "true");
    (firstField ?? candidates[0] ?? panel)?.focus();

    return () => {
      // `isConnected` chroni przed przywracaniem focusu na usunięty element.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  // Blokada scrolla tła.
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    if (openModalCount === 0) {
      body.dataset.prevOverflow = body.style.overflow;
      body.style.overflow = "hidden";
    }
    openModalCount += 1;
    return () => {
      openModalCount -= 1;
      if (openModalCount === 0) {
        body.style.overflow = body.dataset.prevOverflow ?? "";
        delete body.dataset.prevOverflow;
      }
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : (label ?? "Okno dialogowe")}
        id={labelledBy ? undefined : fallbackLabelId}
        tabIndex={-1}
        className="relative w-full rounded-2xl border border-line bg-surface-overlay shadow-pop outline-none"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          data-modal-close="true"
          className="absolute right-3 top-3 rounded-md p-1 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
          aria-label="Zamknij"
        >
          <X size={18} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
