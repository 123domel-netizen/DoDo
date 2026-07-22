import { describe, expect, it } from "vitest";
import {
  assertGalleryFullKeyScope,
  attachmentKey,
  authorizeGalleryMediaAccess,
  clientBuildAllowsR2,
  galleryFullKey,
  galleryThumbKey,
  GLOBAL_DEFAULT_PIPELINE,
  normalizeOrgMediaPipeline,
  normalizeQueueMessage,
  orgIdFromHotKey,
  resolveAttachmentPipeline,
  resolveDualReadSource,
  resolveOrgGalleryPipeline,
  resolveThumbStatusAfterConfirm,
  shouldCleanupR2Object,
  shouldCreateSyncJob,
  shouldProcessArchiveJob,
  validateConfirmHead,
} from "./pipelinePolicy";

const ORG = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const GAL = "11111111-2222-3333-4444-555555555555";
const ITEM = "99999999-8888-7777-6666-555555555555";
const CONV = "abcdef01-2345-6789-abcd-ef0123456789";
const MSG = "fedcba09-8765-4321-abcd-ef0123456789";
const ATT = "12121212-3434-5656-7878-909090909090";

describe("R2 key scope", () => {
  it("generates keys only under org/gallery/item", () => {
    expect(galleryFullKey(ORG, GAL, ITEM)).toBe(
      `hot/teams/${ORG}/galleries/${GAL}/full/${ITEM}.jpg`,
    );
    expect(galleryThumbKey(ORG, GAL, ITEM)).toBe(
      `hot/teams/${ORG}/galleries/${GAL}/thumb/${ITEM}.webp`,
    );
  });

  it("rejects path traversal in ids", () => {
    expect(() => galleryFullKey("../evil", GAL, ITEM)).toThrow();
    expect(() => galleryFullKey(ORG, "x/y", ITEM)).toThrow();
  });

  it("rejects key org/gallery/item substitution", () => {
    const otherOrg = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const key = galleryFullKey(ORG, GAL, ITEM);
    expect(() =>
      assertGalleryFullKeyScope(key, { orgId: otherOrg, galleryId: GAL, itemId: ITEM }),
    ).toThrow(/zakresem/);
    expect(() =>
      assertGalleryFullKeyScope(key, {
        orgId: ORG,
        galleryId: "00000000-0000-0000-0000-000000000000",
        itemId: ITEM,
      }),
    ).toThrow();
  });

  it("attachment keys stay under org/conversation/message", () => {
    const k = attachmentKey(ORG, CONV, MSG, ATT, "raport.pdf");
    expect(k.startsWith(`hot/teams/${ORG}/attachments/${CONV}/${MSG}/${ATT}-`)).toBe(true);
  });
});

describe("pipeline policy", () => {
  it("defaults to legacy_sp", () => {
    expect(GLOBAL_DEFAULT_PIPELINE).toBe("legacy_sp");
    expect(normalizeOrgMediaPipeline(null)).toBe("legacy_sp");
    expect(normalizeOrgMediaPipeline("nope")).toBe("legacy_sp");
  });

  it("client Vite flag cannot alone enable R2", () => {
    expect(clientBuildAllowsR2("r2")).toBe(true);
    expect(
      resolveOrgGalleryPipeline({
        orgMediaPipeline: "legacy_sp",
        r2Configured: true,
        clientRequestedPipeline: "r2_sp",
      }),
    ).toBe("legacy_sp");
  });

  it("enables r2_sp only for org flag + r2 configured", () => {
    expect(
      resolveOrgGalleryPipeline({
        orgMediaPipeline: "r2_sp",
        r2Configured: true,
      }),
    ).toBe("r2_sp");
    expect(
      resolveOrgGalleryPipeline({
        orgMediaPipeline: "r2_sp",
        r2Configured: false,
      }),
    ).toBe("legacy_sp");
  });

  it("org read failure → legacy_sp", () => {
    expect(
      resolveOrgGalleryPipeline({
        orgMediaPipeline: "r2_sp",
        orgReadFailed: true,
        r2Configured: true,
      }),
    ).toBe("legacy_sp");
  });

  it("per-team rollout and immediate rollback", () => {
    expect(
      resolveOrgGalleryPipeline({ orgMediaPipeline: "r2_sp", r2Configured: true }),
    ).toBe("r2_sp");
    expect(
      resolveOrgGalleryPipeline({ orgMediaPipeline: "legacy_sp", r2Configured: true }),
    ).toBe("legacy_sp");
  });

  it("attachments stay legacy in first rollout", () => {
    expect(resolveAttachmentPipeline("r2_sp")).toBe("legacy_supabase");
  });

  it("Vite kill switch only blocks client R2 attempts", () => {
    expect(clientBuildAllowsR2("legacy")).toBe(false);
    expect(clientBuildAllowsR2(undefined)).toBe(false);
  });
});

