import { describe, expect, it, vi, afterEach } from "vitest";
import { clientBuildAllowsR2 } from "./pipelinePolicy";

describe("isR2PreviewSurface visibility contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("preview build with VITE=r2 is always a preview surface", async () => {
    expect(clientBuildAllowsR2("r2")).toBe(true);
    vi.stubEnv("VITE_MEDIA_PIPELINE", "r2");
    vi.resetModules();
    const { isR2PreviewSurface } = await import("./previewSurface");
    expect(isR2PreviewSurface()).toBe(true);
  });

  it("production-like build without VITE=r2 is not preview (no window host)", async () => {
    expect(clientBuildAllowsR2(undefined)).toBe(false);
    vi.stubEnv("VITE_MEDIA_PIPELINE", "");
    vi.resetModules();
    const { isR2PreviewSurface } = await import("./previewSurface");
    // Without Vite r2 and without media-r2-preview hostname → false in jsdom default
    expect(isR2PreviewSurface()).toBe(false);
  });
});
