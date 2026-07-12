// Supabase Edge Function: send-reminders
// Wywoływana co minutę (pg_cron, patrz 0002_cron.sql). Znajduje przypomnienia,
// których czas właśnie nadszedł, i wysyła Web Push na wszystkie urządzenia
// odbiorcy. Dedupe poprzez tabelę reminder_log (unique item+reminder+fire_at).
//
// Obsługuje:
//  - przypomnienia względne (offset od startu) i absolutne (remindAt),
//  - wydarzenia CYKLICZNE — rozwija RRULE i liczy czas per wystąpienie,
//  - deadline (payload.deadlineAt): powiadomienie 24 h przed i w chwili terminu,
//  - przypomnienia osobiste uczestników SHARE (item_participants.personal_reminders).
//
// Wdrożenie:
//   supabase functions deploy send-reminders --no-verify-jwt
// Sekrety:
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//     VAPID_SUBJECT=mailto:ty@example.com
// (SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY są dostępne automatycznie.)

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { rrulestr } from "https://esm.sh/rrule@2.8.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

interface Reminder {
  id: string;
  offsetMinutes: number;
  remindAt?: string | null;
}

interface ItemRecurrence {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  byWeekday?: number[];
  weekdaysOnly?: boolean;
  until?: string | null;
  count?: number | null;
}

interface RecurrenceException {
  originalStart: string;
  status: "cancelled" | "modified";
  start?: string;
}

interface ItemPayload {
  reminders?: Reminder[];
  hasDueDate?: boolean;
  deadlineAt?: string | null;
  recurrence?: ItemRecurrence | null;
  googleRecurrence?: string[];
  googleRecurrenceExceptions?: RecurrenceException[];
}

interface ItemRow {
  id: string;
  user_id: string;
  title: string;
  type: string;
  start_at: string;
  all_day: boolean;
  done: boolean;
  deleted_at: string | null;
  payload: ItemPayload;
}

// Tolerancja: przypomnienia „należne" w ostatnich 90 s (cron chodzi co minutę).
const WINDOW_MS = 90_000;
// Maksymalny offset przypomnienia względnego brany pod uwagę (dni).
const MAX_OFFSET_DAYS = 45;

const dateFmt = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtPL(d: Date): string {
  return dateFmt.format(d);
}

function isDue(fireAt: number, now: number): boolean {
  return fireAt <= now && now - fireAt <= WINDOW_MS;
}

// --- RRULE (port z src/lib/recurrenceRules.ts — trzymać w synchronizacji) ----

const WEEKDAY_IC = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

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

