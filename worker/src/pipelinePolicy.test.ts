import { describe, expect, it } from "vitest";
import {
  canTransitionJobState,
  jobStateAfterSuccessfulSync,
  jobStateAfterSyncError,
  shouldCleanupR2Object,
  shouldCronEnqueueGalleryItem,
  shouldDeleteR2OnPermanentFailure,
  shouldProcessArchiveJob,
  shouldReconcileJobWithoutUpload,
} from "./pipelinePolicy";

describe("worker media_sync_jobs", () => {
  it("marks success path as done", () => {
    expect(jobStateAfterSuccessfulSync("running")).toBe("done");
  });

  it("reconciles verified + pending without upload", () => {
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
        spDriveItemId: "x",
        r2Status: "ready",
      }).reason,
    ).toBe("already_verified");
  });

  it("done redelivery skips upload", () => {
    expect(
      shouldReconcileJobWithoutUpload({
        itemSpStatus: "verified",
        itemHasSpDriveItem: true,
        jobState: "done",
      }),
    ).toBe(false);
  });

  it("cron skips verified", () => {
    expect(shouldCronEnqueueGalleryItem("verified")).toBe(false);
  });

  it("pre-upload failure stays retryable", () => {
    expect(jobStateAfterSyncError({ permanent: false, attempts: 2 })).toBe("failed");
  });

  it("post-verify failure reconciles", () => {
    expect(
      shouldReconcileJobWithoutUpload({
        itemSpStatus: "verified",
        itemHasSpDriveItem: true,
        jobState: "running",
      }),
    ).toBe(true);
  });

  it("permanent failure does not delete R2", () => {
    expect(jobStateAfterSyncError({ permanent: true, attempts: 1 })).toBe("dead");
    expect(shouldDeleteR2OnPermanentFailure()).toBe(false);
  });

  it("cleanup requires verified + due; never thumbs", () => {
    expect(
      shouldCleanupR2Object({
        spStatus: "verified",
        r2Status: "ready",
        r2DeletedAt: null,
        r2DeleteAfter: "2020-01-01T00:00:00.000Z",
        retentionHold: false,
        nowIso: "2026-07-23T00:00:00.000Z",
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
        nowIso: "2026-07-23T00:00:00.000Z",
        objectKind: "gallery_thumb",
      }),
    ).toBe(false);
  });

  it("forbids done → pending", () => {
    expect(canTransitionJobState("done", "pending")).toBe(false);
  });
});
