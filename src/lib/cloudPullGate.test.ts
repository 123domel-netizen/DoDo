import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setCloudPullCrossTabTestHooks } from "@/lib/cloudPullCrossTab";
import {
  AUTO_PULL_COOLDOWN_MS,
  awaitCloudPullIdle,
  decideCloudPull,
  getCloudPullGateDiagnostics,
  getCloudPullWorkspace,
  getLastCloudPullTelemetry,
  getLastSuccessfulSnapshotAt,
  noteRealtimeDisconnect,
  noteRealtimeReconnect,
  measureJsonBytes,
  recordCloudPullTableCount,
  recordCloudPullTableData,
  resetCloudPullGateForTests,
  runCloudPull,
  setCloudPullWorkspace,
  setLastSuccessfulSnapshotAtForTests,
} from "@/lib/cloudPullGate";

describe("cloudPullGate", () => {
  beforeEach(() => {
    resetCloudPullGateForTests();
    setCloudPullWorkspace("user-a");
  });

  afterEach(() => {
    resetCloudPullGateForTests();
  });

  it("blocks parallel pulls with single-flight", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = runCloudPull("manual", async () => {
      await blocker;
      return "a";
    });

    const second = await runCloudPull("auto-interval", async () => "b");
    expect(second).toEqual({ ran: false, reason: "single-flight" });
    expect(getLastCloudPullTelemetry()?.skipped).toBe("single-flight");

    release();
    await first;
    expect(getCloudPullGateDiagnostics().inFlightSource).toBeNull();
  });

  it("applies 60-minute cooldown from last successful snapshot", async () => {
    const t0 = 1_000_000;
    const first = await runCloudPull("auto-interval", async () => true, { now: t0 });
    expect(first.ran).toBe(true);
    expect(getLastSuccessfulSnapshotAt()).toBeGreaterThanOrEqual(t0);

    const tooSoon = await runCloudPull("auto-interval", async () => true, {
      now: t0 + AUTO_PULL_COOLDOWN_MS - 1,
    });
    expect(tooSoon).toEqual({ ran: false, reason: "cooldown" });

    const after = await runCloudPull("auto-interval", async () => true, {
      now: t0 + AUTO_PULL_COOLDOWN_MS + 1_000,
    });
    expect(after.ran).toBe(true);
  });

  it("focus does not pull when snapshot is fresher than 60 minutes", async () => {
    const t0 = 2_000_000;
    await runCloudPull("auto-interval", async () => true, { now: t0 });
    const focus = await runCloudPull("auto-focus", async () => true, {
      now: t0 + 10 * 60_000,
    });
    expect(focus).toEqual({ ran: false, reason: "snapshot-fresh" });
  });

  it("focus pulls when realtime needs catch-up even if snapshot is fresh", async () => {
    const t0 = 3_000_000;
    await runCloudPull("auto-interval", async () => true, { now: t0 });
    // Długa przerwa Realtime (≥5 min) → needsCatchUp
    noteRealtimeDisconnect(t0 + 1);
    noteRealtimeReconnect(t0 + 1 + 5 * 60_000);
    const focus = await runCloudPull("auto-focus", async () => true, {
      now: t0 + 1 + 5 * 60_000 + 1,
    });
    expect(focus.ran).toBe(true);
  });

  it("realtime-reconnect never runs a full snapshot", async () => {
    const outcome = await runCloudPull("realtime-reconnect", async () => true);
    expect(outcome).toEqual({
      ran: false,
      reason: "realtime-reconnect-skipped",
    });
  });

  it("manual refresh bypasses cooldown but not single-flight", async () => {
    const t0 = 4_000_000;
    await runCloudPull("auto-interval", async () => true, { now: t0 });

    const manual = await runCloudPull("manual", async () => "ok", {
      now: t0 + 1_000,
    });
    expect(manual).toEqual({ ran: true, result: "ok" });

    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const inFlight = runCloudPull("manual", async () => {
      await blocker;
      return 1;
    });
    const blocked = await runCloudPull("manual", async () => 2);
    expect(blocked).toEqual({ ran: false, reason: "single-flight" });
    release();
    await inFlight;
  });

  it("auth and boot bypass cooldown (first pull / workspace entry)", async () => {
    const t0 = 5_000_000;
    setLastSuccessfulSnapshotAtForTests(t0);
    const auth = await runCloudPull("auth", async () => "auth", { now: t0 + 1 });
    expect(auth).toEqual({ ran: true, result: "auth" });
    const boot = await runCloudPull("boot", async () => "boot", { now: t0 + 2 });
    expect(boot).toEqual({ ran: true, result: "boot" });
  });

  it("workspace change resets cooldown and does not keep prior snapshot age", () => {
    setLastSuccessfulSnapshotAtForTests(Date.now());
    setCloudPullWorkspace("user-b");
    expect(getCloudPullWorkspace()).toBe("user-b");
    expect(getLastSuccessfulSnapshotAt()).toBe(0);
    expect(decideCloudPull("auto-interval").allowed).toBe(true);
  });

  it("only one of two tabs runs automatic pull (Web Locks)", async () => {
    let leaderRuns = 0;
    setCloudPullCrossTabTestHooks({
      locksAvailable: true,
      lockRequest: async (_name, run) => {
        // Pierwsza karta dostaje lock, druga — nie (symulacja równoległa sekwencyjna).
        if (leaderRuns === 0) {
          leaderRuns += 1;
          return { acquired: true, result: await run() };
        }
        return { acquired: false };
      },
    });

    const a = await runCloudPull("auto-interval", async () => "leader");
    expect(a).toEqual({ ran: true, result: "leader" });
    expect(getLastCloudPullTelemetry()?.wasLeader).toBe(true);

    // Po sukcesie cooldown — ustaw świeży timestamp w przeszłości dla drugiego testu.
    resetCloudPullGateForTests();
    setCloudPullWorkspace("user-a");
    setCloudPullCrossTabTestHooks({
      locksAvailable: true,
      lockRequest: async () => ({ acquired: false }),
    });
    const b = await runCloudPull("auto-interval", async () => "follower");
    expect(b).toEqual({ ran: false, reason: "cross-tab" });
    expect(getLastCloudPullTelemetry()?.skipped).toBe("cross-tab");
    expect(getLastCloudPullTelemetry()?.wasLeader).toBe(false);
  });

  it("BroadcastChannel / Web Locks failure does not block sync", async () => {
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      broadcast: () => {
        throw new Error("broadcast broken");
      },
    });
    const outcome = await runCloudPull("auto-interval", async () => "ok");
    expect(outcome).toEqual({ ran: true, result: "ok" });
  });

  it("manual refresh works despite cross-tab lock/broadcast/storage failures", async () => {
    setCloudPullCrossTabTestHooks({
      locksAvailable: true,
      lockRequest: async () => ({ acquired: false }),
      broadcast: () => {
        throw new Error("broadcast broken");
      },
    });
    // Manual omija leadership — mimo że locks „zajęte”.
    const manual = await runCloudPull("manual", async () => "manual-ok");
    expect(manual).toEqual({ ran: true, result: "manual-ok" });
  });

  it("measureJsonBytes uses Blob size when Blob is available", () => {
    const sample = [{ id: 1, title: "x" }];
    const viaBlob = new Blob([JSON.stringify(sample)]).size;
    expect(measureJsonBytes(sample)).toBe(viaBlob);
  });

  it("records per-table counts and Blob sizes into telemetry", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    await runCloudPull("manual", async () => {
      recordCloudPullTableData("items", rows);
      recordCloudPullTableCount("groups", 3, 300);
      return true;
    });
    const tel = getLastCloudPullTelemetry();
    expect(tel?.tableCounts.items).toBe(2);
    expect(tel?.tableBytes.items).toBe(measureJsonBytes(rows));
    expect(tel?.tableCounts.groups).toBe(3);
    expect(tel?.totalBytes).toBe((tel?.tableBytes.items ?? 0) + 300);
    expect(tel?.tabId).toBeTruthy();
    expect(tel?.ok).toBe(true);
  });

  it("awaitCloudPullIdle waits for in-flight pull", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const pending = runCloudPull("manual", async () => {
      await blocker;
      return true;
    });
    const idle = awaitCloudPullIdle();
    release();
    await Promise.all([pending, idle]);
    expect(getCloudPullGateDiagnostics().inFlightSource).toBeNull();
  });

  it("exports 60-minute cooldown constant", () => {
    expect(AUTO_PULL_COOLDOWN_MS).toBe(60 * 60_000);
  });
});