function nativeRecurrenceToRruleLines(rec: ItemRecurrence, startIso: string): string[] {
  const interval = Math.max(1, rec.interval || 1);
  if (rec.weekdaysOnly) {
    return [appendEnd("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR", rec)];
  }
  switch (rec.frequency) {
    case "daily":
      return [appendEnd(`RRULE:FREQ=DAILY;INTERVAL=${interval}`, rec)];
    case "weekly": {
      const days = rec.byWeekday?.length
        ? rec.byWeekday.map((d) => WEEKDAY_IC[d] ?? "MO").join(",")
        : WEEKDAY_IC[new Date(startIso).getUTCDay()];
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

function recurrenceLines(item: ItemRow): string[] | null {
  const p = item.payload ?? {};
  if (Array.isArray(p.googleRecurrence) && p.googleRecurrence.length) return p.googleRecurrence;
  if (p.recurrence) return nativeRecurrenceToRruleLines(p.recurrence, item.start_at);
  return null;
}

function formatRruleDtstart(item: ItemRow): string {
  const d = new Date(item.start_at);
  if (item.all_day) {
    // Kotwica południa UTC → dzień kalendarzowy z części daty ISO.
    const ymd = item.start_at.slice(0, 10).replace(/-/g, "");
    return `DTSTART;VALUE=DATE:${ymd}`;
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `DTSTART:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(
    d.getUTCHours(),
  )}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Starty wystąpień cyklu w zadanym oknie (z uwzględnieniem wyjątków). */
function occurrenceStarts(item: ItemRow, from: Date, to: Date): Date[] {
  const lines = recurrenceLines(item);
  if (!lines?.length) return [new Date(item.start_at)];

  const filtered = lines.filter(
    (l) => l.startsWith("RRULE:") || l.startsWith("EXDATE") || l.startsWith("RDATE"),
  );
  let dates: Date[];
  try {
    const set = rrulestr(`${formatRruleDtstart(item)}\n${filtered.join("\n")}`, {
      forceset: filtered.length > 1,
    });
    dates = set.between(from, to, true);
  } catch {
    return [new Date(item.start_at)];
  }

  const exceptions = item.payload?.googleRecurrenceExceptions ?? [];
  const out: Date[] = [];
  for (const occ of dates) {
    const ex = exceptions.find(
      (e) => Math.abs(new Date(e.originalStart).getTime() - occ.getTime()) < 1000,
    );
    if (ex?.status === "cancelled") continue;
    out.push(ex?.start ? new Date(ex.start) : occ);
  }
  return out;
}

function maxOffsetMinutes(reminders: Reminder[]): number {
  let max = 0;
  for (const r of reminders) {
    if (!r.remindAt) max = Math.max(max, r.offsetMinutes || 0);
  }
  return Math.min(max, MAX_OFFSET_DAYS * 24 * 60);
}

// --- Wysyłka -----------------------------------------------------------------

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function makeSender(admin: SupabaseClient) {
  const subsByUser = new Map<string, PushSub[]>();
  let sent = 0;

  async function subsFor(userId: string): Promise<PushSub[]> {
    const cached = subsByUser.get(userId);
    if (cached) return cached;
    const { data } = await admin
      .from("push_subscriptions")
      .select("endpoint,keys")
      .eq("user_id", userId);
    const subs = (data ?? []) as PushSub[];
    subsByUser.set(userId, subs);
    return subs;
  }

  async function send(userId: string, title: string, body: string): Promise<void> {
    const payload = JSON.stringify({ title, body, url: "/" });
    for (const sub of await subsFor(userId)) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys } as webpush.PushSubscription,
          payload,
        );
        sent++;
      } catch (e) {
        // 404/410 -> subskrypcja wygasła; usuń ją.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          subsByUser.delete(userId);
        }
      }
    }
  }

  return { send, sentCount: () => sent };
}

/** Dedupe przez unikalny wpis w reminder_log; true = wolno wysłać. */
async function claim(
  admin: SupabaseClient,
  userId: string,
  itemId: string,
  reminderId: string,
  fireAt: number,
): Promise<boolean> {
  const { error } = await admin.from("reminder_log").insert({
    user_id: userId,
    item_id: itemId,
    reminder_id: reminderId,
    fire_at: new Date(fireAt).toISOString(),
  });
  return !error; // błąd = już wysłane (unique violation) lub problem z insertem
}

function itemTitle(item: ItemRow): string {
  return item.title || (item.type === "task" ? "Zadanie" : "Wydarzenie");
}

// --- Główna pętla --------------------------------------------------------------

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const sender = makeSender(admin);
  const now = Date.now();

  const processed = new Set<string>();

  /** Przypomnienia właściciela dla jednego itemu (względne + absolutne + cykl). */
  const processItem = async (item: ItemRow) => {
    if (processed.has(item.id)) return;
    processed.add(item.id);
    if (item.done || item.deleted_at) return;

    const reminders = item.payload?.reminders ?? [];
    const relative = reminders.filter((r) => !r.remindAt);
    const absolute = reminders.filter((r) => Boolean(r.remindAt));

    for (const r of absolute) {
      const fireAt = new Date(r.remindAt!).getTime();
      if (!Number.isFinite(fireAt) || !isDue(fireAt, now)) continue;
      if (!(await claim(admin, item.user_id, item.id, r.id, fireAt))) continue;
      await sender.send(
        item.user_id,
        itemTitle(item),
        `Przypomnienie o ${fmtPL(new Date(r.remindAt!))}`,
      );
    }

    if (relative.length && item.payload?.hasDueDate !== false) {
      const maxOffMs = maxOffsetMinutes(relative) * 60_000;
      const from = new Date(now - WINDOW_MS);
      const to = new Date(now + maxOffMs + WINDOW_MS);
      const starts = occurrenceStarts(item, from, to);

      for (const occStart of starts) {
        for (const r of relative) {
          const fireAt = occStart.getTime() - (r.offsetMinutes || 0) * 60_000;
          if (!isDue(fireAt, now)) continue;
          if (!(await claim(admin, item.user_id, item.id, r.id, fireAt))) continue;
          const label =
            r.offsetMinutes > 0
              ? `Zaczyna się ${fmtPL(occStart)}`
              : `Zaczyna się teraz (${fmtPL(occStart)})`;
          await sender.send(item.user_id, itemTitle(item), label);
        }
      }
    }

    // Deadline — tylko właściciel; 24 h przed i w chwili terminu.
    const deadlineAt = item.payload?.deadlineAt;
    if (deadlineAt) {
      const at = new Date(deadlineAt).getTime();
      if (Number.isFinite(at)) {
        const slots = [
          { fireAt: at - 24 * 60 * 60_000, id: "deadline-24h", body: `Deadline jutro: ${fmtPL(new Date(at))}` },
          { fireAt: at, id: "deadline-0", body: `Termin: ${fmtPL(new Date(at))}` },
        ];
        for (const slot of slots) {
          if (!isDue(slot.fireAt, now)) continue;
          if (!(await claim(admin, item.user_id, item.id, slot.id, slot.fireAt))) continue;
          await sender.send(item.user_id, `Deadline: ${itemTitle(item)}`, slot.body);
        }
      }
    }
  };

  const SELECT = "id,user_id,title,type,start_at,all_day,done,deleted_at,payload";

  // 1) Elementy z terminem w oknie (start_at do przodu o max offset przypomnień).
  const fromIso = new Date(now - 2 * 86_400_000).toISOString();
  const toIso = new Date(now + MAX_OFFSET_DAYS * 86_400_000).toISOString();
  const { data: dated, error } = await admin
    .from("items")
    .select(SELECT)
    .eq("done", false)
    .is("deleted_at", null)
    .gte("start_at", fromIso)
    .lte("start_at", toIso);
  if (error) return json({ error: error.message }, 500);
  for (const item of (dated ?? []) as ItemRow[]) await processItem(item);

  // 2) Elementy cykliczne — bazowy start_at może być dowolnie dawno temu.
  const { data: recNative } = await admin
    .from("items")
    .select(SELECT)
    .eq("done", false)
    .is("deleted_at", null)
    .not("payload->recurrence", "is", null);
  for (const item of (recNative ?? []) as ItemRow[]) await processItem(item);

  const { data: recGoogle } = await admin
    .from("items")
    .select(SELECT)
    .eq("done", false)
    .is("deleted_at", null)
    .not("payload->googleRecurrence", "is", null);
  for (const item of (recGoogle ?? []) as ItemRow[]) await processItem(item);

  // 3) Elementy bez terminu — przypomnienia absolutne (remindAt) i deadline.
  const { data: undated } = await admin
    .from("items")
    .select(SELECT)
    .eq("done", false)
    .is("deleted_at", null)
    .eq("payload->>hasDueDate", "false");
  for (const item of (undated ?? []) as ItemRow[]) await processItem(item);

  // 4) Elementy z deadline (mogły nie załapać się do okien powyżej).
  const { data: withDeadline } = await admin
    .from("items")
    .select(SELECT)
    .eq("done", false)
    .is("deleted_at", null)
    .not("payload->>deadlineAt", "is", null);
  for (const item of (withDeadline ?? []) as ItemRow[]) await processItem(item);

  // 5) Przypomnienia osobiste uczestników (SHARE).
  const { data: participations } = await admin
    .from("item_participants")
    .select("participant_user_id, personal_reminders, status, items(" + SELECT + ")")
    .neq("status", "rejected")
    .not("participant_user_id", "is", null);

  for (const row of participations ?? []) {
    const item = row.items as unknown as ItemRow | null;
    const userId = row.participant_user_id as string | null;
    const personal = (row.personal_reminders ?? []) as Reminder[];
    if (!item || !userId || !personal.length) continue;
    if (item.done || item.deleted_at) continue;

    const relative = personal.filter((r) => !r.remindAt);
    const absolute = personal.filter((r) => Boolean(r.remindAt));

    for (const r of absolute) {
      const fireAt = new Date(r.remindAt!).getTime();
      if (!Number.isFinite(fireAt) || !isDue(fireAt, now)) continue;
      if (!(await claim(admin, userId, item.id, r.id, fireAt))) continue;
      await sender.send(userId, itemTitle(item), `Przypomnienie o ${fmtPL(new Date(r.remindAt!))}`);
    }

    if (relative.length && item.payload?.hasDueDate !== false) {
      const maxOffMs = maxOffsetMinutes(relative) * 60_000;
      const starts = occurrenceStarts(
        item,
        new Date(now - WINDOW_MS),
        new Date(now + maxOffMs + WINDOW_MS),
      );
      for (const occStart of starts) {
        for (const r of relative) {
          const fireAt = occStart.getTime() - (r.offsetMinutes || 0) * 60_000;
          if (!isDue(fireAt, now)) continue;
          if (!(await claim(admin, userId, item.id, r.id, fireAt))) continue;
          await sender.send(userId, itemTitle(item), `Zaczyna się ${fmtPL(occStart)}`);
        }
      }
    }
  }

  return json({ ok: true, sent: sender.sentCount() });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
