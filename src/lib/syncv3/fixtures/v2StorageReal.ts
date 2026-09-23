/**
 * Fixture odpowiadający rzeczywistemu dumpowi Zustand persist v2
 * (klucz: kalendarz-todo-v1-{userId}) + outbox dodo-sync-outbox-v1-{userId}.
 *
 * Prywatne wartości usunięte; struktura i kształty pól jak w produkcji.
 * Tytuł „Bachusz podpisy” — tylko nazwa fixture (nie kryterium local-only).
 */
export const V2_PERSIST_FIXTURE_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

export const V2_ITEM_BACHUSZ = "11111111-1111-4111-8111-111111111111";
export const V2_ITEM_LEGACY_NO_TYPE = "22222222-2222-4222-8222-222222222222";
export const V2_ITEM_TOMBSTONE = "33333333-3333-4333-8333-333333333333";
export const V2_ITEM_LOCAL_ONLY = "44444444-4444-4444-8444-444444444444";
export const V2_GROUP_ID = "55555555-5555-4555-8555-555555555555";
export const V2_TAG_ID = "66666666-6666-4666-8666-666666666666";

/** Surowy JSON string jak w idb-keyval pod kalendarz-todo-v1-{userId}. */
export function buildV2ZustandPersistRaw(userId: string): string {
  return JSON.stringify({
    state: {
      items: {
        [V2_ITEM_BACHUSZ]: {
          id: V2_ITEM_BACHUSZ,
          type: "event",
          title: "Bachusz podpisy",
          description: "Umowa — do podpisu",
          start: "2026-09-20T08:00:00.000Z",
          end: "2026-09-20T09:00:00.000Z",
          allDay: false,
          groupId: V2_GROUP_ID,
          showInCalendar: true,
          showInTodo: false,
          done: false,
          hasDueDate: true,
          checklist: [
            { id: "c1", text: "Wydruk", done: false, assigneeUserId: null },
          ],
          participants: [
            {
              id: "p1",
              email: "partner@example.com",
              name: "Partner",
              userId: null,
              status: "pending",
              role: "viewer",
            },
          ],
          attachments: [],
          reminders: [{ id: "r1", offsetMinutes: 30, firedAt: null }],
          deadlineAt: null,
          recurrence: {
            freq: "weekly",
            interval: 1,
            byweekday: ["MO"],
            until: null,
            count: null,
          },
          tagIds: [V2_TAG_ID],
          pinnedAt: null,
          preArchiveGroupId: null,
          groupPromptDismissed: false,
          shareRole: "owner",
          ownerUserId: userId,
          deletedAt: null,
          deletedBy: null,
          personalReminders: [
            { id: "pr1", at: "2026-09-20T07:30:00.000Z", firedAt: null },
          ],
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-20T07:00:00.000Z",
        },
        [V2_ITEM_LEGACY_NO_TYPE]: {
          id: V2_ITEM_LEGACY_NO_TYPE,
          // brak type — legacy prod shape
          title: "Stary wpis bez type",
          description: "",
          start: "2026-09-10T12:00:00.000Z",
          end: "2026-09-10T13:00:00.000Z",
          allDay: false,
          groupId: null,
          showInCalendar: true,
          showInTodo: false,
          done: false,
          hasDueDate: true,
          checklist: [],
          participants: [],
          attachments: [],
          reminders: [],
          deadlineAt: null,
          recurrence: null,
          tagIds: [],
          pinnedAt: null,
          preArchiveGroupId: null,
          groupPromptDismissed: true,
          shareRole: "owner",
          ownerUserId: userId,
          deletedAt: null,
          deletedBy: null,
          personalReminders: [],
          createdAt: "2026-08-01T10:00:00.000Z",
          updatedAt: "2026-09-10T11:00:00.000Z",
        },
        [V2_ITEM_TOMBSTONE]: {
          id: V2_ITEM_TOMBSTONE,
          type: "task",
          title: "Usunięte",
          description: "",
          start: "2026-09-01T09:00:00.000Z",
          end: "2026-09-01T09:00:00.000Z",
          allDay: true,
          groupId: null,
          showInCalendar: false,
          showInTodo: true,
          done: true,
          hasDueDate: true,
          checklist: [],
          participants: [],
          attachments: [],
          reminders: [],
          deadlineAt: null,
          recurrence: null,
          tagIds: [],
          pinnedAt: null,
          preArchiveGroupId: null,
          groupPromptDismissed: true,
          shareRole: "owner",
          ownerUserId: userId,
          deletedAt: "2026-09-15T12:00:00.000Z",
          deletedBy: userId,
          personalReminders: [],
          createdAt: "2026-09-01T08:00:00.000Z",
          updatedAt: "2026-09-15T12:00:00.000Z",
        },
        [V2_ITEM_LOCAL_ONLY]: {
          id: V2_ITEM_LOCAL_ONLY,
          type: "event",
          title: "Tylko telefon",
          description: "",
          start: "2026-09-22T16:00:00.000Z",
          end: "2026-09-22T17:00:00.000Z",
          allDay: false,
          groupId: null,
          showInCalendar: true,
          showInTodo: false,
          done: false,
          hasDueDate: true,
          checklist: [],
          participants: [],
          attachments: [],
          reminders: [],
          deadlineAt: null,
          recurrence: null,
          tagIds: [],
          pinnedAt: null,
          preArchiveGroupId: null,
          groupPromptDismissed: false,
          shareRole: "owner",
          ownerUserId: userId,
          deletedAt: null,
          deletedBy: null,
          personalReminders: [],
          createdAt: "2026-09-22T15:00:00.000Z",
          updatedAt: "2026-09-22T15:05:00.000Z",
        },
      },
      groups: [
        {
          id: V2_GROUP_ID,
          name: "Praca",
          color: "#3b82f6",
          icon: "briefcase",
          sortOrder: 0,
          showInSidebar: true,
          showInTasks: true,
          showInEvents: true,
          showInDashboard: true,
          showInAll: true,
        },
      ],
      tags: {
        [V2_TAG_ID]: {
          id: V2_TAG_ID,
          userId,
          name: "pilne",
          color: "#ef4444",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      },
      myTagIdsByItem: {
        [V2_ITEM_BACHUSZ]: [V2_TAG_ID],
      },
      settings: {
        theme: "system",
        weekStartsOn: 1,
        timeFormat: "24h",
      },
      activeGroupFilter: null,
    },
    version: 0,
  });
}

/** Kształt outboxu jak loadOutbox / dodo-sync-outbox-v1-{userId}. */
export function buildV2OutboxRaw() {
  return {
    itemIds: [V2_ITEM_LOCAL_ONLY, V2_ITEM_LEGACY_NO_TYPE],
    participantIds: [],
    tagAssignmentsDirty: true,
  };
}
