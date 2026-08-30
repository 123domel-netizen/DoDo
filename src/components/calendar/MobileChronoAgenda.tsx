import { useCallback, useEffect, useMemo, useState } from "react";
import { isSameDay } from "date-fns";
import { AlarmClock } from "lucide-react";
import type { Group, Item } from "@/types";
import { fmt, fmtTime } from "@/lib/format";
import { itemVisual } from "@/lib/itemVisual";
import { baseItemId } from "@/lib/itemId";
import { effectiveTagIds, resolveItemTags } from "@/lib/tags";
import { useStore } from "@/state/store";
import { buildMobileDayEntries, type MobileDayEntry } from "@/lib/mobileDayEntries";
import type { ReminderMarker } from "@/lib/reminders";
import type { DeadlineMarker } from "@/lib/deadlines";
import { deadlineIconDimmed, deadlineTooltipTitle } from "@/lib/deadlines";
import { DashboardEventRow } from "@/components/dashboard/TodayDashboardPanel";
import { DASHBOARD_LEAD_COL } from "@/components/dashboard/dashboardRowLayout";

function useNow(tickMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, tickMs);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tickMs]);
  return now;
}

export function MobileChronoAgenda({
  day,
  items,
  reminderMarkers,
  deadlineMarkers,
  groups,
  onOpen,
  emptyMessage = "Brak wydarzeń w tym dniu.",
  excludeBandItems = true,
}: {
  day: Date;
  items: Item[];
  reminderMarkers: ReminderMarker[];
  deadlineMarkers: DeadlineMarker[];
  groups: Record<string, Group>;
  onOpen: (id: string) => void;
  emptyMessage?: string;
  excludeBandItems?: boolean;
}) {
  const now = useNow();
  const today = isSameDay(day, now);
  const itemsMap = useStore((s) => s.items);
  const tagsMap = useStore((s) => s.tags);
  const myTagIdsByItem = useStore((s) => s.myTagIdsByItem);

  const tagsForItem = useCallback(
    (item: Item) => {
      const baseId = baseItemId(item.id);
      const source = itemsMap[baseId] ?? item;
      return resolveItemTags(effectiveTagIds(source, myTagIdsByItem), tagsMap);
    },
    [itemsMap, tagsMap, myTagIdsByItem],
  );

  const entries = useMemo(
    () =>
      buildMobileDayEntries(day, items, reminderMarkers, deadlineMarkers, {
        excludeBandItems,
      }),
    [day, items, reminderMarkers, deadlineMarkers, excludeBandItems],
  );

  const nowInsertIdx = useMemo(() => {
    if (!today) return -1;
    const t = now.getTime();
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].at.getTime() > t) return i;
    }
    return entries.length;
  }, [entries, today, now]);

  if (entries.length === 0) {
    return (
      <div className="px-4 py-6">
        {today && <NowLine label={fmt(now, "HH:mm")} />}
        <p className="text-sm text-ink-faint">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1 px-3 py-2">
      {entries.map((entry, i) => (
        <div key={entryKey(entry)}>
          {today && i === nowInsertIdx && <NowLine label={fmt(now, "HH:mm")} />}
          <ChronoRow
            entry={entry}
            groups={groups}
            tagsForItem={tagsForItem}
            onOpen={onOpen}
          />
        </div>
      ))}
      {today && nowInsertIdx === entries.length && (
        <NowLine label={fmt(now, "HH:mm")} />
      )}
    </div>
  );
}

function entryKey(entry: MobileDayEntry): string {
  if (entry.kind === "item") return entry.item.id;
  return entry.marker.key;
}

function NowLine({ label }: { label: string }) {
  return (
    <div className="relative my-1.5 flex items-center gap-1.5" aria-hidden>
      <span
        className={`${DASHBOARD_LEAD_COL} text-[10px] font-semibold tabular-nums text-accent`}
      >
        {label}
      </span>
      <div className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-glow" />
      <div className="h-[2px] flex-1 bg-accent" />
    </div>
  );
}

function ChronoRow({
  entry,
  groups,
  tagsForItem,
  onOpen,
}: {
  entry: MobileDayEntry;
  groups: Record<string, Group>;
  tagsForItem: (item: Item) => ReturnType<typeof resolveItemTags>;
  onOpen: (id: string) => void;
}) {
  if (entry.kind === "reminder") {
    const { marker } = entry;
    const vis = itemVisual(marker.item, groups);
    return (
      <button
        type="button"
        onClick={() => onOpen(marker.item.id)}
        className="group flex w-full min-w-0 items-center gap-1.5 rounded-md border border-line/50 bg-surface-raised/30 px-1.5 py-1 text-left transition hover:bg-surface-overlay"
        style={{ borderLeft: `3px solid ${vis.color}` }}
      >
        <div
          className={`${DASHBOARD_LEAD_COL} flex-col text-[10px] font-medium tabular-nums leading-tight text-ink-light`}
        >
          <div>{fmtTime(marker.at)}</div>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-sm font-medium leading-snug text-ink">
            {marker.item.title || "Zadanie"}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-400">
            <AlarmClock size={10} aria-hidden />
            <span>Przypomnienie</span>
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
        type="button"
        onClick={() => onOpen(marker.item.id)}
        title={deadlineTooltipTitle(marker.item)}
        className={`group flex w-full min-w-0 items-center gap-1.5 rounded-md border border-line/50 bg-surface-raised/30 px-1.5 py-1 text-left transition hover:bg-surface-overlay ${
          dim ? "opacity-50" : ""
        }`}
        style={{ borderLeft: "3px solid rgb(239 68 68)" }}
      >
        <div
          className={`${DASHBOARD_LEAD_COL} flex-col text-[10px] font-medium tabular-nums leading-tight text-red-400`}
        >
          <div>{fmtTime(marker.at)}</div>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-sm font-medium leading-snug text-ink">
            {marker.item.title || "Deadline"}
          </div>
        </div>
      </button>
    );
  }

  const it = entry.item;
  const g = it.groupId ? groups[it.groupId] : undefined;

  return (
    <DashboardEventRow
      item={it}
      group={g}
      itemTags={tagsForItem(it)}
      onOpen={() => onOpen(it.id)}
    />
  );
}
