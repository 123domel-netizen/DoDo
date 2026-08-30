import { AlarmClock, CheckSquare } from "lucide-react";
import type { Group, Item } from "@/types";
import { fmtRange, fmtTime } from "@/lib/format";
import { itemVisual } from "@/lib/itemVisual";
import type { DeadlineMarker } from "@/lib/deadlines";
import { deadlineIconDimmed, deadlineTooltipTitle } from "@/lib/deadlines";

export function DaySummaryChips({
  eventCount,
  taskCount,
  deadlineCount,
}: {
  eventCount: number;
  taskCount: number;
  deadlineCount: number;
}) {
  const parts: string[] = [];
  if (eventCount > 0) parts.push(`${eventCount} wydarz.`);
  if (taskCount > 0) parts.push(`${taskCount} zadań`);
  if (deadlineCount > 0) parts.push(`${deadlineCount} deadline`);
  if (parts.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {parts.map((p) => (
        <span
          key={p}
          className="rounded-full bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-ink-light"
        >
          {p}
        </span>
      ))}
    </div>
  );
}

export function NextUpcomingCard({
  item,
  groups,
  onOpen,
}: {
  item: Item;
  groups: Record<string, Group>;
  onOpen: (id: string) => void;
}) {
  const vis = itemVisual(item, groups);
  const g = !vis.shared && item.groupId ? groups[item.groupId] : undefined;

  return (
    <section className="border-b border-line px-4 py-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-accent">
        Najbliższe
      </h3>
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className="flex w-full items-start gap-3 rounded-xl border border-accent/25 bg-accent/8 px-3 py-2.5 text-left transition hover:bg-accent/12"
        style={{ borderLeft: `3px solid ${vis.color}` }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tabular-nums text-ink-light">
            {item.allDay ? "Cały dzień" : fmtRange(item.start, item.end)}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-ink">
            {item.title || "Wydarzenie"}
          </div>
          {(g || vis.shared) && (
            <div className="mt-0.5 text-[11px] text-ink-faint">
              {vis.shared ? "SHARE" : g?.name}
            </div>
          )}
        </div>
      </button>
    </section>
  );
}

export function MobileTasksSection({
  tasks,
  groups,
  onOpen,
  onToggle,
}: {
  tasks: Item[];
  groups: Record<string, Group>;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  if (tasks.length === 0) return null;

  return (
    <section className="border-t border-line px-3 py-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Zadania
      </h3>
      <div className="space-y-1">
        {tasks.map((it) => {
          const vis = itemVisual(it, groups);
          const g = !vis.shared && it.groupId ? groups[it.groupId] : undefined;
          return (
            <div
              key={it.id}
              className="flex items-start gap-2.5 rounded-xl border border-line/60 bg-surface-raised/40 px-2.5 py-2"
              style={{ borderLeft: `3px solid ${vis.color}`, opacity: vis.opacity }}
            >
              <input
                type="checkbox"
                checked={it.done}
                onChange={() => onToggle(it.id)}
                disabled={vis.shared}
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent ${
                  vis.shared ? "cursor-not-allowed opacity-50" : ""
                }`}
              />
              <button
                type="button"
                onClick={() => onOpen(it.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div
                  className={`truncate text-sm font-medium ${
                    it.done ? "text-ink-faint line-through" : "text-ink"
                  }`}
                >
                  {it.title || "Nowe zadanie"}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-faint">
                  {it.hasDueDate && (
                    <span>{it.allDay ? "Cały dzień" : fmtTime(it.end)}</span>
                  )}
                  {(vis.shared || g) && (
                    <>
                      {it.hasDueDate && <span aria-hidden>·</span>}
                      <span>{vis.shared ? "SHARE" : g?.name}</span>
                    </>
                  )}
                </div>
              </button>
              <CheckSquare size={14} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function MobileDeadlinesSection({
  markers,
  onOpen,
}: {
  markers: DeadlineMarker[];
  onOpen: (id: string) => void;
}) {
  if (markers.length === 0) return null;

  return (
    <section className="border-t border-line px-3 py-3 pb-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Deadline
      </h3>
      <div className="space-y-1">
        {markers.map((marker) => {
          const dim = deadlineIconDimmed(marker.item);
          return (
            <button
              key={marker.key}
              type="button"
              onClick={() => onOpen(marker.item.id)}
              title={deadlineTooltipTitle(marker.item)}
              className={`flex w-full items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-left transition hover:bg-red-500/15 ${
                dim ? "opacity-50" : ""
              }`}
            >
              <AlarmClock size={16} className="mt-0.5 shrink-0 text-red-500" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">
                  {marker.item.title || "Deadline"}
                </div>
                <div className="mt-0.5 text-[11px] font-medium tabular-nums text-red-400">
                  {fmtTime(marker.at)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
