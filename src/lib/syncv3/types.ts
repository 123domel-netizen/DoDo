import type { Item, ItemType } from "@/types";

export const SYNC_V3_ENGINE_VERSION = 3 as const;
export const SYNC_V3_MIGRATION_VERSION = 1 as const;

export type MigrationState =
  | "not_started"
  | "backing_up"
  | "migrating"
  | "verifying"
  | "awaiting_remote"
  | "cutover_ready"
  | "active"
  | "failed";

export type OperationStatus =
  | "pending"
  | "in_flight"
  | "acked"
  | "failed"
  | "quarantined";

export type OperationType = "upsert" | "delete";

export type EntityType = "item" | "group" | "user_tag" | "tag_assignment" | "participant";

/** Kanoniczny snapshot wysyłany do Supabase — bez undefined. */
export interface CanonicalItem {
  id: string;
  type: ItemType;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  groupId: string | null;
  showInCalendar: boolean;
  showInTodo: boolean;
  done: boolean;
  hasDueDate: boolean;
  checklist: Item["checklist"];
  participants: Item["participants"];
  attachments: Item["attachments"];
  reminders: Item["reminders"];
  deadlineAt: string | null;
  recurrence: Item["recurrence"];
  tagIds: string[];
  pinnedAt: string | null;
  preArchiveGroupId: string | null;
  groupPromptDismissed: boolean;
  shareRole: "owner" | "participant";
  ownerUserId: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  personalReminders: Item["personalReminders"];
  createdAt: string;
  updatedAt: string;
  localRevision: number;
}

export interface EntityRecord {
  entityId: string;
  entityType: EntityType;
  userId: string;
  snapshot: CanonicalItem;
  localRevision: number;
  updatedAt: string;
}

/**
 * Lokalny identyfikator kolejki — NIE jest backendowym kluczem idempotencji.
 * Idempotencja chmury: item.id + pełny snapshot + ochrona przed stale updated_at.
 */
export interface SyncOperation {
  operationId: string;
  userId: string;
  entityType: EntityType;
  entityId: string;
  operationType: OperationType;
  payload: CanonicalItem;
  localRevision: number;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  status: OperationStatus;
}

export interface SyncV3Meta {
  engineVersion: typeof SYNC_V3_ENGINE_VERSION;
  migrationVersion: number;
  migrationState: MigrationState;
  backupId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastMigrationError: string | null;
}

export interface SyncV3Backup {
  backupId: string;
  userId: string;
  createdAt: string;
  zustandPersistRaw: unknown;
  outboxRaw: unknown;
}

export const DEFAULT_META: SyncV3Meta = {
  engineVersion: SYNC_V3_ENGINE_VERSION,
  migrationVersion: 0,
  migrationState: "not_started",
  backupId: null,
  startedAt: null,
  completedAt: null,
  lastMigrationError: null,
};

export function dbNameForUser(userId: string): string {
  return `dodo-sync-v3-${userId}`;
}
