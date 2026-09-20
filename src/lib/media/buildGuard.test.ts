import { describe, expect, it } from "vitest";
import { buildPipelineLabel, checkMediaPipelineBuild } from "./buildGuard";

const base = {
  command: "build" as const,
  mode: "production",
  viteMediaPipeline: "r2" as string | undefined,
  allowLegacyOverride: undefined as string | undefined,
};

describe("bramka build-time pipeline'u mediów", () => {
  it("rozpoznaje capability tak samo jak clientBuildAllowsR2", () => {
    expect(buildPipelineLabel("r2")).toBe("r2");
    expect(buildPipelineLabel("r2_sp")).toBe("r2");
    expect(buildPipelineLabel(" R2 ")).toBe("r2");
    expect(buildPipelineLabel("legacy")).toBe("legacy");
    expect(buildPipelineLabel("")).toBe("legacy");
    expect(buildPipelineLabel(undefined)).toBe("legacy");
  });

  it("przepuszcza build produkcyjny z R2", () => {
    expect(checkMediaPipelineBuild(base)).toEqual({ ok: true, pipeline: "r2" });
  });

  it("przerywa build produkcyjny bez R2 — to była przyczyna incydentu galerii", () => {
    const res = checkMediaPipelineBuild({ ...base, viteMediaPipeline: "legacy" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.pipeline).toBe("legacy");
      expect(res.message).toContain("VITE_MEDIA_PIPELINE");
      expect(res.message).toContain("ALLOW_LEGACY_MEDIA_BUILD");
    }
  });

  it("brak zmiennej jest traktowany jak legacy, nie jak zgoda", () => {
    expect(checkMediaPipelineBuild({ ...base, viteMediaPipeline: undefined }).ok).toBe(false);
  });

  it("obejmuje też preview wystawiane użytkownikom", () => {
    const res = checkMediaPipelineBuild({
      ...base,
      mode: "projects-preview",
      viteMediaPipeline: "legacy",
    });
    expect(res.ok).toBe(false);
  });

  it("pozwala na świadomy rollback do SharePointa", () => {
    for (const override of ["1", "true", "TRUE"]) {
      const res = checkMediaPipelineBuild({
        ...base,
        viteMediaPipeline: "legacy",
        allowLegacyOverride: override,
      });
      expect(res).toEqual({ ok: true, pipeline: "legacy" });
    }
  });

  it("nie blokuje dev servera ani trybów niewystawianych użytkownikom", () => {
    expect(
      checkMediaPipelineBuild({ ...base, command: "serve", viteMediaPipeline: "legacy" }).ok,
    ).toBe(true);
    expect(
      checkMediaPipelineBuild({ ...base, mode: "test", viteMediaPipeline: "legacy" }).ok,
    ).toBe(true);
  });
});
