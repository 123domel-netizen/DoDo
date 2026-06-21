// Supabase Auth Hook: before-user-created (HTTPS + Standard Webhooks)
// Dashboard → Authentication → Auth Hooks → before-user-created
// Secret: Generate secret → format v1,whsec_... (ten sam w Edge Function secrets)
//
// Deploy: supabase functions deploy auth-allowlist --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "npm:standardwebhooks@1.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const HOOK_SECRET_RE = /^v1,whsec_[A-Za-z0-9+/=_-]+$/;

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
  // WAŻNE: Supabase Auth czyta treść odpowiedzi hooka tylko przy statusie 200/202.
  // Zwrócenie 4xx sprawia, że GoTrue traktuje to jak błąd wywołania i pokazuje
  // „Invalid payload sent to hook" zamiast naszego komunikatu. Dlatego odrzucenie
  // zwracamy ze statusem 200 i obiektem `error` (z polami top-level dla zgodności).
  // Patrz: https://github.com/supabase/auth/issues/2235
  return new Response(
    JSON.stringify({
      message,
      http_code: 403,
      error: { http_code: 403, message },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function allow() {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Tylko sekrety Standard Webhooks (v1,whsec_...). Własny string z AUTH_HOOK_SECRET nie zadziała. */
function collectHookSigningSecrets(): string[] {
  const candidates = [
    Deno.env.get("BEFORE_USER_CREATED_HOOK_SECRET"),
    Deno.env.get("AUTH_HOOK_SECRET"),
  ];
  const out: string[] = [];
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    if (!HOOK_SECRET_RE.test(trimmed)) {
      console.warn(
        "[auth-allowlist] pomijam sekret w złym formacie (wymagane v1,whsec_...):",
        trimmed.slice(0, 12) + "...",
      );
      continue;
    }
    out.push(trimmed.replace(/^v1,whsec_/, ""));
  }
  return [...new Set(out)];
}

function webhookHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = {};
  for (const key of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
    const v = req.headers.get(key);
    if (v) h[key] = v;
  }
  return h;
}

function verifyHookPayload(payloadText: string, headers: Record<string, string>): HookPayload {
  const secrets = collectHookSigningSecrets();
  if (secrets.length === 0) {
    throw new Error("no_valid_hook_secret");
  }

  let lastErr: unknown;
  for (const secret of secrets) {
    try {
      const wh = new Webhook(secret);
      return wh.verify(payloadText, headers) as HookPayload;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("verify_failed");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payloadText = await req.text();
  const headers = webhookHeaders(req);

  let event: HookPayload;
  try {
    event = verifyHookPayload(payloadText, headers);
  } catch (e) {
    console.error("[auth-allowlist] verify", e);
    if (String(e).includes("no_valid_hook_secret")) {
      return deny(
        "Hook auth nie skonfigurowany. W Dashboard → Authentication → Auth Hooks skopiuj sekret (v1,whsec_...) i ustaw: supabase secrets set BEFORE_USER_CREATED_HOOK_SECRET=\"v1,whsec_...\"",
      );
    }
    return deny(
      "Sekret hooka nie zgadza się z Dashboardem. Skopiuj ponownie sekret z Authentication → Auth Hooks → before-user-created, ustaw BEFORE_USER_CREATED_HOOK_SECRET i usuń stary AUTH_HOOK_SECRET jeśli był własny string.",
    );
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
