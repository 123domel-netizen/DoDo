import { ChevronDown, ChevronRight } from "lucide-react";

export function MobileSectionToggle({
  expanded,
  onToggle,
  labelExpand = "Rozwiń",
  labelCollapse = "Zwiń",
}: {
  expanded: boolean;
  onToggle: () => void;
  labelExpand?: string;
  labelCollapse?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      title={expanded ? labelCollapse : labelExpand}
      aria-label={expanded ? labelCollapse : labelExpand}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
    >
      <span className="text-[10px] font-medium normal-case tracking-normal">
        {expanded ? "Zwiń" : "Rozwiń"}
      </span>
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
  );
}
