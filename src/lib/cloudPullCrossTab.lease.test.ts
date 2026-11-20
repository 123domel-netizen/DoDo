import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  broadcastCloudPull,
  getCloudPullTabId,
  releaseStorageLease,
  renewStorageLease,
  resetCloudPullCrossTabForTests,
  setCloudPullCrossTabTestHooks,
  subscribeCloudPullBroadcast,
  tryAcquireAutoPullLeadership,
  tryAcquireStorageLease,
} from "@/lib/cloudPullCrossTab";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe("localStorage lease fallback", () => {
  beforeEach(() => {
    resetCloudPullCrossTabForTests("tab-A");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: memoryStorage(),
      now: () => 1_000_000,
    });
  });

  afterEach(() => {
    resetCloudPullCrossTabForTests();
  });

  it("exactly one of two tabs acquires automatic pull", async () => {
    const store = memoryStorage();
    let aQueries = 0;
    let bQueries = 0;
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    resetCloudPullCrossTabForTests("tab-A");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => 2_000_000,
    });

    const a = tryAcquireAutoPullLeadership("user-1", async () => {
      aQueries += 1;
      await blocker;
      return "A";
    });

    // Druga karta — ten sam storage, inny tabId, A nadal trzyma lease
    resetCloudPullCrossTabForTests("tab-B");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => 2_000_000,
    });

    const b = await tryAcquireAutoPullLeadership("user-1", async () => {
      bQueries += 1;
      return "B";
    });

    expect(b).toEqual({ acquired: false });
    expect(bQueries).toBe(0);
    release();
    expect(await a).toEqual({ acquired: true, result: "A" });
    expect(aQueries).toBe(1);
  });

  it("dead lease can be taken over after expiry", () => {
    const store = memoryStorage();
    let t = 3_000_000;
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => t,
    });
    resetCloudPullCrossTabForTests("tab-A");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => t,
    });
    expect(tryAcquireStorageLease("cloud-snapshot", "u")).toBe(true);

    t = 3_000_000 + 91_000;
    resetCloudPullCrossTabForTests("tab-B");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => t,
    });
    expect(tryAcquireStorageLease("cloud-snapshot", "u")).toBe(true);
    expect(getCloudPullTabId()).toBe("tab-B");
  });

  it("release allows another tab to acquire", () => {
    const store = memoryStorage();
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => 4_000_000,
    });
    resetCloudPullCrossTabForTests("tab-A");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => 4_000_000,
    });
    expect(tryAcquireStorageLease("cloud-snapshot", "u")).toBe(true);
    releaseStorageLease("cloud-snapshot", "u");

    resetCloudPullCrossTabForTests("tab-B");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => 4_000_000,
    });
    expect(tryAcquireStorageLease("cloud-snapshot", "u")).toBe(true);
  });

  it("tryAcquireAutoPullLeadership releases lease after pull completes", async () => {
    const store = memoryStorage();
    resetCloudPullCrossTabForTests("tab-done");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => 9_000_000,
    });
    const r = await tryAcquireAutoPullLeadership("user-done", async () => "ok");
    expect(r).toEqual({ acquired: true, result: "ok" });
    expect(store.getItem("dodo-auto-pull-lease:cloud-snapshot:user-done")).toBeNull();
  });

  it("storage failure does not block leadership", async () => {
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: {
        getItem: () => {
          throw new Error("quota");
        },
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {
          throw new Error("quota");
        },
      },
    });
    const r = await tryAcquireAutoPullLeadership("u", async () => "ok");
    expect(r).toEqual({ acquired: true, result: "ok" });
  });

  it("renews lease during long pull so expiry does not drop ownership", async () => {
    const store = memoryStorage();
    let t = 5_000_000;
    resetCloudPullCrossTabForTests("tab-renew");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => t,
    });

    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const pull = tryAcquireAutoPullLeadership("user-renew", async () => {
      // Symuluj długi pull: zegar + ręczny renew (interval w JS fake timers nie jest
      // tu podpięty — weryfikujemy API renewStorageLease używane przez interval).
      t = 5_000_000 + 60_000;
      renewStorageLease("cloud-snapshot", "user-renew");
      const mid = store.getItem("dodo-auto-pull-lease:cloud-snapshot:user-renew");
      expect(mid).toBeTruthy();
      const parsed = JSON.parse(mid!) as { tabId: string; expiresAt: number };
      expect(parsed.tabId).toBe("tab-renew");
      expect(parsed.expiresAt).toBeGreaterThan(5_000_000 + 60_000);
      await blocker;
      return "done";
    });

    // Równolegle inna karta nie przejmuje w trakcie renew
    t = 5_000_000 + 61_000;
    resetCloudPullCrossTabForTests("tab-other");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => t,
    });
    expect(tryAcquireStorageLease("cloud-snapshot", "user-renew")).toBe(false);

    resetCloudPullCrossTabForTests("tab-renew");
    setCloudPullCrossTabTestHooks({
      locksAvailable: false,
      storage: store,
      now: () => t,
    });
    release();
    expect(await pull).toEqual({ acquired: true, result: "done" });
  });

  it("resetCloudPullCrossTabForTests cleans BroadcastChannel listeners and hooks", () => {
    const seen: unknown[] = [];
    subscribeCloudPullBroadcast((m) => seen.push(m));
    setCloudPullCrossTabTestHooks({
      broadcast: (msg) => seen.push(msg),
    });
    broadcastCloudPull({
      type: "pull-start",
      userId: "u",
      tabId: "x",
      source: "auto-interval",
      at: 1,
    });
    expect(seen.length).toBeGreaterThan(0);
    resetCloudPullCrossTabForTests();
    const after: unknown[] = [];
    setCloudPullCrossTabTestHooks({
      broadcast: (msg) => after.push(msg),
    });
    // Po resecie stary listener nie dostaje wiadomości z natywnego kanału;
    // override nadal działa dla nowego hooka.
    broadcastCloudPull({
      type: "pull-end",
      userId: "u",
      tabId: "y",
      source: "auto-interval",
      ok: true,
      at: 2,
    });
    expect(after).toHaveLength(1);
  });
});
