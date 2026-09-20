/**
 * Bramka build-time dla pipeline'u mediów (bez importów — używana też z vite.config.ts).
 *
 * Tło: `orgs.media_pipeline` przestawiono na `r2_sp`, ale produkcyjny bundle
 * powstawał z lokalnego, gitignorowanego `.env`. Gdy zabrakło tam
 * `VITE_MEDIA_PIPELINE=r2`, klient odmawiał wysyłki galerii, a repozytorium nie
 * dawało żadnego sygnału, że build jest niezgodny z serwerem. Build musi więc
 * jawnie deklarować swoje capability, a niezgodność ma przerywać build.
 */

export type BuildPipelineLabel = "r2" | "legacy";

export type MediaBuildGuardResult =
  | { ok: true; pipeline: BuildPipelineLabel }
  | { ok: false; pipeline: BuildPipelineLabel; message: string };

/** Tryby Vite, z których powstaje bundle wystawiany użytkownikom. */
const DEPLOYED_MODES = new Set(["production", "projects-preview"]);

/** Zgodne z `clientBuildAllowsR2` w pipelinePolicy.ts — celowo bez importu. */
export function buildPipelineLabel(
  viteMediaPipeline: string | undefined | null,
): BuildPipelineLabel {
  const v = (viteMediaPipeline ?? "").toLowerCase().trim();
  return v === "r2" || v === "r2_sp" ? "r2" : "legacy";
}

export function checkMediaPipelineBuild(input: {
  command: "build" | "serve";
  mode: string;
  viteMediaPipeline: string | undefined | null;
  /** Świadomy rollback do SharePointa — musi być jawny, nie domyślny. */
  allowLegacyOverride: string | undefined | null;
}): MediaBuildGuardResult {
  const pipeline = buildPipelineLabel(input.viteMediaPipeline);
  if (input.command !== "build") return { ok: true, pipeline };
  if (!DEPLOYED_MODES.has(input.mode)) return { ok: true, pipeline };
  if (pipeline === "r2") return { ok: true, pipeline };

  const override = (input.allowLegacyOverride ?? "").trim();
  if (override === "1" || override.toLowerCase() === "true") {
    return { ok: true, pipeline };
  }

  return {
    ok: false,
    pipeline,
    message: [
      `Build "${input.mode}" ma VITE_MEDIA_PIPELINE="${input.viteMediaPipeline ?? ""}" (legacy),`,
      "więc klient nie obsłuży galerii zespołów przestawionych na r2_sp",
      "— dokładnie ten rozjazd wywołał incydent z komunikatem",
      '"Ta wersja aplikacji nie obsługuje nowego przesyłania galerii".',
      "",
      "Napraw jedną z dwóch rzeczy:",
      "  • ustaw VITE_MEDIA_PIPELINE=r2 (domyślnie robi to .env.production w repo), albo",
      "  • jeśli to świadomy rollback do SharePointa, uruchom build z ALLOW_LEGACY_MEDIA_BUILD=1",
      "    i najpierw cofnij zespoły na legacy_sp (Ustawienia → Zespół → Magazyn plików).",
    ].join("\n"),
  };
}
