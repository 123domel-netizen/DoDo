import { beforeEach, describe, expect, it } from "vitest";
import {
  GROUPS_SELECT,
  ITEMS_SELECT,
  SHARED_ITEMS_EMBED_SELECT,
} from "@/lib/cloudSelects";
import {
  AUTO_PULL_COOLDOWN_MS,
  resetCloudPullGateForTests,
  runCloudPull,
  setCloudPullWorkspace,
  setLastSuccessfulSnapshotAtForTests,
} from "@/lib/cloudPullGate";

type Call = {
  table: string;
  select?: string;
  eq?: Array<[string, string]>;
  neq?: Array<[string, string]>;
  order?: string;
};

function createQueryTracker() {
  const calls: Call[] = [];

  function from(table: string) {
    const call: Call = { table, eq: [], neq: [] };
    calls.push(call);
    const api = {
      select(cols: string) {
        call.select = cols;
        return api;
      },
      eq(col: string, val: string) {
        call.eq!.push([col, val]);
        return api;
      },
      neq(col: string, val: string) {
        call.neq!.push([col, val]);
        return api;
      },
      order(col: string) {
        call.order = col;
        return api;
      },
      or() {
        return api;
      },
      range(_from?: number, _to?: number) {
        void _from;
        void _to;
        return Promise.resolve({ data: [] as unknown[], error: null });
      },
      then(
        resolve: (v: { data: unknown[]; error: null }) => void,
        reject?: (e: unknown) => void,
      ) {
        void reject;
        resolve({ data: [], error: null });
        return Promise.resolve({ data: [] as unknown[], error: null });
      },
    };
    return api;
  }

  return { calls, from };
}

describe("cloud snapshot query contract", () => {
  beforeEach(() => {
    resetCloudPullGateForTests();
    setCloudPullWorkspace("user-aaa");
  });

  it("items page query uses explicit columns + user_id + order", async () => {
    const tracker = createQueryTracker();
    const userId = "user-aaa";
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data } = await tracker
        .from("items")
        .select(ITEMS_SELECT)
        .eq("user_id", userId)
        .order("id")
        .range(from, to);
      void to;
      if ((data?.length ?? 0) < pageSize) break;
    }
    expect(tracker.calls[0]).toMatchObject({
      table: "items",
      select: ITEMS_SELECT,
      order: "id",
    });
    expect(tracker.calls[0]!.eq).toEqual([["user_id", userId]]);
    expect(tracker.calls[0]!.select?.includes("*")).toBe(false);
  });

  it("groups query uses explicit columns + user_id", async () => {
    const tracker = createQueryTracker();
    await tracker.from("groups").select(GROUPS_SELECT).eq("user_id", "user-bbb");
    expect(GROUPS_SELECT.includes("*")).toBe(false);
  });

  it("shared items embed never uses items(*) and filters out own owner", async () => {
    expect(SHARED_ITEMS_EMBED_SELECT.includes("items(*)")).toBe(false);
    expect(SHARED_ITEMS_EMBED_SELECT).toContain(`items(${ITEMS_SELECT})`);

    const tracker = createQueryTracker();
    const userId = "user-aaa";
    await tracker
      .from("item_participants")
      .select(SHARED_ITEMS_EMBED_SELECT)
      .neq("status", "rejected")
      .neq("owner_user_id", userId)
      .eq("participant_user_id", userId);

    expect(tracker.calls[0]!.neq).toEqual(
      expect.arrayContaining([
        ["status", "rejected"],
        ["owner_user_id", userId],
      ]),
    );
  });

  it("manual pull works during auto cooldown", async () => {
    const t0 = 9_000_000;
    await runCloudPull("auto-interval", async () => "auto", { now: t0 });
    const manual = await runCloudPull("manual", async () => "manual", {
      now: t0 + 60_000,
    });
    expect(manual).toEqual({ ran: true, result: "manual" });
    const auto = await runCloudPull("auto-focus", async () => "nope", {
      now: t0 + 60_000,
    });
    expect(auto).toEqual({ ran: false, reason: "snapshot-fresh" });
    expect(AUTO_PULL_COOLDOWN_MS).toBe(60 * 60_000);
  });

  it("workspace switch allows fresh auto pull without prior snapshot age", async () => {
    setLastSuccessfulSnapshotAtForTests(Date.now());
    setCloudPullWorkspace("user-b");
    const next = await runCloudPull("auth", async () => ({ user: "B" }));
    expect(next).toEqual({ ran: true, result: { user: "B" } });
  });
});
