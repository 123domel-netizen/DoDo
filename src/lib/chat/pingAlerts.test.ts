import { afterEach, describe, expect, it } from "vitest";
import {
  enqueuePingFromRow,
  isPingForMe,
  PING_ALERT_MAX_AGE_MS,
  usePingAlerts,
  type ChatPingRow,
} from "./pingAlerts";

function row(partial: Partial<ChatPingRow> = {}): ChatPingRow {
  return {
    id: partial.id ?? "ping-1",
    conversation_id: partial.conversation_id ?? "c1",
    sender_user_id: partial.sender_user_id ?? "s1",
    target_user_id: partial.target_user_id ?? "me",
    created_at: partial.created_at ?? new Date().toISOString(),
  };
}

afterEach(() => {
  usePingAlerts.getState().clear();
});

describe("isPingForMe", () => {
  it("accepts fresh ping addressed to me", () => {
    expect(isPingForMe(row(), "me")).toBe(true);
  });

  it("rejects other target, missing me, or stale ping", () => {
    expect(isPingForMe(row({ target_user_id: "other" }), "me")).toBe(false);
    expect(isPingForMe(row(), null)).toBe(false);
    const stale = row({
      created_at: new Date(Date.now() - PING_ALERT_MAX_AGE_MS - 1000).toISOString(),
    });
    expect(isPingForMe(stale, "me")).toBe(false);
  });
});

describe("usePingAlerts queue", () => {
  it("dedupes by pingId and dismisses", () => {
    const store = usePingAlerts.getState();
    store.push({
      pingId: "a",
      conversationId: "c1",
      senderId: "s1",
      createdAt: new Date().toISOString(),
    });
    store.push({
      pingId: "a",
      conversationId: "c1",
      senderId: "s1",
      createdAt: new Date().toISOString(),
    });
    store.push({
      pingId: "b",
      conversationId: "c2",
      senderId: "s2",
      createdAt: new Date().toISOString(),
    });
    expect(usePingAlerts.getState().queue.map((q) => q.pingId)).toEqual(["a", "b"]);
    store.dismiss("a");
    expect(usePingAlerts.getState().queue.map((q) => q.pingId)).toEqual(["b"]);
  });

  it("enqueuePingFromRow only when for me", () => {
    enqueuePingFromRow(row({ id: "x", target_user_id: "other" }), "me");
    expect(usePingAlerts.getState().queue).toHaveLength(0);
    enqueuePingFromRow(row({ id: "y" }), "me");
    expect(usePingAlerts.getState().queue).toHaveLength(1);
  });
});
