// supabase/functions/google-webhook/index.ts
// Receives Google Calendar push notifications → enqueue pull for user

import { adminClient, json } from "../_shared/supabaseAdmin.ts";
import { processSyncQueue, runSyncForUser } from "../_shared/syncEngine.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ ok: true });
  }

  const channelId = req.headers.get("X-Goog-Channel-ID");
  const resourceState = req.headers.get("X-Goog-Resource-State");

  if (resourceState === "sync") {
    return json({ ok: true });
  }

  if (!channelId) {
    return json({ ok: true });
  }

  try {
    const admin = adminClient();
    const { data: state } = await admin.from("google_sync_state").select("user_id").eq(
      "watch_channel_id",
      channelId,
    ).maybeSingle();

    if (!state?.user_id) {
      return json({ ok: true });
    }

    const userId = state.user_id as string;
    await admin.from("google_sync_queue").insert({
      user_id: userId,
      action: "pull",
      item_id: null,
    });
    await processSyncQueue(admin, userId);
    await runSyncForUser(admin, userId, "pull");

    return json({ ok: true });
  } catch (e) {
    console.error("[google-webhook]", e);
    return json({ ok: true });
  }
});
