import type { Item, ItemRecurrence, RecurrencePresetId } from "@/types";

const WEEKDAY_IC = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export function weekdayFromItemStart(item: Pick<Item, "start">): number {
  return new Date(item.start).getDay();
}

export function presetRecurrence(
  preset: RecurrencePresetId,
  item: Pick<Item, "start">,
): ItemRecurrence | null {
  switch (preset) {
    case "none":
      return null;
    case "daily":
      return { frequency: "daily", interval: 1 };
    case "weekly":
      return { frequency: "weekly", interval: 1, byWeekday: [weekdayFromItemStart(item)] };
    case "monthly":
      return { frequency: "monthly", interval: 1 };
    case "yearly":
      return { frequency: "yearly", interval: 1 };
    case "weekdays":
      return { frequency: "daily", interval: 1, weekdaysOnly: true };
    default:
      return null;
  }
}

function formatRruleUntil(iso: string): string {
  const d = new Date(iso);
  d.setUTCHours(23, 59, 59, 0);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function appendEnd(rule: string, rec: ItemRecurrence): string {
  if (rec.count != null && rec.count > 0) return `${rule};COUNT=${rec.count}`;
  if (rec.until) return `${rule};UNTIL=${formatRruleUntil(rec.until)}`;
  return rule;
}

/** Konwersja lokalnej reguły na linie RRULE (kompatybilne z rrule). */
export function nativeRecurrenceToRruleLines(
  rec: ItemRecurrence,
  item: Pick<Item, "start">,
): string[] {
  const interval = Math.max(1, rec.interval || 1);

  if (rec.weekdaysOnly) {
    return [appendEnd("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR", rec)];
  }

  switch (rec.frequency) {
    case "daily":
      return [appendEnd(`RRULE:FREQ=DAILY;INTERVAL=${interval}`, rec)];
    case "weekly": {
      const days =
        rec.byWeekday?.length
          ? rec.byWeekday.map((d) => WEEKDAY_IC[d] ?? "MO").join(",")
          : WEEKDAY_IC[weekdayFromItemStart(item)];
      return [appendEnd(`RRULE:FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${days}`, rec)];
    }
    case "monthly":
      return [appendEnd(`RRULE:FREQ=MONTHLY;INTERVAL=${interval}`, rec)];
    case "yearly":
      return [appendEnd(`RRULE:FREQ=YEARLY;INTERVAL=${interval}`, rec)];
    default:
      return [];
  }
}

export function detectPreset(
  rec: ItemRecurrence | null | undefined,
  item: Pick<Item, "start">,
): RecurrencePresetId {
  if (!rec) return "none";
  const { frequency, interval, weekdaysOnly, byWeekday, until, count } = rec;
  if (until || count) return "custom";
  if (weekdaysOnly && frequency === "daily" && interval === 1) return "weekdays";
  if (frequency === "daily" && interval === 1) return "daily";
  if (frequency === "monthly" && interval === 1) return "monthly";
  if (frequency === "yearly" && interval === 1) return "yearly";
  if (frequency === "weekly" && interval === 1) {
    const wd = weekdayFromItemStart(item);
    if (byWeekday?.length === 1 && byWeekday[0] === wd) return "weekly";
  }
  return "custom";
}

const FREQ_LABEL: Record<ItemRecurrence["frequency"], string> = {
  daily: "dzień",
  weekly: "tydzień",
  monthly: "miesiąc",
  yearly: "rok",
};

const WEEKDAY_PL = ["nd", "pn", "wt", "śr", "cz", "pt", "so"];

export function recurrenceSummary(
  rec: ItemRecurrence | null | undefined,
  item: Pick<Item, "start">,
): string {
  if (!rec) return "Nie powtarza się";
  const preset = detectPreset(rec, item);
  if (preset === "daily") return "Codziennie";
  if (preset === "weekly") return "Co tydzień";
  if (preset === "monthly") return "Co miesiąc";
  if (preset === "yearly") return "Co rok";
  if (preset === "weekdays") return "W każdy dzień roboczy";

  const interval = Math.max(1, rec.interval || 1);
  const unit = FREQ_LABEL[rec.frequency];
  let base = interval === 1 ? `Co ${unit}` : `Co ${interval} ${unit}${interval < 5 ? (rec.frequency === "weekly" ? " tygodnie" : "e") : ""}`;

  if (rec.frequency === "weekly" && rec.byWeekday?.length) {
    const days = rec.byWeekday.map((d) => WEEKDAY_PL[d] ?? "?").join(", ");
    base += ` (${days})`;
  }

  if (rec.count) base += `, ${rec.count}×`;
  else if (rec.until) {
    const d = new Date(rec.until);
    base += `, do ${d.toLocaleDateString("pl-PL")}`;
  }

  return base;
}
