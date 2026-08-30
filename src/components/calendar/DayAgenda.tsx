import { AlarmClock, Calendar, CheckSquare } from "lucide-react";
import type { Group, Item } from "@/types";
import { fmt, fmtRange, fmtTime } from "@/lib/format";
import { itemVisual } from "@/lib/itemVisual";
import { allDayCalendarDate, allDayLastCalendarDate } from "@/lib/allDay";
import { itemSupportsTodoDone } from "@/lib/items";
import { DeadlineClock } from "@/components/calendar/DeadlineClock";
import { ReminderBell } from "@/components/calendar/ReminderBell";
import type { ReminderMarker } from "@/lib/reminders";
import type { DeadlineMarker } from "@/lib/deadlines";
import { deadlineIconDimmed, deadlineTooltipTitle } from "@/lib/deadlines";
import { useStore } from "@/state/store";

export type AgendaEntry =
  | { kind: "item"; at: Date; item: Item }
  | { kind: "reminder"; at: Date; marker: ReminderMarker }
  | { kind: "deadline"; at: Date; marker: DeadlineMarker };

export function DayAgenda({
  day,
  entries,
  groups,
  onOpen,
  onViewDay,
  onAdd,
}: {
  day: Date;
  entries: AgendaEntry[];
  groups: Record<string, Group>;
  onOpen: (id: string) => void;
  onViewDay?: (day: Date) => void;
  onAdd?: (day: Date) => void;
}) {
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto thin-scrollbar bg-surface px-3 pb-4 pt-3">
      <button
        type="button"
        onClick={onViewDay ? () => onViewDay(day) : undefined}
        className={`mb-3 text-left ${onViewDay ? "rounded-md transition hover:opacity-80" : "cursor-default"}`}
      >
        <h2 className="text-xl font-semibold uppercase tracking-tight text-ink">
          {fmt(day, "d")} {fmt(day, "EEE").replace(/\./g, "").toUpperCase()}.
        </h2>
      </button>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col">
          <p className="text-sm text-ink-faint">Pusto. Brak wydarzeń i zadań.</p>
          {onAdd && (
            <button
              type="button"
              onClick={() => onAdd(day)}
              className="mt-3 self-start rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
            >
              Dodaj wydarzenie
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry) => {
            if (entry.kind === "reminder") {
              const { marker } = entry;
              const vis = itemVisual(marker.item, groups);
              return (
                <button
                  key={marker.key}
                  type="button"
                  onClick={() => onOpen(marker.item.id)}
                  className="flex w-full items-start gap-2.5 rounded-xl border border-line/60 bg-surface-raised/40 px-2.5 py-2 text-left transition hover:bg-surface-overlay"
                  style={{ borderLeft: `3px solid ${vis.color}` }}
                >
                  <AlarmClock size={16} className="mt-0.5 shrink-0 text-amber-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {marker.item.title || "Zadanie"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-faint">
                      Przypomnienie {fmtTime(marker.at)}
                    </div>
                  </div>
                </button>
              );
            }
            if (entry.kind === "deadline") {
              const { marker } = entry;
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
                    <div className="mt-0.5 text-[11px] text-red-400">
                      Deadline: {fmtTime(marker.at)}
                    </div>
                  </div>
                </button>
              );
            }

            const it = entry.item;
            const vis = itemVisual(it, groups);
            const g = !vis.shared && it.groupId ? groups[it.groupId] : undefined;
            const canToggle = itemSupportsTodoDone(it);
            const Icon = it.type === "task" ? CheckSquare : Calendar;
            const timeLine = it.allDay
              ? allDaySubtitle(it)
              : fmtRange(it.start, it.end);
            const groupLine = vis.shared ? "SHARE" : g?.name;

            const body = (
              <>
                <Icon
                  size={16}
                  className="mt-0.5 shrink-0 text-ink-light"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-sm font-medium ${
                      it.done ? "text-ink-faint line-through" : "text-ink"
                    }`}
                  >
                    {it.title || (it.type === "task" ? "Nowe zadanie" : "Nowe wydarzenie")}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-faint">
                    <span>{timeLine}</span>
                    {groupLine && (
                      <>
                        <span aria-hidden>·</span>
                        <span>
                          Grupa: <span className="font-medium text-ink-light">{groupLine}</span>
                        </span>
                      </>
                    )}
                    <ReminderBell item={it} size={10} />
                    <DeadlineClock item={it} day={day} size={10} />
                  </div>
                </div>
              </>
            );

            if (canToggle) {
              return (
                <div
                  key={it.id}
                  className="flex w-full items-start gap-2.5 rounded-xl border border-line/60 bg-surface-raised/40 px-2.5 py-2"
                  style={{ borderLeft: `3px solid ${vis.color}`, opacity: vis.opacity }}
                >
                  <button type="button" onClick={() => onOpen(it.id)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                    {body}
                  </button>
                  <input
                    type="checkbox"
                    checked={it.done}
                    onChange={() => toggleTaskDone(it.id)}
                    disabled={vis.shared}
                    onClick={(e) => e.stopPropagation()}
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent ${vis.shared ? "cursor-not-allowed opacity-50" : ""}`}
                    title={it.done ? "Oznacz jako niewykonane" : "Oznacz jako wykonane"}
                  />
                </div>
              );
            }

            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onOpen(it.id)}
                className={`flex w-full items-start gap-2.5 rounded-xl border border-line/60 bg-surface-raised/40 px-2.5 py-2 text-left transition hover:bg-surface-overlay ${
                  vis.shared ? "border-dashed" : ""
                }`}
                style={{ borderLeft: `3px solid ${vis.color}`, opacity: vis.opacity }}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function allDaySubtitle(item: Item): string {
  const start = allDayCalendarDate(item.start);
  const last = allDayLastCalendarDate(item.end);
  if (fmt(start, "yyyy-MM-dd") === fmt(last, "yyyy-MM-dd")) return "Cały dzień";
  return `${fmt(start, "d MMM")} – ${fmt(last, "d MMM")}`;
}
