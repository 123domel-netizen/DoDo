// Supabase Edge Function: send-reminders
// Wywoływana co minutę (pg_cron, patrz 0002_cron.sql). Znajduje przypomnienia,
// których czas właśnie nadszedł, i wysyła Web Push na wszystkie urządzenia
// użytkownika. Dedupe poprzez tabelę reminder_log.
//
// Wdrożenie:
//   supabase functions deploy send-reminders --no-verify-jwt
// Sekrety:
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//     VAPID_SUBJECT=mailto:ty@example.com
// (SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY są dostępne automatycznie.)

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

interface ItemRow {
  id: string;
  user_id: string;
  title: string;
  type: string;
  start_at: string;
  done: boolean;
  payload: { reminders?: Reminder[]; hasDueDate?: boolean };
}

const WINDOW_MS = 90_000; // tolerancja: przypomnienia "należne" w ostatnich 90 s

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = Date.now();

  // Items, których start mieści się w sensownym oknie (do 8 dni do przodu,
  // by objąć przypomnienia "1 dzień przed" oraz wielodniowe).
  const fromIso = new Date(now - 2 * 86_400_000).toISOString();
  const toIso = new Date(now + 8 * 86_400_000).toISOString();

  const { data: items, error } = await admin
    .from("items")
    .select("id,user_id,title,type,start_at,done,payload")
    .eq("done", false)
    .gte("start_at", fromIso)
    .lte("start_at", toIso);

  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  const processed = new Set<string>();

  const processItem = async (item: ItemRow) => {
    if (processed.has(item.id)) return;
    processed.add(item.id);
    const reminders = item.payload?.reminders ?? [];
    for (const r of reminders) {
      let fireAt: number;
      if (r.remindAt) {
        fireAt = new Date(r.remindAt).getTime();
      } else {
        if (item.payload?.hasDueDate === false) continue;
        fireAt = new Date(item.start_at).getTime() - r.offsetMinutes * 60_000;
      }
      if (!Number.isFinite(fireAt)) continue;
      if (fireAt > now || now - fireAt > WINDOW_MS) continue;

      const fireAtIso = new Date(fireAt).toISOString();
      // Dedupe: spróbuj wstawić log; konflikt = już wysłane.
      const { error: logErr } = await admin.from("reminder_log").insert({
        user_id: item.user_id,
        item_id: item.id,
        reminder_id: r.id,
        fire_at: fireAtIso,
      });
      if (logErr) continue; // już wysłane (unique violation) lub błąd

      const { data: subs } = await admin
        .from("push_subscriptions")
        .select("endpoint,keys")
        .eq("user_id", item.user_id);

      const whenLabel = r.remindAt
        ? new Date(r.remindAt).toLocaleString("pl-PL")
        : new Date(item.start_at).toLocaleString("pl-PL");
      const body = JSON.stringify({
        title: item.title || (item.type === "task" ? "Zadanie" : "Wydarzenie"),
        body: r.remindAt ? `Przypomnienie o ${whenLabel}` : `Zaczyna się ${whenLabel}`,
        url: "/",
      });

      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys } as webpush.PushSubscription,
            body,
          );
          sent++;
        } catch (e) {
          // 404/410 -> subskrypcja wygasła; usuń ją.
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          }
        }
      }
    }
  };

  for (const item of (items ?? []) as ItemRow[]) {
    await processItem(item);
  }

  // Itemy bez terminu mogą mieć przypomnienia absolutne (remindAt).
  const { data: undatedItems } = await admin
    .from("items")
    .select("id,user_id,title,type,start_at,done,payload")
    .eq("done", false)
    .eq("payload->>hasDueDate", "false");

  for (const item of (undatedItems ?? []) as ItemRow[]) {
    await processItem(item);
  }

  return json({ ok: true, sent });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
