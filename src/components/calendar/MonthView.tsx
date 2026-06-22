import { isSameDay, isSameMonth, startOfDay } from "date-fns";
import { Bell } from "lucide-react";
import type { Group, Item } from "@/types";
import { useStore } from "@/state/store";
import { fmt, fmtTime, tint } from "@/lib/format";
import { itemCoversCalendarDay } from "@/lib/allDay";
import { weekendColumnBg } from "@/lib/weekend";
import { groupIdForNewItem } from "@/lib/groups";
import { isSharedItem, SHARE_CALENDAR_COLOR, SHARE_CALENDAR_OPACITY } from "@/lib/share";
import type { ReminderMarker } from "@/lib/reminders";
import { ReminderBell } from "@/components/calendar/ReminderBell";

interface MonthViewProps {
  days: Date[];
  items: Item[];
  reminderMarkers: ReminderMarker[];
  groups: Record<string, Group>;
}

export function MonthView({ days, items, reminderMarkers, groups }: MonthViewProps) {
  const anchor = new Date(useStore((s) => s.settings.anchorDate));
  const setEditing = useStore((s) => s.setEditing);
  const startDraft = useStore((s) => s.startDraft);

  const weekdayLabels = days.slice(0, 7);

  function entriesForDay(day: Date) {
    const dayItems = items
      .filter((it) => itemCoversCalendarDay(it, day))
      .map((it) => ({ kind: "item" as const, at: new Date(it.start), item: it }));
    const dayMarkers = reminderMarkers
      .filter((m) => isSameDay(m.at, day))
      .map((m) => ({ kind: "marker" as const, at: m.at, marker: m }));
    return [...dayItems, ...dayMarkers].sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="grid border-b border-line bg-surface"
        style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 0.52fr 0.52fr" }}
      >
        {weekdayLabels.map((d, i) => (
          <div key={i} className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-ink-faint">
            {fmt(d, "EEEE")}
          </div>
        ))}
      </div>
      <div
        className="grid flex-1 overflow-y-auto thin-scrollbar"
        style={{
          gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 0.52fr 0.52fr",
          gridAutoRows: "minmax(0, 1fr)",
        }}
      >
        {days.map((day, i) => {
          const dayEntries = entriesForDay(day);
          const inMonth = isSameMonth(day, anchor);
          const today = isSameDay(day, new Date());
          const weekendBg = weekendColumnBg(day);
          return (
            <div
              key={i}
              className={`group min-h-[96px] border-b border-r border-line p-1 transition-colors hover:bg-surface-raised ${
                weekendBg ? "" : inMonth ? "bg-surface" : "bg-canvas"
              }`}
              style={weekendBg ? { backgroundColor: weekendBg } : undefined}
              onDoubleClick={() => {
                const start = new Date(startOfDay(day));
                start.setHours(9, 0, 0, 0);
                startDraft({
                  type: "event",
                  start: start.toISOString(),
                  end: new Date(start.getTime() + 3600000).toISOString(),
                  groupId: groupIdForNewItem(),
                });
              }}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    today
                      ? "bg-accent text-white shadow-glow"
                      : inMonth
                        ? "text-ink"
                        : "text-ink-faint"
                  }`}
                >
                  {fmt(day, "d")}
                </span>
              </div>
              <div className="space-y-0.5">
                {dayEntries.slice(0, 4).map((entry) => {
                  if (entry.kind === "marker") {
                    const { marker } = entry;
                    const g = marker.item.groupId ? groups[marker.item.groupId] : undefined;
                    const color = g?.color ?? "#9A8574";
                    return (
                      <button
                        key={marker.key}
                        onClick={() => setEditing(marker.item.id)}
                        title={`${marker.item.title || "Zadanie"} · przypomnienie ${fmtTime(marker.at)}`}
                        className="flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] text-amber-200"
                        style={{ background: tint(color, 0.18) }}
                      >
                        <Bell size={10} aria-hidden />
                        <span className="text-ink-faint">{fmtTime(marker.at)}</span>
                      </button>
                    );
                  }
                  const it = entry.item;
                  const shared = isSharedItem(it);
                  const g = !shared && it.groupId ? groups[it.groupId] : undefined;
                  const color = shared ? SHARE_CALENDAR_COLOR : (g?.color ?? "#0b6e99");
                  return (
                    <button
                      key={it.id}
                      onClick={() => setEditing(it.id)}
                      className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] text-ink ${
                        shared ? "border border-dashed border-line" : ""
                      }`}
                      style={{
                        background: tint(color, 0.18),
                        boxShadow: `inset 2px 0 0 ${color}`,
                        opacity: shared ? SHARE_CALENDAR_OPACITY : 1,
                      }}
                    >
                      {!it.allDay && <span className="text-ink-faint">{fmtTime(it.start)}</span>}
                      <span className={`min-w-0 truncate font-medium ${it.done ? "line-through opacity-60" : ""}`}>
                        {it.title || "Nowe wydarzenie"}
                      </span>
                      <ReminderBell item={it} size={9} />
                    </button>
                  );
                })}
                {dayEntries.length > 4 && (
                  <div className="px-1 text-[10px] text-ink-faint">
                    +{dayEntries.length - 4} więcej
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
