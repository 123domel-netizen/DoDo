export type ItemType = "event" | "task";

export type AttachmentKind = "link" | "file";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Participant {
  id: string;
  name: string;
  email?: string;
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
  /** Minutes before start. */
  offsetMinutes: number;
  /** ISO timestamp when this reminder was last fired locally (dedupe). */
  firedAt?: string | null;
}

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
  /** Gdy tryb integracji = ask_per_item — nadpisanie per element. */
  googleSyncOverride?: DualVisibilityMode | null;
  googleLinkGroupId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Grupa systemowa (np. archiwum ukończonych zadań). */
  system?: "archive";
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
  /** Pixels per hour in the timed grid. */
  hourHeight: number;
  /** Bump to run one-time settings migrations. */
  settingsVersion?: number;
}
