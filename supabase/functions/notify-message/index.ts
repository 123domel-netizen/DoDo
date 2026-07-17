// Supabase Edge Function: notify-message
// Wywoływana triggerem pg_net po INSERT do public.messages (0017_chat_push.sql).
// Wysyła Web Push do członków rozmowy (poza autorem i wyciszonymi).
// Collapse: tag = chat-{conversationId} — system nadpisuje poprzednie
// powiadomienie z tej samej rozmowy zamiast układać stos.
//
// Wdrożenie:
//   supabase functions deploy notify-message --no-verify-jwt
// Sekrety (VAPID_* są już ustawione dla send-reminders):
//   supabase secrets set CHAT_PUSH_SECRET=<ten sam co w 0017_chat_push.sql>

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
const CHAT_PUSH_SECRET = Deno.env.get("CHAT_PUSH_SECRET") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

Deno.serve(async (req) => {
  if (!CHAT_PUSH_SECRET || req.headers.get("x-chat-secret") !== CHAT_PUSH_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let messageId: string | undefined;
  try {
    const body = await req.json();
    messageId = body?.messageId;
  } catch {
    // brak body
  }
  if (!messageId) return json({ error: "messageId required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const { data: msg } = await admin
    .from("messages")
    .select("id, conversation_id, author_user_id, kind, body, deleted_at, thread_root_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || msg.deleted_at || msg.kind === "system") {
    return json({ ok: true, sent: 0, skipped: "no pushable message" });
  }

  const { data: conv } = await admin
    .from("conversations")
    .select("id, kind, name, item_id, archived_at")
    .eq("id", msg.conversation_id)
    .maybeSingle();
  if (!conv || conv.archived_at) return json({ ok: true, sent: 0 });

  // Odbiorcy: aktywni członkowie − autor − wyciszeni.
  const { data: members } = await admin
    .from("conversation_members")
    .select("user_id, notify")
    .eq("conversation_id", conv.id)
    .is("left_at", null)
    .neq("user_id", msg.author_user_id)
    .neq("notify", "none");
  const recipientIds = (members ?? []).map((m) => m.user_id as string);
  if (!recipientIds.length) return json({ ok: true, sent: 0 });

  const { data: authorProfile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("user_id", msg.author_user_id)
    .maybeSingle();
  const authorName = (authorProfile?.display_name as string) || "Ktoś";

  let title: string;
  if (conv.kind === "channel") {
    title = `#${conv.name ?? "kanał"}`;
  } else if (conv.kind === "item") {
    const { data: item } = await admin
      .from("items")
      .select("title")
      .eq("id", conv.item_id)
      .maybeSingle();
    title = `Dyskusja: ${truncate((item?.title as string) || "wpis", 60)}`;
  } else {
    title = authorName;
  }

  const bodyText =
    conv.kind === "dm"
      ? truncate(msg.body ?? "", 140)
      : `${authorName}: ${truncate(msg.body ?? "", 120)}`;

  const payload = JSON.stringify({
    title,
    body: bodyText || "Nowa wiadomość",
    url: `/#/czat/${conv.id}`,
    tag: `chat-${conv.id}`,
  });

  const { data: subsData } = await admin
    .from("push_subscriptions")
    .select("endpoint, keys, user_id")
    .in("user_id", recipientIds);

  let sent = 0;
  for (const sub of (subsData ?? []) as (PushSub & { user_id: string })[]) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys } as webpush.PushSubscription,
        payload,
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }

  return json({ ok: true, sent });
});
