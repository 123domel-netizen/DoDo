// Supabase Edge Function: notify-message
// Wywoływana triggerem pg_net po INSERT do public.messages (0017_chat_push.sql).
// Wysyła Web Push do członków rozmowy (poza autorem i wyciszonymi).
// Stack jak Messenger: przy 2+ nieprzeczytanych w treści jest liczba + linie
// od najnowszej do starszej (max 5), tag=chat-{id} nadpisuje poprzedni toast.
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

type MsgRow = {
  kind: string;
  body: string | null;
  author_user_id: string;
  created_at: string;
};

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

/** Treść zależna od kindu wiadomości. */
function kindBody(kind: string, body: string, max: number): string {
  switch (kind) {
    case "poll":
      return `📊 Ankieta: ${truncate(body, max - 12)}`;
    case "gif":
      return "GIF";
    case "voice":
      return "🎤 Wiadomość głosowa";
    default:
      return truncate(body, max);
  }
}

function lineForMsg(
  m: MsgRow,
  convKind: string,
  authorName: string,
): string {
  const preview = kindBody(m.kind, m.body ?? "", convKind === "dm" ? 100 : 80);
  return convKind === "dm" ? preview : `${authorName}: ${preview}`;
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
    .select(
      "id, conversation_id, author_user_id, kind, body, mentions, deleted_at, thread_root_id",
    )
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || msg.deleted_at || msg.kind === "system") {
    return json({ ok: true, sent: 0, skipped: "no pushable message" });
  }
  const mentions: string[] = (msg.mentions as string[] | null) ?? [];

  const { data: conv } = await admin
    .from("conversations")
    .select("id, kind, name, item_id, archived_at")
    .eq("id", msg.conversation_id)
    .maybeSingle();
  if (!conv || conv.archived_at) return json({ ok: true, sent: 0 });

  // Odbiorcy: aktywni członkowie − autor − notify:none − wyciszeni (muted_until)
  // − (tryb „tylko wzmianki" bez wzmianki).
  const { data: members } = await admin
    .from("conversation_members")
    .select("user_id, notify, muted_until, last_read_at")
    .eq("conversation_id", conv.id)
    .is("left_at", null)
    .neq("user_id", msg.author_user_id)
    .neq("notify", "none");
  const now = Date.now();
  const recipients = (members ?? []).filter((m) => {
    const mutedUntil = m.muted_until as string | null;
    if (mutedUntil) {
      if (mutedUntil === "infinity") return false;
      const t = new Date(mutedUntil).getTime();
      if (!Number.isNaN(t) && t > now) return false;
    }
    if (m.notify === "mentions" && !mentions.includes(m.user_id as string)) {
      return false;
    }
    return true;
  });
  if (!recipients.length) return json({ ok: true, sent: 0 });

  const recipientIds = recipients.map((m) => m.user_id as string);

  // Ostatnie wiadomości rozmowy — do stacku per odbiorca względem last_read_at.
  const { data: recentRows } = await admin
    .from("messages")
    .select("kind, body, author_user_id, created_at")
    .eq("conversation_id", conv.id)
    .is("deleted_at", null)
    .neq("kind", "system")
    .order("created_at", { ascending: false })
    .limit(25);

  const recent = (recentRows ?? []) as MsgRow[];
  const authorIds = [...new Set(recent.map((r) => r.author_user_id))];
  const { data: authorProfiles } = await admin
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", authorIds.length ? authorIds : [msg.author_user_id]);
  const nameById = new Map<string, string>();
  for (const p of authorProfiles ?? []) {
    nameById.set(p.user_id as string, (p.display_name as string) || "Ktoś");
  }
  const authorName = nameById.get(msg.author_user_id as string) || "Ktoś";

  let baseTitle: string;
  if (conv.kind === "channel") {
    baseTitle = `#${conv.name ?? "kanał"}`;
  } else if (conv.kind === "item") {
    const { data: item } = await admin
      .from("items")
      .select("title")
      .eq("id", conv.item_id)
      .maybeSingle();
    baseTitle = `Dyskusja: ${truncate((item?.title as string) || "wpis", 60)}`;
  } else {
    baseTitle = authorName;
  }

  const buildPayload = (userId: string, mentioned: boolean) => {
    const member = recipients.find((m) => m.user_id === userId);
    const lastRead = (member?.last_read_at as string | null) ?? null;
    const unread = recent
      .filter((r) => !lastRead || r.created_at > lastRead)
      .slice(0, 5);
    const lines = (unread.length ? unread : recent.slice(0, 1)).map((r) =>
      lineForMsg(r, conv.kind as string, nameById.get(r.author_user_id) || "Ktoś"),
    );
    const count = unread.length || 1;
    const titleBase = mentioned ? `@ ${baseTitle}` : baseTitle;
    const title = count > 1 ? `${titleBase} · ${count}` : titleBase;
    let body: string;
    if (count <= 1) {
      body = (mentioned ? `Oznaczono Cię — ${lines[0]}` : lines[0]) || "Nowa wiadomość";
    } else {
      const head = mentioned
        ? `Oznaczono Cię · ${count} nowe wiadomości`
        : `${count} nowe wiadomości`;
      body = [head, ...lines].join("\n");
    }
    return JSON.stringify({
      title,
      body,
      url: `/#/czat/${conv.id}`,
      tag: `chat-${conv.id}`,
    });
  };

  const { data: subsData } = await admin
    .from("push_subscriptions")
    .select("endpoint, keys, user_id")
    .in("user_id", recipientIds);

  let sent = 0;
  for (const sub of (subsData ?? []) as (PushSub & { user_id: string })[]) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys } as webpush.PushSubscription,
        buildPayload(sub.user_id, mentions.includes(sub.user_id)),
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
