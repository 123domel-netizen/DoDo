// Supabase Auth Hook: before-user-created (HTTPS + Standard Webhooks)
// Dashboard → Authentication → Auth Hooks → before-user-created
// Secret: Generate secret → format v1,whsec_... (ten sam w Edge Function secrets)
//
// Deploy: supabase functions deploy auth-allowlist --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "npm:standardwebhooks@1.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOOK_SECRET_RAW =
  Deno.env.get("BEFORE_USER_CREATED_HOOK_SECRET") ??
  Deno.env.get("AUTH_HOOK_SECRET") ??
  "";

interface HookPayload {
  user?: { email?: string };
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function emailsFromEnv(): Set<string> {
  const raw = Deno.env.get("ALLOWED_EMAILS") ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => normalizeEmail(e))
      .filter(Boolean),
  );
}

async function isAllowedEmail(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const envSet = emailsFromEnv();
  if (envSet.size > 0 && envSet.has(normalized)) return true;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data } = await admin
    .from("allowed_users")
    .select("email")
    .eq("email", normalized)
    .maybeSingle();
  return Boolean(data);
}

function deny(message: string) {
  return new Response(
    JSON.stringify({
      error: {
        http_code: 403,
        message,
      },
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

function allow() {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function hookSigningSecret(raw: string): string {
  return raw.replace(/^v1,whsec_/, "");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payloadText = await req.text();
  const headers = Object.fromEntries(req.headers);

  let event: HookPayload;
  try {
    if (HOOK_SECRET_RAW) {
      const wh = new Webhook(hookSigningSecret(HOOK_SECRET_RAW));
      event = wh.verify(payloadText, headers) as HookPayload;
    } else {
      event = JSON.parse(payloadText) as HookPayload;
    }
  } catch (e) {
    console.error("[auth-allowlist] verify", e);
    return deny("Nieprawidłowe żądanie hooka (podpis).");
  }

  try {
    const email = event.user?.email;
    if (!email) return deny("Brak adresu e-mail w żądaniu rejestracji.");

    const ok = await isAllowedEmail(email);
    if (!ok) {
      return deny("To konto nie ma zaproszenia do aplikacji. Poproś administratora o dostęp.");
    }

    return allow();
  } catch (e) {
    console.error("[auth-allowlist]", e);
    return deny("Błąd weryfikacji zaproszenia.");
  }
});
