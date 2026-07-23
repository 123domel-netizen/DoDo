import { describe, expect, it, beforeEach } from "vitest";
import {
  formatMediaUploadDiagForCopy,
  getMediaUploadDiag,
  nextActionForGalleryPipeline,
  patchMediaUploadDiag,
  plannedRouteFromTeamPipeline,
  resetMediaUploadDiag,
} from "./mediaUploadDiag";
import { uploadGalleryItem } from "@/lib/chat/galleryApi";

describe("mediaUploadDiag", () => {
  beforeEach(() => {
    resetMediaUploadDiag();
  });

  it("planned route reflects team + build before create", () => {
    expect(plannedRouteFromTeamPipeline("r2_sp", "r2")).toContain("R2");
    expect(plannedRouteFromTeamPipeline("r2_sp", "legacy")).toContain("BLOCKED");
    expect(plannedRouteFromTeamPipeline("legacy_sp", "r2")).toContain("Legacy");
  });

  it("next action after create is presign for r2_sp", () => {
    expect(nextActionForGalleryPipeline("r2_sp")).toBe("r2_presign_gallery_items");
    expect(nextActionForGalleryPipeline("legacy_sp")).toBe("gallery_upload_item");
  });

  it("copy text has no secrets, URLs, or file payloads", () => {
    patchMediaUploadDiag({
      galleryId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      teamPipeline: "r2_sp",
      serverGalleryPipeline: "r2_sp",
      selectedUploadRoute: "R2",
      nextAction: "r2_presign_gallery_items",
      lastMediaAction: "gallery_create ok",
      plannedUploadRoute: "R2 (pending gallery_create)",
    });
    const text = formatMediaUploadDiagForCopy(getMediaUploadDiag());
    expect(text).toContain("Build ID:");
    expect(text).toContain("Server gallery pipeline: r2_sp");
    expect(text).toContain("Selected upload route: R2");
    expect(text).not.toMatch(/https?:\/\//i);
    expect(text).not.toMatch(/Authorization|Bearer |apikey|X-Amz-|signed/i);
    expect(text).not.toMatch(/WhatsApp|\.jpe?g|content-type/i);
  });
});

describe("uploadGalleryItem hard block for r2_sp", () => {
  it("refuses gallery_upload_item before HTTP when gallery.pipeline is r2_sp", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    const res = await uploadGalleryItem("g1", "i1", blob, null, {
      galleryPipeline: "r2_sp",
      fileName: "x.jpg",
    });
    expect(res.error).toMatch(/zablokowano gallery_upload_item/i);
    expect(res.data).toBeUndefined();
    expect(getMediaUploadDiag().lastMediaAction).toMatch(/BLOCKED_gallery_upload_item/);
  });
});
