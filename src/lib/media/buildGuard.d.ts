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
export type MediaBuildGuardResult = {
    ok: true;
    pipeline: BuildPipelineLabel;
} | {
    ok: false;
    pipeline: BuildPipelineLabel;
    message: string;
};
/** Zgodne z `clientBuildAllowsR2` w pipelinePolicy.ts — celowo bez importu. */
export declare function buildPipelineLabel(viteMediaPipeline: string | undefined | null): BuildPipelineLabel;
export declare function checkMediaPipelineBuild(input: {
    command: "build" | "serve";
    mode: string;
    viteMediaPipeline: string | undefined | null;
    /** Świadomy rollback do SharePointa — musi być jawny, nie domyślny. */
    allowLegacyOverride: string | undefined | null;
}): MediaBuildGuardResult;
