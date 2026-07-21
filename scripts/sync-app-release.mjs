import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.cwd(), ".env.local"));

const version =
  process.env.APP_BUILD_VERSION?.trim() ||
  (() => {
    try {
      return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
      return process.env.npm_package_version || "dev";
    }
  })();

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Brak VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — ustaw w .env.local przed release:sync.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey);
const { error } = await supabase.from("app_release").upsert({
  id: "client",
  version,
  updated_at: new Date().toISOString(),
});

if (error) {
  console.error("release:sync failed:", error.message);
  process.exit(1);
}

console.log(`app_release.client = ${version}`);
