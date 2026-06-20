// supabase/functions/google-oauth/index.ts
// GET ?action=start  (Authorization: Bearer user JWT) → redirect to Google
// GET ?action=callback&code=&state= → exchange tokens, redirect to app

import { encryptToken } from "../_shared/crypto.ts";
import { exchangeCodeForTokens, fetchGoogleEmail, GOOGLE_SCOPES } from "../_shared/googleAuth.ts";
import { adminClient, corsHeaders, json, userIdFromRequest } from "../_shared/supabaseAdmin.ts";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function redirectUri(): string {
  return (
    Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI") ??
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth?action=callback`
  );
}

function successRedirect(): string {
  return Deno.env.get("GOOGLE_OAUTH_SUCCESS_URL") ?? "/?google=connected";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req.headers.get("Origin")) });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "start";

  try {
    if (action === "start") {
      const userId = await userIdFromRequest(req);
      if (!userId) return json({ error: "Unauthorized" }, 401, corsHeaders());

      const stateToken = crypto.randomUUID();
      const admin = adminClient();
      await admin.from("google_oauth_states").insert({
        state_token: stateToken,
        user_id: userId,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });

      const params = new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: GOOGLE_SCOPES,
        access_type: "offline",
        prompt: "consent",
        state: stateToken,
      });

      const authUrl = `${GOOGLE_AUTH_URL}?${params}`;
      const accept = req.headers.get("Accept") ?? "";
      if (accept.includes("application/json") || url.searchParams.get("json") === "1") {
        return json({ url: authUrl }, 200, corsHeaders());
      }
      return Response.redirect(authUrl, 302);
    }

    if (action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return json({ error: "Missing code or state" }, 400);

      const admin = adminClient();
      const { data: stateRow } = await admin
        .from("google_oauth_states")
        .select("user_id, expires_at")
        .eq("state_token", state)
        .maybeSingle();

      if (!stateRow || new Date(stateRow.expires_at).getTime() < Date.now()) {
        return json({ error: "Invalid or expired state" }, 400);
      }

      await admin.from("google_oauth_states").delete().eq("state_token", state);

      const tokens = await exchangeCodeForTokens(code, redirectUri());
      const refreshToken = tokens.refresh_token as string | undefined;
      if (!refreshToken) {
        return json({ error: "No refresh token — revoke app access in Google and retry" }, 400);
      }

      const keyHex = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY")!;
      const encrypted = await encryptToken(refreshToken, keyHex);
      const accessToken = tokens.access_token as string;
      const expiresIn = (tokens.expires_in as number) ?? 3600;
      const email = await fetchGoogleEmail(accessToken);
      const userId = stateRow.user_id as string;

      await admin.from("google_accounts").upsert({
        user_id: userId,
        google_email: email,
        refresh_token_encrypted: encrypted,
        access_token: accessToken,
        access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        scopes: GOOGLE_SCOPES.split(" "),
        updated_at: new Date().toISOString(),
      });

      await admin.from("google_sync_settings").upsert({
        user_id: userId,
        updated_at: new Date().toISOString(),
      });

      await admin.from("google_sync_state").upsert({
        user_id: userId,
        updated_at: new Date().toISOString(),
      });

      const appUrl = successRedirect();
      const finalUrl = appUrl.startsWith("http")
        ? appUrl
        : `${Deno.env.get("GOOGLE_OAUTH_APP_ORIGIN") ?? "http://localhost:5173"}${appUrl}`;
      return Response.redirect(finalUrl, 302);
    }

    if (action === "disconnect") {
      const userId = await userIdFromRequest(req);
      if (!userId) return json({ error: "Unauthorized" }, 401, corsHeaders());

      const admin = adminClient();
      await admin.from("google_accounts").delete().eq("user_id", userId);
      await admin.from("item_external_links").delete().eq("user_id", userId);
      await admin.from("google_sync_state").delete().eq("user_id", userId);
      return json({ ok: true }, 200, corsHeaders());
    }

    if (action === "status") {
      const userId = await userIdFromRequest(req);
      if (!userId) return json({ connected: false }, 200, corsHeaders());

      const admin = adminClient();
      const { data: acct } = await admin
        .from("google_accounts")
        .select("google_email, connected_at")
        .eq("user_id", userId)
        .maybeSingle();
      const { data: settings } = await admin
        .from("google_sync_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      const { data: state } = await admin
        .from("google_sync_state")
        .select("last_sync_at, last_sync_error")
        .eq("user_id", userId)
        .maybeSingle();

      return json(
        {
          connected: Boolean(acct),
          email: acct?.google_email ?? null,
          connectedAt: acct?.connected_at ?? null,
          settings: settings ?? null,
          lastSyncAt: state?.last_sync_at ?? null,
          lastSyncError: state?.last_sync_error ?? null,
        },
        200,
        corsHeaders(),
      );
    }

    return json({ error: "Unknown action" }, 404);
  } catch (e) {
    console.error("[google-oauth]", e);
    return json({ error: String(e) }, 500, corsHeaders());
  }
});
