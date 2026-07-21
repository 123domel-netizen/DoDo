// Współdzielone klienty Supabase dla Edge Functions (Deno).
//
//  - createUserClient(req): klient DZIAŁAJĄCY W IMIENIU WYWOŁUJĄCEGO —
//    token z nagłówka Authorization jest przekazywany dalej, więc RLS
//    (row level security) jest respektowane. Weryfikuje JWT przez
//    auth.getUser() (autorytatywna weryfikacja, nie tylko dekodowanie) i
//    zwraca zweryfikowane userId.
//  - createServiceClient(): klient z SERVICE ROLE KEY — obchodzi RLS, do
//    użycia po własnoręcznej weryfikacji uprawnień (np. zapisy do
//    org_storage_connections, którego RLS pozwala tylko na SELECT).
//
// Sekrety: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY są dostępne automatycznie w
// Edge Functions; SUPABASE_ANON_KEY trzeba ustawić jako sekret).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export interface UserClientResult {
  supabase: SupabaseClient;
  userId: string;
}

/**
 * Klient z tokenem wywołującego (RLS aktywne) + zweryfikowane userId.
 * Rzuca AuthError gdy brak/nieprawidłowy nagłówek Authorization.
 */
export async function createUserClient(req: Request): Promise<UserClientResult> {
  const authHeader =
    req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) {
    throw new AuthError("Brak nagłówka Authorization.", 401);
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new AuthError("Supabase nie jest skonfigurowany na serwerze.", 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    throw new AuthError("Nieprawidłowa lub wygasła sesja.", 401);
  }
  return { supabase, userId: data.user.id };
}

/** Klient z SERVICE ROLE KEY — obchodzi RLS, do zapisów uprzywilejowanych. */
export function createServiceClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nie jest skonfigurowany na serwerze.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