describe("authorization", () => {
  it("presign/confirm only for conversation member", () => {
    expect(
      authorizeGalleryMediaAccess({
        isConversationMember: false,
        galleryOrgId: ORG,
        keyOrgIdFromPath: ORG,
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      authorizeGalleryMediaAccess({
        isConversationMember: true,
        galleryOrgId: ORG,
        keyOrgIdFromPath: ORG,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects orgId swap via key path", () => {
    const key = galleryFullKey(ORG, GAL, ITEM);
    expect(orgIdFromHotKey(key)).toBe(ORG);
    expect(
      authorizeGalleryMediaAccess({
        isConversationMember: true,
        galleryOrgId: ORG,
        keyOrgIdFromPath: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      }),
    ).toEqual({ ok: false, reason: "org_mismatch" });
  });
});

describe("confirm validation", () => {
  it("rejects missing object", () => {
    expect(
      validateConfirmHead({ objectExists: false, actualSize: null, expectedSize: 100 }),
    ).toEqual({ ok: false, reason: "missing_object" });
  });

  it("rejects size mismatch", () => {
    expect(
      validateConfirmHead({
        objectExists: true,
        actualSize: 1000,
        expectedSize: 50,
      }),
    ).toEqual({ ok: false, reason: "size_mismatch" });
  });

  it("accepts matching size", () => {
    expect(
      validateConfirmHead({
        objectExists: true,
        actualSize: 100,
        expectedSize: 100,
      }),
    ).toEqual({ ok: true });
  });

  it("thumb failure does not affect full ready semantics", () => {
    expect(
      resolveThumbStatusAfterConfirm({ thumbKey: "k", thumbExists: false }),
    ).toBe("failed");
    expect(
      resolveThumbStatusAfterConfirm({ thumbKey: "k", thumbExists: true }),
    ).toBe("ready");
  });
});

describe("sync jobs idempotency", () => {
  it("creates exactly one job for new confirm", () => {
    expect(
      shouldCreateSyncJob({
        existingJobs: [],
        kind: "gallery_full",
        refId: ITEM,
        opId: "op-1",
      }),
    ).toBe(true);
  });

  it("does not duplicate on repeated confirm", () => {
    expect(
      shouldCreateSyncJob({
        existingJobs: [
          { kind: "gallery_full", refId: ITEM, opId: "op-1", state: "pending" },
        ],
        kind: "gallery_full",
        refId: ITEM,
        opId: "op-1",
      }),
    ).toBe(false);
    expect(
      shouldCreateSyncJob({
        existingJobs: [
          { kind: "gallery_full", refId: ITEM, opId: "op-1", state: "done" },
        ],
        kind: "gallery_full",
        refId: ITEM,
        opId: "op-1",
      }),
    ).toBe(false);
  });
});

describe("queue consumer idempotency", () => {
  it("skips already verified (no duplicate SharePoint)", () => {
    expect(
      shouldProcessArchiveJob({
        spStatus: "verified",
        spDriveItemId: "sp-1",
        r2Status: "ready",
      }),
    ).toEqual({ process: false, reason: "already_verified" });
  });

  it("skips stale opId redelivery", () => {
    expect(
      shouldProcessArchiveJob({
        spStatus: "queued",
        spDriveItemId: null,
        r2Status: "ready",
        jobOpId: "old",
        rowOpId: "new",
      }),
    ).toEqual({ process: false, reason: "stale_op" });
  });

  it("processes valid job once", () => {
    expect(
      shouldProcessArchiveJob({
        spStatus: "queued",
        spDriveItemId: null,
        r2Status: "ready",
        jobOpId: "op",
        rowOpId: "op",
      }),
    ).toEqual({ process: true });
  });

  it("ignores R2 event notifications as primary source", () => {
    const n = normalizeQueueMessage({
      object: { key: `hot/teams/${ORG}/galleries/${GAL}/full/${ITEM}.jpg` },
    });
    expect(n.ignoreAsFutureReconciliation).toBe(true);
    expect(n.kind).toBeNull();
  });

  it("accepts explicit enqueue jobs", () => {
    expect(
      normalizeQueueMessage({ kind: "gallery_full", refId: ITEM }),
    ).toEqual({ kind: "gallery_full", refId: ITEM });
  });
});

describe("dual-read", () => {
  it("reads from R2 when ready", () => {
    expect(
      resolveDualReadSource({
        pipeline: "r2_sp",
        r2Status: "ready",
        r2Key: "full",
        r2KeyThumb: "thumb",
        providerItemId: "sp",
        variant: "thumb",
      }),
    ).toBe("r2");
  });

  it("falls back to SharePoint for legacy", () => {
    expect(
      resolveDualReadSource({
        pipeline: "legacy_sp",
        r2Status: "none",
        r2Key: null,
        providerItemId: "sp-item",
        variant: "full",
      }),
    ).toBe("sharepoint");
  });
});

describe("cleanup", () => {
  const base = {
    spStatus: "verified",
    r2Status: "ready",
    r2DeletedAt: null,
    r2DeleteAfter: "2026-01-01T00:00:00.000Z",
    retentionHold: false,
    nowIso: "2026-07-22T00:00:00.000Z",
  };

  it("cleans gallery full only after verified + due", () => {
    expect(shouldCleanupR2Object({ ...base, objectKind: "gallery_full" })).toBe(true);
    expect(
      shouldCleanupR2Object({
        ...base,
        spStatus: "queued",
        objectKind: "gallery_full",
      }),
    ).toBe(false);
    expect(
      shouldCleanupR2Object({
        ...base,
        r2DeleteAfter: "2027-01-01T00:00:00.000Z",
        objectKind: "gallery_full",
      }),
    ).toBe(false);
  });

  it("never cleans gallery thumbs", () => {
    expect(shouldCleanupR2Object({ ...base, objectKind: "gallery_thumb" })).toBe(false);
  });
});
