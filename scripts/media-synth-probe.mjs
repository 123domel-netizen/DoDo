#!/usr/bin/env node
/**
 * Syntetyczny test R2 → confirm → job → Worker enqueue (bez prywatnych zdjęć).
 *
 * Wymaga env (NIE commituj wartości):
 *   VITE_SUPABASE_URL / SUPABASE_URL
 *   SUPABASE_ANON_KEY (user JWT flow) OR service role + test user token
 *   SYNTH_ACCESS_TOKEN — JWT użytkownika będącego członkiem rozmowy
 *   SYNTH_GALLERY_ID, SYNTH_ITEM_ID — wiersze testowe z pipeline=r2_sp
 *   lub tryb --probe-info tylko media_pipeline_info
 *
 * Użycie:
 *   node scripts/media-synth-probe.mjs --info
 *
 * Nie uruchamiaj z prywatnymi plikami. Payload = mały bufor JPEG syntetyczny.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const token = process.env.SYNTH_ACCESS_TOKEN;

async function callGalleryApi(action, body = {}) {
  if (!url || !anon || !token) {
    throw new Error("Brak SUPABASE_URL / ANON / SYNTH_ACCESS_TOKEN");
  }
  const res = await fetch(`${url}/functions/v1/gallery-api`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const mode = process.argv[2] || "--info";

if (mode === "--info") {
  const r = await callGalleryApi("media_pipeline_info");
  console.log(JSON.stringify({ http: r.status, body: r.json }, null, 2));
  process.exit(r.status >= 400 ? 1 : 0);
}

console.error("Pełny E2E synth wymaga R2 bucket + Edge R2 secrets + Worker preview.");
console.error("Uruchom po odblokowaniu R2 (docs/MEDIA_PIPELINE_PREVIEW_SETUP.md).");
process.exit(2);
