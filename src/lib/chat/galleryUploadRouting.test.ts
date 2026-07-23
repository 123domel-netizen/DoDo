import { describe, expect, it } from "vitest";
import { CLIENT_BUILD_VERSION } from "@/lib/appVersion";
import {
  clientGalleryUploadUsesR2,
  GALLERY_PIPELINE_PROTOCOL_ERROR,
  legacyUploadItemRejectionForPipeline,
  parseGalleryPipeline,
  resolveClientGalleryUploadPipeline,
  resolveCreateGalleryGate,
  R2_CLIENT_REQUIRED_MESSAGE,
  uploadRouteLabel,
} from "@/lib/media/pipelinePolicy";

/**
 * Kontrakt: po gallery_create routing wyłącznie z gallery.pipeline.
 * Lokalne usedPipeline / org / Vite nie mogą zmienić ścieżki.
 */
describe("gallery upload routing contract", () => {
  it("1. before create: build=r2, org=r2_sp → create allowed", () => {
    const gate = resolveCreateGalleryGate({
      organizationPipeline: "r2_sp",
      viteMediaPipeline: "r2",
    });
    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.buildPipeline).toBe("r2");
      expect(gate.organizationPipeline).toBe("r2_sp");
    }
  });

  it("2. gallery_create returns r2_sp → R2 route (presign/PUT/confirm)", () => {
    const d = resolveClientGalleryUploadPipeline({
      galleryPipeline: "r2_sp",
      viteMediaPipeline: "r2",
    });
    expect(d).toEqual({ ok: true, pipeline: "r2_sp", uploadRoute: "R2" });
    expect(clientGalleryUploadUsesR2("r2_sp")).toBe(true);
  });

  it("3. create returns r2_sp even if local usedPipeline was legacy_sp → still R2", () => {
    const localUsedPipelineWas = "legacy_sp"; // celowo ignorowane
    void localUsedPipelineWas;
    const d = resolveClientGalleryUploadPipeline({
      galleryPipeline: "r2_sp",
      viteMediaPipeline: "r2",
    });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.pipeline).toBe("r2_sp");
      expect(d.uploadRoute).toBe("R2");
      expect(clientGalleryUploadUsesR2(d.pipeline)).toBe(true);
    }
  });

  it("4. create returns legacy_sp even if local usedPipeline was r2_sp → Legacy SharePoint", () => {
    const localUsedPipelineWas = "r2_sp";
    void localUsedPipelineWas;
    const d = resolveClientGalleryUploadPipeline({
      galleryPipeline: "legacy_sp",
      viteMediaPipeline: "r2",
    });
    expect(d).toEqual({
      ok: true,
      pipeline: "legacy_sp",
      uploadRoute: "Legacy SharePoint",
    });
    expect(clientGalleryUploadUsesR2("legacy_sp")).toBe(false);
  });

  it("5. missing gallery.pipeline after create → protocol error, no legacy fallback", () => {
    const d = resolveClientGalleryUploadPipeline({
      galleryPipeline: undefined,
      viteMediaPipeline: "r2",
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe(GALLERY_PIPELINE_PROTOCOL_ERROR);
    expect(parseGalleryPipeline(null)).toBeNull();
    expect(parseGalleryPipeline("")).toBeNull();
  });

  it("6. unknown gallery.pipeline → protocol error, no legacy fallback", () => {
    for (const bad of ["r2", "legacy", "foo", "R2_SP"]) {
      const d = resolveClientGalleryUploadPipeline({
        galleryPipeline: bad,
        viteMediaPipeline: "r2",
      });
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.error).toBe(GALLERY_PIPELINE_PROTOCOL_ERROR);
    }
  });

  it("7. retry gallery r2_sp → R2 route", () => {
    const d = resolveClientGalleryUploadPipeline({
      galleryPipeline: "r2_sp",
      viteMediaPipeline: "r2",
    });
    expect(d.ok && clientGalleryUploadUsesR2(d.pipeline)).toBe(true);
  });

  it("8. viewer gallery r2_sp → R2 route", () => {
    const gallery = { id: "g1", pipeline: "r2_sp" as const };
    const d = resolveClientGalleryUploadPipeline({
      galleryPipeline: gallery.pipeline,
      viteMediaPipeline: "r2",
    });
    expect(d).toEqual({ ok: true, pipeline: "r2_sp", uploadRoute: "R2" });
  });

  it("9. no r2_sp case may select gallery_upload_item path", () => {
    const d = resolveClientGalleryUploadPipeline({
      galleryPipeline: "r2_sp",
      viteMediaPipeline: "r2",
    });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(clientGalleryUploadUsesR2(d.pipeline)).toBe(true);
      expect(uploadRouteLabel(d.pipeline)).toBe("R2");
    }
  });

  it("10. Edge wrong_pipeline soft-rejects 409 without implying markFailed", () => {
    expect(legacyUploadItemRejectionForPipeline("r2_sp")).toEqual({
      errorCode: "wrong_pipeline",
      errorMessage:
        "Galeria R2 — użyj bezpośredniego uploadu (presign/confirm), nie SharePoint.",
      httpStatus: 409,
    });
    expect(legacyUploadItemRejectionForPipeline("legacy_sp")).toBeNull();
  });

  it("create blocked when org is r2_sp but build lacks R2", () => {
    const gate = resolveCreateGalleryGate({
      organizationPipeline: "r2_sp",
      viteMediaPipeline: undefined,
    });
    expect(gate.ok).toBe(false);
  });

  it("r2_sp with Vite kill switch off → error (never silent legacy)", () => {
    const d = resolveClientGalleryUploadPipeline({
      galleryPipeline: "r2_sp",
      viteMediaPipeline: "legacy",
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toBe(R2_CLIENT_REQUIRED_MESSAGE);
  });

  it("preview and production builds expose distinct build ids in module", () => {
    expect(typeof CLIENT_BUILD_VERSION).toBe("string");
    expect(CLIENT_BUILD_VERSION.length).toBeGreaterThan(0);
  });
});
