/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_BUILD_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** Build-time kill switch only: `r2` | `r2_sp` allows client R2 path. */
  readonly VITE_MEDIA_PIPELINE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
