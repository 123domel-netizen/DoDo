import { describe, expect, it } from "vitest";
import {
  EMPTY_OUTBOX,
  isEmptyOutbox,
  itemIdsMissingInCloud,
  normalizePersistedOutbox,
  outboxStorageKey,
} from "./syncOutbox";

describe("trwała kolejka wysyłki", () => {
  it("trzyma osobny klucz per konto — przełączenie użytkownika nie miesza kolejek", () => {
    expect(outboxStorageKey("u1")).not.toBe(outboxStorageKey("u2"));
    expect(outboxStorageKey(null)).toBe("dodo-sync-outbox-v1-local");
  });

  it("odtwarza zapisany stan", () => {
    expect(
      normalizePersistedOutbox({
        itemIds: ["a", "b"],
        participantIds: ["c"],
        tagAssignmentsDirty: true,
      }),
    ).toEqual({ itemIds: ["a", "b"], participantIds: ["c"], tagAssignmentsDirty: true });
  });

  it("deduplikuje identyfikatory", () => {
    expect(normalizePersistedOutbox({ itemIds: ["a", "a", "b"] }).itemIds).toEqual(["a", "b"]);
  });

  it("odrzuca śmieci z IndexedDB zamiast wywracać start aplikacji", () => {
    for (const bad of [null, undefined, 42, "x", [], { itemIds: "nope" }]) {
      expect(normalizePersistedOutbox(bad)).toEqual(EMPTY_OUTBOX);
    }
    expect(normalizePersistedOutbox({ itemIds: [1, null, "ok", ""] }).itemIds).toEqual(["ok"]);
    expect(normalizePersistedOutbox({ tagAssignmentsDirty: "yes" }).tagAssignmentsDirty).toBe(
      false,
    );
  });

  it("pusta kolejka jest rozpoznawana (kasujemy wpis zamiast trzymać śmieć)", () => {
    expect(isEmptyOutbox(EMPTY_OUTBOX)).toBe(true);
    expect(isEmptyOutbox({ ...EMPTY_OUTBOX, itemIds: ["a"] })).toBe(false);
    expect(isEmptyOutbox({ ...EMPTY_OUTBOX, participantIds: ["a"] })).toBe(false);
    expect(isEmptyOutbox({ ...EMPTY_OUTBOX, tagAssignmentsDirty: true })).toBe(false);
  });
});

describe("rekoncyliacja po pullu", () => {
  it("wykrywa wydarzenie, które istnieje tylko lokalnie (bug telefon → laptop)", () => {
    expect(
      itemIdsMissingInCloud({
        localItems: { synced: {}, ["tylko-na-telefonie"]: {} },
        remoteItemIds: ["synced"],
      }),
    ).toEqual(["tylko-na-telefonie"]);
  });

  it("nie zgłasza nic, gdy wszystko jest w chmurze", () => {
    expect(
      itemIdsMissingInCloud({
        localItems: { a: {}, b: {} },
        remoteItemIds: ["a", "b", "c"],
      }),
    ).toEqual([]);
  });

  it("pomija wpisy współdzielone — ich brak to cofnięte udostępnienie", () => {
    expect(
      itemIdsMissingInCloud({
        localItems: { mine: {}, theirs: { shareRole: "participant" } },
        remoteItemIds: [],
      }),
    ).toEqual(["mine"]);
  });

  it("obejmuje też tombstone'y, żeby usunięcie nie zginęło po restarcie", () => {
    expect(
      itemIdsMissingInCloud({
        localItems: { deleted: { shareRole: "owner" } },
        remoteItemIds: [],
      }),
    ).toEqual(["deleted"]);
  });
});
