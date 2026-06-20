import { decryptToken, encryptToken } from "./crypto.ts";
import { adminClient } from "./supabaseAdmin.ts";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";

export interface GoogleAccountRow {
  user_id: string;
  google_email: string;
  refresh_token_encrypted: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  scopes: string[];
}

export async function getAccessToken(userId: string): Promise<string | null> {
  const admin = adminClient();
  const keyHex = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY");
  if (!keyHex || keyHex.length !== 64) {
    console.error("[google] GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hex chars");
    return null;
  }

  const { data: row, error } = await admin
    .from("google_accounts")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !row) return null;
  const acct = row as GoogleAccountRow;

  const expiresAt = acct.access_token_expires_at
    ? new Date(acct.access_token_expires_at).getTime()
    : 0;
  if (acct.access_token && expiresAt > Date.now() + 60_000) {
    return acct.access_token;
  }

  const refreshToken = await decryptToken(acct.refresh_token_encrypted, keyHex);
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    console.error("[google] refresh failed", await res.text());
    return null;
  }

  const body = await res.json();
  const accessToken = body.access_token as string;
  const expiresIn = (body.expires_in as number) ?? 3600;
  const newExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  let newRefreshEnc = acct.refresh_token_encrypted;
  if (body.refresh_token) {
    newRefreshEnc = await encryptToken(body.refresh_token as string, keyHex);
  }

  await admin
    .from("google_accounts")
    .update({
      access_token: accessToken,
      access_token_expires_at: newExpiry,
      refresh_token_encrypted: newRefreshEnc,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return accessToken;
}

export async function googleFetch(
  userId: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken(userId);
  if (!token) throw new Error("No Google access token");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "";
  const data = await res.json();
  return (data.email as string) ?? "";
}

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
  "openid",
  "email",
].join(" ");
