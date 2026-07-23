import { describe, expect, it } from "vitest";
import {
  resolveAttachmentPipeline,
  resolveDualReadSource,
  shouldCreateSyncJob,
  shouldReconcileJobWithoutUpload,
  shouldCleanupR2Object,
  jobStateAfterSuccessfulSync,
} from "./pipelinePolicy";

describe("ATTACH1 attachment pipeline", () => {
  it("enables R2 for r2_sp org when configured", () => {
    expect(
      resolveAttachmentPipeline({ orgMediaPipeline: "r2_sp", r2Configured: true }),
    ).toBe("r2_sp");
  });

  it("keeps voice/forward on legacy via forceLegacy", () => {
    expect(
      resolveAttachmentPipeline({
        orgMediaPipeline: "r2_sp",
        r2Configured: true,
        forceLegacy: true,
      }),
    ).toBe("legacy_supabase");
  });

  it("dual-read prefers R2 then SharePoint", () => {
    expect(
      resolveDualReadSource({
        pipeline: "r2_sp",
        r2Status: "ready",
        r2Key: "hot/teams/o/attachments/c/m/a-x.pdf",
        providerItemId: "sp",
        variant: "full",
      }),
    ).toBe("r2");
    expect(
      resolveDualReadSource({
        pipeline: "r2_sp",
        r2Status: "deleted",
        r2Deleted: true,
        r2Key: "hot/teams/o/attachments/c/m/a-x.pdf",
        providerItemId: "sp",
        variant: "full",
      }),
    ).toBe("sharepoint");
    expect(
      resolveDualReadSource({
        pipeline: "legacy_supabase",
        r2Status: "none",
        r2Key: null,
        providerItemId: null,
        variant: "full",
      }),
    ).toBe("none");
  });

  it("one job per attachment; verified reconciles without reupload", () => {
    expect(
      shouldCreateSyncJob({
        existingJobs: [
          { kind: "attachment", refId: "a1", opId: "op", state: "pending" },
        ],
        kind: "attachment",
        refId: "a1",
        opId: "op",
      }),
    ).toBe(false);
    expect(
      shouldReconcileJobWithoutUpload({
        itemSpStatus: "verified",
        itemHasSpDriveItem: true,
        jobState: "pending",
      }),
    ).toBe(true);
    expect(jobStateAfterSuccessfulSync("running")).toBe("done");
  });

  it("cleanup requires verified + due; never deletes on permanent failure alone", () => {
    expect(
      shouldCleanupR2Object({
        spStatus: "verified",
        r2Status: "ready",
        r2DeletedAt: null,
        r2DeleteAfter: "2020-01-01T00:00:00.000Z",
        retentionHold: false,
        nowIso: "2026-07-23T00:00:00.000Z",
        objectKind: "attachment",
      }),
    ).toBe(true);
    expect(
      shouldCleanupR2Object({
        spStatus: "permanent_failure",
        r2Status: "ready",
        r2DeletedAt: null,
        r2DeleteAfter: "2020-01-01T00:00:00.000Z",
        retentionHold: true,
        nowIso: "2026-07-23T00:00:00.000Z",
        objectKind: "attachment",
      }),
    ).toBe(false);
  });
});
