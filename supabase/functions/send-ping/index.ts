// Supabase Edge Function: send-ping
// Client invokes with user JWT. Validates via RPC send_ping, then Web Push
// to selected targets (bypasses mute / notify:none / mentions-only).
//
// Deploy: supabase functions deploy send-ping
// Secrets: VAPID_* (same as notify-message / send-reminders)

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SB_ANON_KEY") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

type PingRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  target_user_id: string;
  created_at: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function mapPingError(message: string): string {
  if (message.includes("ping rate limited")) {
    return "Odczekaj chwilę przed kolejnym PINGiem.";
  }
  if (message.includes("ping no targets")) {
    return "Wybierz przynajmniej jedną osobę.";
  }
  if (message.includes("ping too many targets")) {
    return "Za dużo odbiorców PINGa (maks. 20).";
  }
  if (message.includes("ping invalid target")) {
    return "Nie można wysłać PINGa do tej osoby.";
  }
  if (message.includes("ping notebook")) {
    return "PING nie działa w Notatniku.";
  }
  if (message.includes("ping conversation archived")) {
    return "Ta rozmowa jest zarchiwizowana.";
  }
  if (message.includes("not a conversation member") || message.includes("not authenticated")) {
    return "Brak dostępu do tej rozmowy.";
  }
  return message || "Nie udało się wysłać PINGa.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  let conversationId: string | undefined;
  let targetIds: string[] | undefined;
  try {
    const body = await req.json();
    conversationId = body?.conversationId ?? body?.p_conversation_id;
    targetIds = body?.targetIds ?? body?.p_target_ids;
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (!conversationId || !Array.isArray(targetIds)) {
    return json({ error: "conversationId and targetIds required" }, 400);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY || SERVICE_ROLE, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pingRows, error: rpcError } = await userClient.rpc("send_ping", {
    p_conversation_id: conversationId,
    p_target_ids: targetIds,
  });

  if (rpcError) {
    return json({ error: mapPingError(rpcError.message) }, 400);
  }
  const pings = (pingRows ?? []) as PingRow[];
  if (!pings.length) {
    return json({ error: "ping no targets" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const senderId = pings[0]!.sender_user_id;
  const convId = pings[0]!.conversation_id;

  const { data: senderProfile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("user_id", senderId)
    .maybeSingle();
  const senderName = (senderProfile?.display_name as string) || "Ktoś";

  const { data: conv } = await admin
    .from("conversations")
    .select("id, kind, name, item_id, board_topic_id")
    .eq("id", convId)
    .maybeSingle();

  let board: { boardId: string; topicId: string; title: string } | null = null;
  let baseTitle = senderName;

  if (conv?.kind === "board_topic" && conv.board_topic_id) {
    const { data: topic } = await admin
      .from("board_topics")
      .select("id, title, board_id, boards(name, archived_at)")
      .eq("id", conv.board_topic_id)
      .maybeSingle();
    const boardRow = Array.isArray(topic?.boards) ? topic?.boards[0] : topic?.boards;
    if (topic && boardRow && !boardRow.archived_at) {
      board = {
        boardId: topic.board_id as string,
        topicId: topic.id as string,
        title: `Tablica: ${truncate((boardRow.name as string) || "tablica", 40)} · ${truncate(
          (topic.title as string) || "temat",
          60,
        )}`,
      };
      baseTitle = board.title;
    }
  } else if (conv?.kind === "channel") {
    baseTitle = `#${conv.name ?? "kanał"}`;
  } else if (conv?.kind === "item") {
    const { data: item } = await admin
      .from("items")
      .select("title")
      .eq("id", conv.item_id)
      .maybeSingle();
    baseTitle = `Dyskusja: ${truncate((item?.title as string) || "wpis", 60)}`;
  }

  const recipientIds = [...new Set(pings.map((p) => p.target_user_id))];
  const { data: subsData } = await admin
    .from("push_subscriptions")
    .select("endpoint, keys, user_id")
    .in("user_id", recipientIds);

  const pingByTarget = new Map(pings.map((p) => [p.target_user_id, p]));
  let sent = 0;

  for (const sub of (subsData ?? []) as (PushSub & { user_id: string })[]) {
    const ping = pingByTarget.get(sub.user_id);
    if (!ping) continue;
    const payload = JSON.stringify({
      title: `PING · ${senderName}`,
      body: `Potrzebuję, żebyś teraz spojrzał na tę rozmowę — ${baseTitle}`,
      url: board
        ? `/#/tablice/${board.boardId}/${board.topicId}`
        : `/#/czat/${convId}`,
      tag: `ping-${ping.id}`,
      ping: true,
    });
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys } as webpush.PushSubscription,
        payload,
        { urgency: "high", TTL: 300 },
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }

  return json({
    ok: true,
    sent,
    pings: pings.map((p) => ({
      id: p.id,
      targetUserId: p.target_user_id,
      createdAt: p.created_at,
    })),
  });
});
