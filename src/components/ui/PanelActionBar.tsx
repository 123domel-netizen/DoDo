import { Plus } from "lucide-react";

export function PanelActionBar({
  addLabel,
  onAdd,
  counterLabel,
}: {
  addLabel: string;
  onAdd?: () => void;
  counterLabel: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-line px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">{counterLabel}</span>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent-grad px-2.5 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110"
        >
          <Plus size={14} strokeWidth={2.5} />
          {addLabel}
        </button>
      )}
    </div>
  );
}
