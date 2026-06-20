// supabase/functions/google-sync/index.ts
// POST { action?: 'push'|'pull'|'full', itemIds?: string[] }
// GET  ?action=calendars|tasklists — list Google resources for settings UI
// Cron/service role: POST { allUsers: true }

import { adminClient, corsHeaders, json, userIdFromRequest } from "../_shared/supabaseAdmin.ts";
import { googleFetch } from "../_shared/googleAuth.ts";
import { processSyncQueue, runSyncForUser } from "../_shared/syncEngine.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req.headers.get("Origin")) });
  }

  const admin = adminClient();
  const url = new URL(req.url);

  try {
    // List calendars / task lists for settings UI
    if (req.method === "GET") {
      const userId = await userIdFromRequest(req);
      if (!userId) return json({ error: "Unauthorized" }, 401, corsHeaders());

      const list = url.searchParams.get("list");
      if (list === "calendars") {
        const res = await googleFetch(
          userId,
          "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        );
        if (!res.ok) return json({ error: await res.text() }, 500, corsHeaders());
        const data = await res.json();
        const calendars = (data.items ?? []).map((c: Record<string, unknown>) => ({
          id: c.id,
          summary: c.summary,
          primary: c.primary,
        }));
        return json({ calendars }, 200, corsHeaders());
      }
      if (list === "tasklists") {
        const res = await googleFetch(userId, "https://www.googleapis.com/tasks/v1/users/@me/lists");
        if (!res.ok) return json({ error: await res.text() }, 500, corsHeaders());
        const data = await res.json();
        const taskLists = (data.items ?? []).map((t: Record<string, unknown>) => ({
          id: t.id,
          title: t.title,
        }));
        return json({ taskLists }, 200, corsHeaders());
      }
      return json({ error: "Use ?list=calendars or ?list=tasklists" }, 400, corsHeaders());
    }

    if (req.method === "POST") {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      const serviceAuth = req.headers.get("Authorization")?.includes(
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___none___",
      );

      if (body.allUsers && serviceAuth) {
        const { data: accounts } = await admin.from("google_accounts").select("user_id");
        for (const acct of accounts ?? []) {
          try {
            await processSyncQueue(admin, acct.user_id as string);
            await runSyncForUser(admin, acct.user_id as string, "pull");
          } catch (e) {
            console.error("[google-sync] user", acct.user_id, e);
          }
        }
        return json({ ok: true, users: accounts?.length ?? 0 });
      }

      const userId = await userIdFromRequest(req);
      if (!userId) return json({ error: "Unauthorized" }, 401, corsHeaders());

      // Save settings
      if (body.settings) {
        await admin.from("google_sync_settings").upsert({
          user_id: userId,
          ...body.settings,
          updated_at: new Date().toISOString(),
        });
        return json({ ok: true }, 200, corsHeaders());
      }

      // Enqueue sync jobs
      if (body.enqueue) {
        const rows = [];
        if (body.action === "full" || body.action === "pull") {
          rows.push({ user_id: userId, action: body.action, item_id: null });
        }
        if (body.itemIds?.length) {
          for (const id of body.itemIds as string[]) {
            rows.push({ user_id: userId, action: "push", item_id: id });
          }
        } else if (body.action === "push") {
          rows.push({ user_id: userId, action: "push", item_id: null });
        }
        if (rows.length) await admin.from("google_sync_queue").insert(rows);
        await processSyncQueue(admin, userId);
        return json({ ok: true, enqueued: rows.length }, 200, corsHeaders());
      }

      const action = (body.action as "push" | "pull" | "full") ?? "full";
      const result = await runSyncForUser(admin, userId, action, body.itemIds);
      return json(result, 200, corsHeaders());
    }

    return json({ error: "Method not allowed" }, 405, corsHeaders());
  } catch (e) {
    console.error("[google-sync]", e);
    return json({ error: String(e) }, 500, corsHeaders());
  }
});
