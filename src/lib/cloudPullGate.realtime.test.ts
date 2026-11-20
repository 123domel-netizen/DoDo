import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REALTIME_CATCHUP_THRESHOLD_MS,
  decideCloudPull,
  getRealtimeNeedsCatchUp,
  getRealtimeLostAt,
  noteRealtimeDisconnect,
  noteRealtimeReconnect,
  resetCloudPullGateForTests,
  runCloudPull,
  setCloudPullWorkspace,
  setLastSuccessfulSnapshotAtForTests,
} from "@/lib/cloudPullGate";

describe("realtime catch-up (5 min threshold)", () => {
  beforeEach(() => {
    resetCloudPullGateForTests();
    setCloudPullWorkspace("user-rt");
    setLastSuccessfulSnapshotAtForTests(1_000_000);
  });

  afterEach(() => {
    resetCloudPullGateForTests();
  });

  it("records disconnect timestamp", () => {
    noteRealtimeDisconnect(2_000_000);
    expect(getRealtimeLostAt()).toBe(2_000_000);
    // drugi drop nie nadpisuje
    noteRealtimeDisconnect(2_000_100);
    expect(getRealtimeLostAt()).toBe(2_000_000);
  });

  it("10s reconnect does not arm needsCatchUp", () => {
    const t0 = 3_000_000;
    noteRealtimeDisconnect(t0);
    noteRealtimeReconnect(t0 + 10_000);
    expect(getRealtimeNeedsCatchUp()).toBe(false);
    expect(getRealtimeLostAt()).toBeNull();
    expect(decideCloudPull("auto-focus", t0 + 20_000).allowed).toBe(false);
  });

  it("4m59s reconnect does not arm needsCatchUp", () => {
    const t0 = 4_000_000;
    noteRealtimeDisconnect(t0);
    noteRealtimeReconnect(t0 + REALTIME_CATCHUP_THRESHOLD_MS - 1_000);
    expect(getRealtimeNeedsCatchUp()).toBe(false);
  });

  it("exactly 5 min arms needsCatchUp", () => {
    const t0 = 5_000_000;
    noteRealtimeDisconnect(t0);
    noteRealtimeReconnect(t0 + REALTIME_CATCHUP_THRESHOLD_MS);
    expect(getRealtimeNeedsCatchUp()).toBe(true);
  });

  it("30 min outage arms needsCatchUp and allows one focus catch-up", async () => {
    const t0 = 6_000_000;
    noteRealtimeDisconnect(t0);
    noteRealtimeReconnect(t0 + 30 * 60_000);
    expect(getRealtimeNeedsCatchUp()).toBe(true);

    const first = await runCloudPull("auto-focus", async () => "ok", {
      now: t0 + 30 * 60_000 + 1,
    });
    expect(first.ran).toBe(true);
    expect(getRealtimeNeedsCatchUp()).toBe(false);

    const second = await runCloudPull("auto-visibility", async () => "again", {
      now: t0 + 30 * 60_000 + 2,
    });
    expect(second).toEqual({ ran: false, reason: "snapshot-fresh" });
  });

  it("failed catch-up keeps needsCatchUp for retry", async () => {
    const t0 = 7_000_000;
    noteRealtimeDisconnect(t0);
    noteRealtimeReconnect(t0 + REALTIME_CATCHUP_THRESHOLD_MS);
    expect(getRealtimeNeedsCatchUp()).toBe(true);

    await expect(
      runCloudPull("auto-focus", async () => {
        throw new Error("snap fail");
      }, { now: t0 + REALTIME_CATCHUP_THRESHOLD_MS + 1 }),
    ).rejects.toThrow("snap fail");

    expect(getRealtimeNeedsCatchUp()).toBe(true);

    const retry = await runCloudPull("auto-visibility", async () => "recovered", {
      now: t0 + REALTIME_CATCHUP_THRESHOLD_MS + 2,
    });
    expect(retry.ran).toBe(true);
    expect(getRealtimeNeedsCatchUp()).toBe(false);
  });

  it("focus+visibility during catch-up: second is single-flight", async () => {
    const t0 = 8_000_000;
    noteRealtimeDisconnect(t0);
    noteRealtimeReconnect(t0 + REALTIME_CATCHUP_THRESHOLD_MS);

    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const first = runCloudPull("auto-focus", async () => {
      await blocker;
      return 1;
    }, { now: t0 + REALTIME_CATCHUP_THRESHOLD_MS + 1 });

    const second = await runCloudPull("auto-visibility", async () => 2, {
      now: t0 + REALTIME_CATCHUP_THRESHOLD_MS + 1,
    });
    expect(second).toEqual({ ran: false, reason: "single-flight" });
    release();
    await first;
  });

  it("realtime-reconnect source never runs snapshot", async () => {
    const r = await runCloudPull("realtime-reconnect", async () => true);
    expect(r).toEqual({ ran: false, reason: "realtime-reconnect-skipped" });
  });
});
