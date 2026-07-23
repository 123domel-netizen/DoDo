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
  resolveClientGalleryUploadPipeline,
  clientGalleryUploadUsesR2,
  legacyUploadItemRejectionForPipeline,
  preferLocalThumbOverRemoteMiss,
  resolveCreateGalleryGate,
  R2_CLIENT_REQUIRED_MESSAGE,
  selectGalleryDeckItems,
  resolveDualReadSource,
  resolveOrgGalleryPipeline,
  resolveThumbStatusAfterConfirm,
  shouldCleanupR2Object,
  shouldCreateSyncJob,
  shouldCronEnqueueGalleryItem,
  shouldDeleteR2OnPermanentFailure,
  shouldProcessArchiveJob,
  shouldReconcileJobWithoutUpload,
  canTransitionJobState,
  jobStateAfterSuccessfulSync,
  jobStateAfterSyncError,
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

  it("never silently falls back from r2_sp gallery to legacy upload", () => {
    expect(
      resolveClientGalleryUploadPipeline({
        galleryPipeline: "r2_sp",
        viteMediaPipeline: "r2",
      }),
    ).toEqual({ ok: true, pipeline: "r2_sp", uploadRoute: "R2" });
    const blocked = resolveClientGalleryUploadPipeline({
      galleryPipeline: "r2_sp",
      viteMediaPipeline: "legacy",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe(R2_CLIENT_REQUIRED_MESSAGE);
    expect(
      resolveClientGalleryUploadPipeline({
        galleryPipeline: "legacy_sp",
        viteMediaPipeline: "legacy",
      }),
    ).toEqual({ ok: true, pipeline: "legacy_sp", uploadRoute: "Legacy SharePoint" });
  });

  it("r2_sp uses R2 path only; legacy_sp uses multipart upload path", () => {
    expect(clientGalleryUploadUsesR2("r2_sp")).toBe(true);
    expect(clientGalleryUploadUsesR2("legacy_sp")).toBe(false);
  });

  it("create gate blocks before gallery row when org is r2_sp but build is legacy", () => {
    const gate = resolveCreateGalleryGate({
      organizationPipeline: "r2_sp",
      viteMediaPipeline: "legacy",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.error).toBe(R2_CLIENT_REQUIRED_MESSAGE);
      expect(gate.buildPipeline).toBe("legacy");
      expect(gate.organizationPipeline).toBe("r2_sp");
    }
    const ok = resolveCreateGalleryGate({
      organizationPipeline: "r2_sp",
      viteMediaPipeline: "r2",
    });
    expect(ok).toEqual({
      ok: true,
      buildPipeline: "r2",
      organizationPipeline: "r2_sp",
      effectivePipeline: "r2_sp",
    });
  });

  it("blocks creating/uploading r2_sp when Vite kill switch is off (no orphan r2 record)", () => {
    const beforeCreate = resolveClientGalleryUploadPipeline({
      galleryPipeline: "r2_sp",
      viteMediaPipeline: undefined,
    });
    expect(beforeCreate.ok).toBe(false);
    if (!beforeCreate.ok) {
      expect(beforeCreate.error).toBe(R2_CLIENT_REQUIRED_MESSAGE);
    }
  });

  it("missing or unknown gallery.pipeline is protocol error (no legacy fallback)", () => {
    expect(
      resolveClientGalleryUploadPipeline({
        galleryPipeline: null,
        viteMediaPipeline: "r2",
      }).ok,
    ).toBe(false);
    expect(
      resolveClientGalleryUploadPipeline({
        galleryPipeline: "mystery",
        viteMediaPipeline: "r2",
      }).ok,
    ).toBe(false);
  });

  it("wrong_pipeline soft-rejects with HTTP 409 and does not imply markFailed", () => {
    expect(legacyUploadItemRejectionForPipeline("r2_sp")).toEqual({
      errorCode: "wrong_pipeline",
      errorMessage:
        "Galeria R2 — użyj bezpośredniego uploadu (presign/confirm), nie SharePoint.",
      httpStatus: 409,
    });
    expect(legacyUploadItemRejectionForPipeline("legacy_sp")).toBeNull();
    expect(legacyUploadItemRejectionForPipeline(null)).toBeNull();
  });

  it("deck includes pending/uploading/failed when local thumb exists", () => {
    const items = [
      { id: "a", status: "pending" },
      { id: "b", status: "uploading" },
      { id: "c", status: "failed" },
      { id: "d", status: "ready" },
      { id: "e", status: "pending" },
    ];
    const local = new Set(["a", "c"]);
    const deck = selectGalleryDeckItems({
      items,
      maxSlots: 3,
      hasLocalThumb: (id) => local.has(id),
    });
    expect(deck.map((x) => x.id)).toEqual(["d", "a", "c"]);
  });

  it("remote thumb miss does not imply gallery failure when local thumb exists", () => {
    const withLocal = preferLocalThumbOverRemoteMiss({
      localThumbUrl: "blob:http://local/thumb",
      remoteThumbUrl: null,
    });
    expect(withLocal.url).toBe("blob:http://local/thumb");
    expect(withLocal.remoteMissOnly).toBe(false);

    const remoteOnly = preferLocalThumbOverRemoteMiss({
      localThumbUrl: null,
      remoteThumbUrl: "https://example/thumb",
    });
    expect(remoteOnly.url).toBe("https://example/thumb");
    expect(remoteOnly.remoteMissOnly).toBe(false);

    const miss = preferLocalThumbOverRemoteMiss({
      localThumbUrl: null,
      remoteThumbUrl: null,
    });
    expect(miss.url).toBeNull();
    expect(miss.remoteMissOnly).toBe(true);
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

  it("cleanup still requires verified + r2_delete_after elapsed", () => {
    expect(
      shouldCleanupR2Object({
        ...base,
        spStatus: "permanent_failure",
        objectKind: "gallery_full",
      }),
    ).toBe(false);
    expect(
      shouldCleanupR2Object({
        ...base,
        r2DeleteAfter: null,
        objectKind: "gallery_full",
      }),
    ).toBe(false);
  });
});

describe("media_sync_jobs lifecycle", () => {
  it("1. successful sync targets item verified + job done", () => {
    expect(jobStateAfterSuccessfulSync("running")).toBe("done");
    expect(jobStateAfterSuccessfulSync("pending")).toBe("done");
  });

  it("2. done clears error/lock fields conceptually (nulls)", () => {
    // Worker markJobDone sets last_error=null, locked_at=null — policy only asserts target state.
    expect(jobStateAfterSuccessfulSync("running")).toBe("done");
    expect(canTransitionJobState("running", "done")).toBe(true);
  });

  it("3. verified + pending reconciles without re-upload", () => {
    expect(
      shouldReconcileJobWithoutUpload({
        itemSpStatus: "verified",
        itemHasSpDriveItem: true,
        jobState: "pending",
      }),
    ).toBe(true);
    expect(
      shouldProcessArchiveJob({
        spStatus: "verified",
        spDriveItemId: "sp-1",
        r2Status: "ready",
      }).reason,
    ).toBe("already_verified");
  });

  it("4. redelivery of done skips upload", () => {
    expect(jobStateAfterSuccessfulSync("done")).toBeNull();
    expect(
      shouldReconcileJobWithoutUpload({
        itemSpStatus: "verified",
        itemHasSpDriveItem: true,
        jobState: "done",
      }),
    ).toBe(false);
  });

  it("5. cron never enqueues verified items", () => {
    expect(shouldCronEnqueueGalleryItem("verified")).toBe(false);
    expect(shouldCronEnqueueGalleryItem("queued")).toBe(true);
    expect(shouldCronEnqueueGalleryItem("failed")).toBe(true);
    expect(shouldCronEnqueueGalleryItem("retry_scheduled")).toBe(true);
    expect(shouldCronEnqueueGalleryItem("copying")).toBe(false);
  });

  it("6. error before upload leaves job retryable (failed)", () => {
    expect(jobStateAfterSyncError({ permanent: false, attempts: 1 })).toBe("failed");
    expect(canTransitionJobState("failed", "pending")).toBe(true);
    expect(canTransitionJobState("failed", "running")).toBe(true);
  });

  it("7. error after item verified reconciles job without duplicate upload", () => {
    expect(
      shouldReconcileJobWithoutUpload({
        itemSpStatus: "verified",
        itemHasSpDriveItem: true,
        jobState: "running",
      }),
    ).toBe(true);
  });

  it("8. permanent failure never deletes R2", () => {
    expect(jobStateAfterSyncError({ permanent: true, attempts: 1 })).toBe("dead");
    expect(shouldDeleteR2OnPermanentFailure()).toBe(false);
    expect(
      shouldCleanupR2Object({
        spStatus: "permanent_failure",
        r2Status: "ready",
        r2DeletedAt: null,
        r2DeleteAfter: "2020-01-01T00:00:00.000Z",
        retentionHold: true,
        nowIso: "2026-07-22T00:00:00.000Z",
        objectKind: "gallery_full",
      }),
    ).toBe(false);
  });

  it("9–10. cleanup requires verified+due; thumbs never cleaned", () => {
    expect(
      shouldCleanupR2Object({
        spStatus: "verified",
        r2Status: "ready",
        r2DeletedAt: null,
        r2DeleteAfter: "2020-01-01T00:00:00.000Z",
        retentionHold: false,
        nowIso: "2026-07-22T00:00:00.000Z",
        objectKind: "gallery_full",
      }),
    ).toBe(true);
    expect(
      shouldCleanupR2Object({
        spStatus: "verified",
        r2Status: "ready",
        r2DeletedAt: null,
        r2DeleteAfter: "2020-01-01T00:00:00.000Z",
        retentionHold: false,
        nowIso: "2026-07-22T00:00:00.000Z",
        objectKind: "gallery_thumb",
      }),
    ).toBe(false);
  });

  it("forbids done → pending without admin", () => {
    expect(canTransitionJobState("done", "pending")).toBe(false);
    expect(canTransitionJobState("pending", "running")).toBe(true);
    expect(canTransitionJobState("running", "done")).toBe(true);
    expect(canTransitionJobState("running", "failed")).toBe(true);
    expect(canTransitionJobState("failed", "pending")).toBe(true);
    expect(canTransitionJobState("failed", "dead")).toBe(true);
  });

  it("attempts past max become dead", () => {
    expect(jobStateAfterSyncError({ permanent: false, attempts: 8 })).toBe("dead");
    expect(jobStateAfterSyncError({ permanent: false, attempts: 7 })).toBe("failed");
  });
});
