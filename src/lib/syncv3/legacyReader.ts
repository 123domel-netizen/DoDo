/**
 * Read-only legacy Sync v2 storage reader — ONLY for Sync v3 migration.
 *
 * Must NOT: enqueue, push, dirty-track, register listeners, mutate Zustand,
 * write/clear legacy storage, or be imported by the Sync v3 worker.
 */
import { get as idbGet } from "idb-keyval";
import type { Group, Item, UserTag } from "@/types";

export const LEGACY_PERSIST_KEY_PREFIX = "kalendarz-todo-v1";
export const LEGACY_OUTBOX_KEY_PREFIX = "dodo-sync-outbox-v1";

export function legacyPersistKey(userId: string): string {
  return `${LEGACY_PERSIST_KEY_PREFIX}-${userId}`;
}

export function legacyOutboxKey(userId: string): string {
  return `${LEGACY_OUTBOX_KEY_PREFIX}-${userId}`;
}

export interface LegacyOutboxRaw {
  itemIds: string[];
  participantIds: string[];
  tagAssignmentsDirty: boolean;
}

export interface LegacyV2Snapshot {
  items: Record<string, Item>;
  groups: Group[];
  tags: Record<string, UserTag>;
  myTagIdsByItem: Record<string, string[]>;
  dirtyItemIds: string[];
  dirtyParticipantIds: string[];
  outboxItemIds: string[];
  outboxParticipantIds: string[];
  tagAssignmentsDirty: boolean;
  zustandPersistRaw: unknown;
  outboxRaw: LegacyOutboxRaw;
}

const EMPTY_OUTBOX: LegacyOutboxRaw = {
  itemIds: [],
  participantIds: [],
  tagAssignmentsDirty: false,
};

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const v of value) {
    if (typeof v === "string" && v) out.add(v);
  }
  return [...out];
}

function normalizeOutbox(raw: unknown): LegacyOutboxRaw {
  if (!raw || typeof raw !== "object") return { ...EMPTY_OUTBOX };
  const o = raw as Record<string, unknown>;
  return {
    itemIds: uniqueStrings(o.itemIds),
    participantIds: uniqueStrings(o.participantIds),
    tagAssignmentsDirty: o.tagAssignmentsDirty === true,
  };
}

function parsePersistRaw(raw: unknown): {
  items: Record<string, Item>;
  groups: Group[];
  tags: Record<string, UserTag>;
  myTagIdsByItem: Record<string, string[]>;
} {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { items: {}, groups: [], tags: {}, myTagIdsByItem: {} };
    }
  }
  const state = (parsed as { state?: Record<string, unknown> } | null)?.state ?? {};
  return {
    items: (state.items as Record<string, Item>) ?? {},
    groups: (state.groups as Group[]) ?? [],
    tags: (state.tags as Record<string, UserTag>) ?? {},
    myTagIdsByItem: (state.myTagIdsByItem as Record<string, string[]>) ?? {},
  };
}

/** Read-only dump of v2 persist + outbox. Never writes. */
export async function readLegacyV2Snapshot(userId: string): Promise<LegacyV2Snapshot> {
  const raw = await idbGet(legacyPersistKey(userId));
  const parsed = parsePersistRaw(raw);
  let outbox: LegacyOutboxRaw = EMPTY_OUTBOX;
  try {
    outbox = normalizeOutbox(await idbGet(legacyOutboxKey(userId)));
  } catch {
    outbox = EMPTY_OUTBOX;
  }
  return {
    items: parsed.items,
    groups: parsed.groups,
    tags: parsed.tags,
    myTagIdsByItem: parsed.myTagIdsByItem,
    dirtyItemIds: [...outbox.itemIds],
    dirtyParticipantIds: [...outbox.participantIds],
    outboxItemIds: [...outbox.itemIds],
    outboxParticipantIds: [...outbox.participantIds],
    tagAssignmentsDirty: outbox.tagAssignmentsDirty,
    zustandPersistRaw: raw ?? null,
    outboxRaw: outbox,
  };
}
