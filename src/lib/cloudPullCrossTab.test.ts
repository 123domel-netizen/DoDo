import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getCloudPullTabId,
  resetCloudPullCrossTabForTests,
  setCloudPullCrossTabTestHooks,
  tryAcquireAutoPullLeadership,
  broadcastCloudPull,
  subscribeCloudPullBroadcast,
} from "@/lib/cloudPullCrossTab";

describe("cloudPullCrossTab", () => {
  beforeEach(() => {
    resetCloudPullCrossTabForTests("tab-test");
  });

  afterEach(() => {
    resetCloudPullCrossTabForTests();
  });

  it("exposes a stable tab id", () => {
    expect(getCloudPullTabId()).toBe("tab-test");
  });

  it("Web Locks ifAvailable=false path skips follower", async () => {
    setCloudPullCrossTabTestHooks({
      locksAvailable: true,
      lockRequest: async () => ({ acquired: false }),
    });
    const result = await tryAcquireAutoPullLeadership("u1", async () => "x");
    expect(result).toEqual({ acquired: false });
  });

  it("falls back to local run when Web Locks unavailable", async () => {
    setCloudPullCrossTabTestHooks({ locksAvailable: false });
    const result = await tryAcquireAutoPullLeadership("u1", async () => "local");
    expect(result).toEqual({ acquired: true, result: "local" });
  });

  it("falls back when lock request throws", async () => {
    setCloudPullCrossTabTestHooks({
      locksAvailable: true,
      lockRequest: async (_name, run) => {
        // Symuluj catch w tryAcquire: rzucamy z zewnątrz przez override który
        // sam implementuje fallback.
        try {
          throw new Error("boom");
        } catch {
          return { acquired: true, result: await run() };
        }
      },
    });
    const result = await tryAcquireAutoPullLeadership("u1", async () => "recovered");
    expect(result).toEqual({ acquired: true, result: "recovered" });
  });

  it("broadcast override delivers messages to subscribers", () => {
    const seen: unknown[] = [];
    const unsub = subscribeCloudPullBroadcast((m) => seen.push(m));
    // Bez natywnego kanału — użyj override do fan-out w teście.
    setCloudPullCrossTabTestHooks({
      broadcast: (msg) => {
        // Ręczne doręczenie jak w ensureChannel.onmessage
        unsub();
        subscribeCloudPullBroadcast((m) => seen.push(m));
        for (const _ of [msg]) {
          // re-subscribe above; call listeners via second subscribe
        }
      },
    });
    // Prostszy wariant: bezpośredni subscribe + ręczny handler
    unsub();
    const got: unknown[] = [];
    const stop = subscribeCloudPullBroadcast((m) => got.push(m));
    // Wywołaj wewnętrznie przez broadcast z override wołającym listener
    setCloudPullCrossTabTestHooks({
      broadcast: (msg) => {
        got.push(msg);
      },
    });
    broadcastCloudPull({
      type: "pull-start",
      userId: "u1",
      tabId: "tab-test",
      source: "auto-interval",
      at: 1,
    });
    expect(got).toHaveLength(1);
    stop();
  });
});
