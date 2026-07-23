import { describe, expect, it, vi, afterEach } from "vitest";
import { clientBuildAllowsR2 } from "./pipelinePolicy";

describe("isR2PreviewSurface visibility contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("prod host + VITE=r2 allows client R2 but is NOT a preview surface", async () => {
    expect(clientBuildAllowsR2("r2")).toBe(true);
    vi.stubEnv("VITE_MEDIA_PIPELINE", "r2");
    vi.stubGlobal("window", {
      location: { hostname: "dodo-c39.pages.dev", origin: "https://dodo-c39.pages.dev" },
    });
    vi.resetModules();
    const { isR2PreviewSurface, clientBuildPipelineLabel } = await import("./previewSurface");
    expect(clientBuildPipelineLabel()).toBe("r2");
    expect(isR2PreviewSurface()).toBe(false);
  });

  it("media-r2-preview host is a preview surface even without VITE=r2", async () => {
    vi.stubEnv("VITE_MEDIA_PIPELINE", "");
    vi.stubGlobal("window", {
      location: {
        hostname: "media-r2-preview.dodo-c39.pages.dev",
        origin: "https://media-r2-preview.dodo-c39.pages.dev",
      },
    });
    vi.resetModules();
    const { isR2PreviewSurface } = await import("./previewSurface");
    expect(isR2PreviewSurface()).toBe(true);
  });

  it("legacy prod build without preview host is not preview", async () => {
    expect(clientBuildAllowsR2(undefined)).toBe(false);
    vi.stubEnv("VITE_MEDIA_PIPELINE", "");
    vi.stubGlobal("window", {
      location: { hostname: "dodo-c39.pages.dev", origin: "https://dodo-c39.pages.dev" },
    });
    vi.resetModules();
    const { isR2PreviewSurface, clientBuildPipelineLabel } = await import("./previewSurface");
    expect(clientBuildPipelineLabel()).toBe("legacy");
    expect(isR2PreviewSurface()).toBe(false);
  });

  it("localhost is a preview surface for local diagnostics", async () => {
    vi.stubEnv("VITE_MEDIA_PIPELINE", "r2");
    vi.stubGlobal("window", {
      location: { hostname: "localhost", origin: "http://localhost:5173" },
    });
    vi.resetModules();
    const { isR2PreviewSurface } = await import("./previewSurface");
    expect(isR2PreviewSurface()).toBe(true);
  });
});
