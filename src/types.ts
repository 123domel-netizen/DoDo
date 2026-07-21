export type ItemType = "event" | "task";

export type AttachmentKind = "link" | "file";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** Opcjonalna osoba odpowiedzialna (user_id). */
  assignedUserId?: string | null;
}

/** Tag użytkownika (prywatny słownik etykiet). */
export interface UserTag {
  id: string;
  userId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  id: string;
  name: string;
  email?: string;
  teamMemberId?: string;
  userId?: string | null;
  /** invited | accepted | rejected | active */
  status?: ParticipantStatus;
}

export type ParticipantStatus = "invited" | "accepted" | "rejected" | "active";

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  invited: "Zaproszony",
  accepted: "W realizacji",
  rejected: "Odrzucony",
  active: "W realizacji",
};

export interface TeamMember {
  id: string;
  ownerUserId: string;
  memberUserId: string | null;
  email: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Wyciszony w pickerze uczestników (kontakt z orga). */
  muted?: boolean;
}

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  /** URL for links, data URL (base64) for small local files. */
  url: string;
  title: string;
}

export interface Reminder {
  id: string;
  /** Minutes before start (relative). Ignored when remindAt is set. */
  offsetMinutes: number;
  /** Absolute fire time (ISO). When set, reminder fires at this time regardless of item due date. */
  remindAt?: string | null;
  /** ISO timestamp when this reminder was last fired locally (dedupe). */
  firedAt?: string | null;
}

export interface GoogleRecurrenceException {
  originalStart: string;
  status: "cancelled" | "modified";
  start?: string;
  end?: string;
  title?: string;
}

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

/** Lokalna reguła powtarzalności (nie Google). */
export interface ItemRecurrence {
  frequency: RecurrenceFrequency;
  interval: number;
  /** 0=niedziela … 6=sobota (Date.getDay()). */
  byWeekday?: number[];
  weekdaysOnly?: boolean;
  until?: string | null;
  count?: number | null;
}

export type RecurrencePresetId =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "weekdays"
  | "custom";

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  description: string;
  /** ISO datetime. */
  start: string;
  /** ISO datetime. */
  end: string;
  allDay: boolean;
  groupId: string | null;
  showInCalendar: boolean;
  showInTodo: boolean;
  /** For tasks: whether it is completed. */
  done: boolean;
  /** Poprzednia grupa przed przeniesieniem do archiwum (przywracana po odznaczeniu). */
  preArchiveGroupId?: string | null;
  /** false = brak terminu (typowe dla szybkich zadań). */
  hasDueDate: boolean;
  checklist: ChecklistItem[];
  participants: Participant[];
  attachments: Attachment[];
  reminders: Reminder[];
  /** Osobisty termin (ISO datetime), niezależny od start/end i przypomnień. */
  deadlineAt?: string | null;
  /** Gdy tryb integracji = ask_per_item — nadpisanie per element. */
  googleSyncOverride?: DualVisibilityMode | null;
  googleLinkGroupId?: string | null;
  /** RRULE/EXDATE z Google — jeden wpis na serię cykliczną. */
  googleRecurrence?: string[];
  googleRecurringSeriesId?: string;
  googleRecurrenceExceptions?: GoogleRecurrenceException[];
  googleCalendarEventId?: string;
  /** Lokalna powtarzalność (generowanie wystąpień w locie). */
  recurrence?: ItemRecurrence | null;
  /** "google" gdy element pochodzi z importu Google (tylko do odczytu). */
  syncSource?: "local" | "google";
  /** Właściciel rekordu w chmurze (user_id). */
  ownerUserId?: string;
  /** owner = mój wpis; participant = udostępniony (SHARE). */
  shareRole?: "owner" | "participant";
  /** Ukryte: prompt wyboru grupy zamknięty przez użytkownika. */
  groupPromptDismissed?: boolean;
  /** Tombstone — item usunięty (ukryty w UI, sync do deleted_at). */
  deletedAt?: string | null;
  deletedBy?: string | null;
  /** Osobiste przypomnienia uczestnika (SHARE). */
  personalReminders?: Reminder[];
  /** Id tagów właściciela (payload); uczestnik używa myTagIdsByItem w store. */
  tagIds?: string[];
  /** Przypięcie jak priorytet — ISO datetime; null/undefined = nieprzypięte. */
  pinnedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Grupa systemowa (archiwum / SHARE). */
  system?: "archive" | "google" | "share";
  /** @deprecated Użyj showInAll — odwrotność. */
  hideFromAll?: boolean;
  /** Widoczność grupy — domyślnie wszystkie true. */
  showInSidebar?: boolean;
  showInTasks?: boolean;
  showInEvents?: boolean;
  showInDashboard?: boolean;
  showInAll?: boolean;
}

export type CalendarViewKind = "day" | "week" | "eleven" | "month";

export type DualVisibilityMode =
  | "calendar_only"
  | "tasks_only"
  | "both_linked"
  | "ask_per_item";

export interface GoogleSyncSettings {
  calendarEnabled: boolean;
  tasksEnabled: boolean;
  calendarId: string;
  taskListId: string;
  dualVisibilityMode: DualVisibilityMode;
  syncCompletedTasks: boolean;
  importExistingOnConnect: boolean;
}

export interface GoogleConnectionStatus {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  settings: GoogleSyncSettings | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export type ThemePreference = "light" | "dark" | "system";

export interface Settings {
  /** First visible hour in the timed grid (0-23). */
  dayStartHour: number;
  /** Last visible hour in the timed grid (1-24). */
  dayEndHour: number;
  view: CalendarViewKind;
  /** ISO date (anchor for the current view). */
  anchorDate: string;
  /** Weekday (0=Sun..6=Sat) the 9-day view starts on. Default 5 (Friday). */
  nineDayStartWeekday: number;
  /** Pixels per hour in the timed grid (używane gdy hourHeightAuto=false). */
  hourHeight: number;
  /**
   * true = wysokość godziny dopasowana do panelu kalendarza (100% do hubu).
   * false = ręczna wartość hourHeight.
   */
  hourHeightAuto: boolean;
  /** UI color scheme preference. */
  theme: ThemePreference;
  /** Bump to run one-time settings migrations. */
  settingsVersion?: number;
}
