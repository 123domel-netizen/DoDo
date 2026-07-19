import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useStore } from "@/state/store";
import type { Attachment, ChecklistItem, Item, Participant, ParticipantStatus, Reminder, TeamMember } from "@/types";
import { uid, defaultTaskDueRange, calendarBlockFromDeadline, itemDurationMinutes } from "@/lib/factory";
import { parseChecklistPaste, shouldParseChecklistPaste } from "@/lib/checklistPaste";
import { participantFromTeamMember, PARTICIPANT_STATUS_LABELS } from "@/lib/participants";
import { fmt } from "@/lib/format";
import {
  isShareGroup,
  isSharedItem,
  updateSharedItemContent,
  updateOwnParticipationReminders,
} from "@/lib/share";
import { isItemDeleted, itemSupportsTodoDone } from "@/lib/items";
import { rejectItemParticipation, teamMemberLabel, updateOwnParticipationStatus } from "@/lib/team";
import { ATTACHMENT_TOO_LARGE_MESSAGE, isAttachmentTooLarge } from "@/lib/attachments";
import { effectiveReminders, reminderDisplayLabel } from "@/lib/reminders";
import {
  DEADLINE_PRESET_DAYS,
  deadlineAtNoonFromItem,
} from "@/lib/deadlines";
import {
  checklistAssigneeLabel,
  checklistAssigneesForItem,
  type ChecklistAssignee,
} from "@/lib/checklistAssignees";
import { ItemTagsEditor } from "@/components/item/ItemTagsEditor";
import { RecurrenceEditor } from "@/components/item/RecurrenceEditor";
import { recurrenceSummary } from "@/lib/recurrenceRules";
import { effectiveTagIds } from "@/lib/tags";
import { TimeEditor } from "@/components/item/TimeEditor";
import { useIsMobile } from "@/hooks/useMediaQuery";
import {
  Repeat,
  AlarmClock,
  ArrowLeft,
  CalendarClock,
  CheckSquare,
  ChevronDown,
  Link as LinkIcon,
  Paperclip,
  Plus,
  Trash2,
  Users,
  Bell,
  X,
  AlignLeft,
  Check,
  ClipboardPaste,
  MessageSquare,
  Tag,
  Tags,
} from "lucide-react";
import { cloudEnabled } from "@/lib/supabase";

// Czat ładowany leniwie — edytor nie płaci za moduł dyskusji, dopóki nietknięty.
const ItemDiscussion = lazy(() =>
  import("@/components/chat/ItemDiscussion").then((m) => ({
    default: m.ItemDiscussion,
  })),
);

const REMINDER_MENU_PRESETS: { label: string; minutes: number }[] = [
  { label: "5 minut przed", minutes: 5 },
  { label: "10 minut przed", minutes: 10 },
  { label: "15 minut przed", minutes: 15 },
  { label: "30 minut przed", minutes: 30 },
  { label: "1 godz. przed", minutes: 60 },
  { label: "1 dzień przed", minutes: 1440 },
];

export function ItemEditorPanel() {
  const editingId = useStore((s) => s.editingId);
  const draft = useStore((s) => s.draft);
  const items = useStore((s) => s.items);
  const groups = useStore((s) => s.groups);
  const teamMembers = useStore((s) => s.teamMembers);
  const authUserId = useStore((s) => s.authUserId);
  const authUserEmail = useStore((s) => s.authUserEmail);
  const patchItem = useStore((s) => s.patchItem);
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const patchDraft = useStore((s) => s.patchDraft);
  const deleteItem = useStore((s) => s.deleteItem);
  const removeSharedItem = useStore((s) => s.removeSharedItem);
  const setItemTagIds = useStore((s) => s.setItemTagIds);
  const myTagIdsByItem = useStore((s) => s.myTagIdsByItem);
  const discardDraft = useStore((s) => s.discardDraft);
  const commitDraft = useStore((s) => s.commitDraft);
  const closeEditor = useStore((s) => s.closeEditor);
  const setEditing = useStore((s) => s.setEditing);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isMobile = useIsMobile();

  const isDraft = !!draft && editingId === draft.id;
  const item = isDraft ? draft : editingId ? items[editingId] : undefined;

  useEffect(() => {
    if (!isDraft && item && isItemDeleted(item)) closeEditor();
  }, [item, isDraft, closeEditor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") (e.target as HTMLElement).blur();
        closeEditor();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeEditor]);

  if (!item) return null;
  if (!isDraft && isItemDeleted(item)) return null;
  const it = item;
  const shareMode = isSharedItem(it);
  const group = !shareMode && it.groupId ? groups.find((g) => g.id === it.groupId) : undefined;
  const displayReminders = effectiveReminders(it);
  const checklistAssignees = useMemo(
    () => checklistAssigneesForItem(it, authUserId, authUserEmail),
    [it, authUserId, authUserEmail],
  );
  const itemTagIds = effectiveTagIds(it, myTagIdsByItem);

  const handleTagIds = (tagIds: string[]) => {
    setItemTagIds(it.id, tagIds);
    if (isDraft) patchDraft({ tagIds });
  };

  const update = (patch: Partial<Item>) => {
    if (shareMode) {
      const allowed: Partial<Item> = {};
      if (patch.description !== undefined) allowed.description = patch.description;
      if (patch.checklist !== undefined) allowed.checklist = patch.checklist;
      if (patch.attachments !== undefined) allowed.attachments = patch.attachments;
      if (Object.keys(allowed).length === 0) return;
      patchItem(it.id, allowed);
      void updateSharedItemContent(it.id, {
        description: allowed.description,
        checklist: allowed.checklist,
        attachments: allowed.attachments,
      });
      return;
    }
    isDraft ? patchDraft(patch) : patchItem(it.id, patch);
  };

  const updateReminders = (reminders: Reminder[]) => {
    if (shareMode) {
      patchItem(it.id, { personalReminders: reminders });
      void updateOwnParticipationReminders(it.id, reminders);
      return;
    }
    update({ reminders });
  };
  const canAdd = it.title.trim().length > 0;

  const isOpen = (k: string, hasContent: boolean) => open[k] ?? hasContent;
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !(o[k] ?? false) }));

  const showDueDate = it.hasDueDate;
  const durationMin = showDueDate ? itemDurationMinutes(it.start, it.end) : 0;
  const isPointInTime = showDueDate && !it.allDay && durationMin === 0;

  const setDueDate = () => {
    const { start: s, end: e } = defaultTaskDueRange();
    update({ hasDueDate: true, start: s, end: e, allDay: false });
  };

  const clearDueDate = () => {
    if (it.type !== "task") return;
    const kept = displayReminders.filter((r) => r.remindAt);
    update({ hasDueDate: false, reminders: kept });
  };

  const convertToEvent = () => {
    if (!it.hasDueDate) {
      const { end: e } = defaultTaskDueRange();
      update({
        type: "event",
        showInCalendar: true,
        hasDueDate: true,
        ...calendarBlockFromDeadline(e, 60),
      });
    } else if (isPointInTime) {
      update({
        type: "event",
        showInCalendar: true,
        hasDueDate: true,
        ...calendarBlockFromDeadline(it.end, 60),
      });
    } else {
      update({ type: "event", showInCalendar: true, hasDueDate: true });
    }
  };

  const convertToTask = () => {
    if (it.hasDueDate) {
      if (it.allDay) {
        const e = new Date(it.start);
        e.setHours(12, 0, 0, 0);
        update({
          type: "task",
          showInTodo: true,
          showInCalendar: false,
          allDay: false,
          start: e.toISOString(),
          end: e.toISOString(),
          hasDueDate: true,
        });
      } else {
        update({
          type: "task",
          showInTodo: true,
          showInCalendar: false,
          allDay: false,
          start: it.end,
          end: it.end,
          hasDueDate: true,
        });
      }
    } else {
      update({ type: "task", showInTodo: true, hasDueDate: false });
    }
  };

  const handleShowInCalendar = (v: boolean) => {
    if (it.type !== "task") {
      update({ showInCalendar: v });
      return;
    }
    if (v) {
      if (!it.hasDueDate) {
        const { end: deadline } = defaultTaskDueRange();
        update({
          showInCalendar: true,
          hasDueDate: true,
          ...calendarBlockFromDeadline(deadline, 60),
        });
        return;
      }
      if (durationMin < 60) {
        update({
          showInCalendar: true,
          ...calendarBlockFromDeadline(it.end, 60),
        });
        return;
      }
      update({ showInCalendar: true });
    } else if (it.hasDueDate) {
      update({
        showInCalendar: false,
        start: it.end,
        end: it.end,
      });
    } else {
      update({ showInCalendar: false });
    }
  };

  return (
    <div className="relative flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {shareMode ? (
          <span className="rounded-md bg-surface-raised px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            SHARE · Udostępnione Tobie
          </span>
        ) : (
          <button
            onClick={() => (it.type === "task" ? convertToEvent() : convertToTask())}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-light transition hover:bg-surface-raised hover:text-ink"
            title="Przełącz typ"
          >
            {it.type === "task" ? <CheckSquare size={13} /> : <CalendarClock size={13} />}
            {it.type === "task" ? "Zadanie" : "Wydarzenie"}
            <ChevronDown size={13} className="text-ink-faint" />
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {!shareMode && (
            <>
              {itemSupportsTodoDone(it) && !isDraft && (
                <button
                  onClick={() =>
                    isDraft ? update({ done: !it.done }) : toggleTaskDone(it.id)
                  }
                  className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    it.done
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "text-ink-light hover:bg-surface-raised hover:text-ink"
                  }`}
                >
                  <Check size={18} /> {it.done ? "Zrobione" : "Oznacz"}
                </button>
              )}
              <button
                onClick={() => {
                  if (isDraft) discardDraft();
                  else {
                    deleteItem(it.id);
                    setEditing(null);
                  }
                }}
                className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-faint transition hover:bg-red-500/10 hover:text-red-400"
                title={isDraft ? "Odrzuć" : "Usuń"}
              >
                <Trash2 size={18} /> {isDraft ? "Odrzuć" : "Usuń"}
              </button>
            </>
          )}
          <button
            onClick={closeEditor}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-raised hover:text-ink"
            title="Zamknij (Esc)"
            aria-label="Zamknij"
          >
            <X size={22} />
          </button>
        </div>
      </div>

      <div
        className={`flex-1 overflow-y-auto overflow-x-hidden thin-scrollbar px-5 ${
          isMobile ? "pb-28" : "pb-20"
        }`}
      >
        <SectionHeader>Podstawowe</SectionHeader>

        <input
          value={it.title}
          readOnly={shareMode}
          onChange={(e) => update({ title: e.target.value })}
          onKeyDown={(e) => {
            if (isDraft && e.key === "Enter") {
              e.preventDefault();
              if (canAdd) commitDraft();
            }
          }}
          placeholder="Bez tytułu"
          autoFocus={!shareMode && !isMobile}
          className={`mb-3 w-full border-0 bg-transparent text-2xl font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-faint ${
            shareMode ? "cursor-default opacity-90" : ""
          }`}
        />

        {/* Time */}
        <div className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-2">
          <Icon>
            <CalendarClock size={16} />
          </Icon>
          <div className="min-w-0 flex-1">
            {shareMode ? (
              <div className="text-sm text-ink-light">
                {showDueDate ? (
                  it.allDay ? (
                    fmt(it.start, "d MMMM yyyy")
                  ) : (
                    `${fmt(it.start, "d MMM HH:mm")} – ${fmt(it.end, "HH:mm")}`
                  )
                ) : (
                  <span className="text-ink-faint">Bez terminu</span>
                )}
              </div>
            ) : !showDueDate ? (
              <button
                type="button"
                onClick={setDueDate}
                className="rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
              >
                Ustaw termin
              </button>
            ) : (
              <TimeEditor
                start={it.start}
                end={it.end}
                allDay={it.allDay}
                allowClear={it.type === "task"}
                allowZeroDuration={it.type === "event" || !it.showInCalendar}
                minDurationMinutes={it.type === "task" && it.showInCalendar ? 60 : 0}
                onChange={(patch) => update({ ...patch, hasDueDate: true })}
                onClear={clearDueDate}
              />
            )}
          </div>
        </div>

        {/* Recurrence */}
        {showDueDate ? (
          <OptionalRow
            icon={<Repeat size={15} />}
            label="Powtarzaj"
            hasContent={Boolean(it.recurrence)}
            openKey="recurrence"
            open={open}
            setOpen={setOpen}
            summary={
              it.recurrence ? recurrenceSummary(it.recurrence, it) : undefined
            }
          >
            <RecurrenceEditor
              item={it}
              readOnly={shareMode || it.syncSource === "google"}
              onChange={(recurrence) => update({ recurrence })}
            />
          </OptionalRow>
        ) : (
          <div className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 opacity-60">
            <Icon>
              <Repeat size={15} />
            </Icon>
            <span className="text-sm text-ink-faint">Powtarzaj</span>
            <span className="ml-auto text-xs text-ink-faint">Ustaw termin</span>
          </div>
        )}

        <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:gap-3">
          <CompactReminderField
            reminders={displayReminders}
            onChange={updateReminders}
            hasDueDate={showDueDate}
          />
          <CompactDeadlineField
            deadlineAt={it.deadlineAt}
            itemDate={{ hasDueDate: it.hasDueDate, start: it.start }}
            readOnly={shareMode}
            onChange={(deadlineAt) => update({ deadlineAt })}
          />
        </div>

        <SectionHeader>Organizacja i współpraca</SectionHeader>

        {/* Group */}
        {shareMode ? (
          <div className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2">
            <Icon>
              <Tag size={15} />
            </Icon>
            <span className="text-sm text-ink-faint">SHARE</span>
          </div>
        ) : (
          <>
            <button
              onClick={() => toggle("group")}
              className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-surface-raised"
            >
              <Icon>
                <Tag size={15} />
              </Icon>
              {group ? (
                <span className="flex items-center gap-2 text-sm text-ink">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: group.color }} />
                  {group.name}
                </span>
              ) : (
                <span className="text-sm text-ink-faint">Grupa</span>
              )}
              {!group && <span className="ml-auto text-xs text-ink-faint">Brak</span>}
            </button>
            {isOpen("group", false) && (
              <div className="mb-1 ml-9 mt-1 flex flex-wrap gap-1.5">
                <GroupChip
                  label="brak"
                  color="#6c6c76"
                  active={!it.groupId}
                  onClick={() => update({ groupId: null })}
                />
                {groups.filter((g) => !isShareGroup(g) && g.system !== "archive").map((g) => (
                  <GroupChip
                    key={g.id}
                    label={g.name}
                    color={g.color}
                    active={it.groupId === g.id}
                    onClick={() => update({ groupId: g.id })}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Description */}
        <OptionalRow
          icon={<AlignLeft size={15} />}
          label="Opis"
          hasContent={it.description.trim().length > 0}
          openKey="desc"
          open={open}
          setOpen={setOpen}
        >
          <textarea
            value={it.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Dodaj opis…"
            rows={3}
            className="w-full resize-y border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </OptionalRow>

        {/* Checklist */}
        <OptionalRow
          icon={<CheckSquare size={15} />}
          label="Lista punktów"
          hasContent={it.checklist.length > 0}
          openKey="check"
          open={open}
          setOpen={setOpen}
          summary={
            it.checklist.length > 0
              ? `${it.checklist.filter((c) => c.done).length}/${it.checklist.length}`
              : undefined
          }
        >
          <ChecklistEditor
            checklist={it.checklist}
            assignees={checklistAssignees}
            onChange={(checklist) => update({ checklist })}
          />
        </OptionalRow>

        {/* Links & attachments */}
        <OptionalRow
          icon={<LinkIcon size={15} />}
          label="Linki i załączniki"
          hasContent={it.attachments.length > 0}
          openKey="links"
          open={open}
          setOpen={setOpen}
          summary={it.attachments.length > 0 ? `${it.attachments.length}` : undefined}
        >
          <AttachmentsEditor
            attachments={it.attachments}
            onChange={(attachments) => update({ attachments })}
            fileRef={fileRef}
          />
        </OptionalRow>

        {/* Participants */}
        <OptionalRow
          icon={<Users size={15} />}
          label="Uczestnicy"
          hasContent={it.participants.length > 0}
          openKey="participants"
          open={open}
          setOpen={setOpen}
          summary={
            it.participants.length > 0
              ? `${it.participants.length} ${it.participants.length === 1 ? "osoba" : "osób"}`
              : undefined
          }
        >
          {shareMode ? (
            <ShareParticipantsList
              participants={it.participants}
              itemId={it.id}
              authUserId={authUserId}
              authUserEmail={authUserEmail}
              onRejected={() => {
                removeSharedItem(it.id);
                setEditing(null);
              }}
              onParticipantsChange={(participants) => patchItem(it.id, { participants })}
            />
          ) : teamMembers.filter((m) => !m.muted).length === 0 ? (
            <ParticipantsReadOnly participants={it.participants} />
          ) : (
            <TeamParticipantsEditor
              participants={it.participants}
              teamMembers={teamMembers}
              onChange={(participants) => update({ participants })}
            />
          )}
        </OptionalRow>

        {/* Tags */}
        <OptionalRow
          icon={<Tags size={15} />}
          label="Tagi"
          hasContent={itemTagIds.length > 0}
          openKey="tags"
          open={open}
          setOpen={setOpen}
          summary={itemTagIds.length > 0 ? `${itemTagIds.length}` : undefined}
        >
          <ItemTagsEditor item={it} onChange={handleTagIds} />
        </OptionalRow>

        {/* Dyskusja (CHAT2-ITEM) — tylko zapisane wpisy, wymaga chmury */}
        {cloudEnabled && !isDraft && (
          <OptionalRow
            icon={<MessageSquare size={15} />}
            label="Dyskusja"
            hasContent={false}
            openKey="discussion"
            open={open}
            setOpen={setOpen}
          >
            <Suspense
              fallback={
                <div className="px-1 py-2 text-xs text-ink-faint">Ładowanie…</div>
              }
            >
              <ItemDiscussion itemId={it.id} />
            </Suspense>
          </OptionalRow>
        )}

        {!shareMode && (
          <>
            <SectionHeader>Widoczność</SectionHeader>
            <div className="overflow-hidden rounded-lg border border-line bg-surface-raised/50">
            <VisibilityRow
              label="Pokaż w kalendarzu"
              checked={it.showInCalendar}
              onChange={handleShowInCalendar}
            />
            <div className="border-t border-line" />
            <VisibilityRow
              label="Pokaż na liście ToDo"
              checked={it.showInTodo}
              onChange={(v) => update({ showInTodo: v })}
            />
            </div>
          </>
        )}
      </div>

      <EditorBottomBar
        isMobile={isMobile}
        isDraft={isDraft}
        item={it}
        canAdd={canAdd}
        shareMode={shareMode}
        onCancel={isDraft ? discardDraft : closeEditor}
        onCommit={commitDraft}
        onMarkDone={() => toggleTaskDone(it.id)}
      />
    </div>
  );
}

function EditorBottomBar({
  isMobile,
  isDraft,
  item,
  canAdd,
  shareMode,
  onCancel,
  onCommit,
  onMarkDone,
}: {
  isMobile: boolean;
  isDraft: boolean;
  item: Item;
  canAdd: boolean;
  shareMode: boolean;
  onCancel: () => void;
  onCommit: () => void;
  onMarkDone: () => void;
}) {
  const showMarkDoneBtn = !isDraft && !shareMode && itemSupportsTodoDone(item);
  const addLabel = canAdd
    ? item.type === "task"
      ? "Dodaj zadanie"
      : "Dodaj wydarzenie"
    : "Wpisz tytuł, aby dodać";

  const barClass = "flex shrink-0 gap-2 border-t border-line bg-surface px-3 pt-3";
  const safeAreaStyle = isMobile
    ? { paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }
    : { paddingBottom: "0.75rem" };

  const backSecondaryClass = isMobile
    ? "inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-surface-overlay px-4 text-sm font-medium text-ink shadow-pop transition hover:bg-surface-raised"
    : "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-surface-overlay px-4 text-sm font-medium text-ink transition hover:bg-surface-raised";

  const primaryClass = isMobile
    ? "inline-flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-full bg-accent-grad px-4 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    : "inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-lg bg-accent-grad px-4 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";

  const markDoneActiveClass = primaryClass;

  const markDoneDoneClass = isMobile
    ? "inline-flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-full border border-line bg-surface-overlay px-4 text-sm font-medium text-ink-faint opacity-60 shadow-pop transition hover:bg-surface-raised hover:opacity-80"
    : "inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-lg border border-line bg-surface-overlay px-4 text-sm font-medium text-ink-faint opacity-60 transition hover:bg-surface-raised hover:opacity-80";

  const backOnly = !isDraft && !showMarkDoneBtn;

  return (
    <div className={barClass} style={safeAreaStyle}>
      {isDraft && (
        <button type="button" onClick={onCommit} disabled={!canAdd} className={primaryClass}>
          {addLabel}
        </button>
      )}
      {!isDraft && showMarkDoneBtn && (
        <button
          type="button"
          onClick={onMarkDone}
          className={item.done ? markDoneDoneClass : markDoneActiveClass}
          aria-pressed={item.done}
        >
          {item.done ? "☑ Wykonane" : "☐ Oznacz"}
        </button>
      )}
      <button
        type="button"
        onClick={onCancel}
        className={`${backSecondaryClass}${backOnly ? " ml-auto" : ""}`}
        aria-label="Wróć"
      >
        <ArrowLeft size={18} aria-hidden />
        Wróć
      </button>
    </div>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return <span className="flex w-5 shrink-0 justify-center text-ink-faint">{children}</span>;
}

function SectionHeader({ children }: { children: string }) {
  return (
    <div className="mb-2 mt-5 first:mt-0 text-xs font-semibold uppercase tracking-wide text-ink-faint">
      {children}
    </div>
  );
}

/** A clean single-line row that reveals its editor on click (or when it has content). */
function OptionalRow({
  icon,
  label,
  summary,
  hasContent,
  openKey,
  open,
  setOpen,
  children,
}: {
  icon: ReactNode;
  label: string;
  summary?: string;
  hasContent: boolean;
  openKey: string;
  open: Record<string, boolean>;
  setOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
  children: ReactNode;
}) {
  const expanded = open[openKey] ?? hasContent;
  return (
    <div>
      <button
        onClick={() => setOpen((o) => ({ ...o, [openKey]: !(o[openKey] ?? hasContent) }))}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-surface-raised"
      >
        <Icon>{icon}</Icon>
        <span className={`text-sm ${hasContent || expanded ? "text-ink" : "text-ink-faint"}`}>
          {label}
        </span>
        {summary && <span className="ml-auto text-xs text-ink-faint">{summary}</span>}
      </button>
      {expanded && <div className="ml-9 mb-1 mt-1">{children}</div>}
    </div>
  );
}

function VisibilityRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1 text-xs text-ink-light">{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) onChange(!checked);
      }}
      className={`relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full p-0.5 transition-colors ${
        checked ? "bg-accent" : "bg-line-strong"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span
        className={`block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
          checked ? "translate-x-[18px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function GroupChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        active ? "text-ink" : "border-line text-ink-light hover:text-ink"
      }`}
      style={active ? { background: `${color}26`, borderColor: `${color}80` } : undefined}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </button>
  );
}

function ParticipantsReadOnly({ participants }: { participants: Participant[] }) {
  if (participants.length === 0) {
    return <span className="text-xs text-ink-faint">Brak uczestników</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {participants.map((p) => (
        <ParticipantChip key={p.id} participant={p} />
      ))}
    </div>
  );
}

function isOwnParticipant(
  p: Participant,
  authUserId: string | null,
  authUserEmail: string | null,
): boolean {
  if (authUserId && p.userId === authUserId) return true;
  if (authUserEmail && p.email?.toLowerCase() === authUserEmail.toLowerCase()) return true;
  return false;
}

function participationMenuOptions(
  status: ParticipantStatus,
): { label: string; next: ParticipantStatus; danger?: boolean }[] {
  if (status === "rejected") return [];
  if (status === "invited" || status === "accepted") {
    return [
      { label: "W realizacji", next: "active" },
      { label: "Odrzuć udział", next: "rejected", danger: true },
    ];
  }
  return [{ label: "Odrzuć udział", next: "rejected", danger: true }];
}

function ShareParticipantsList({
  participants,
  itemId,
  authUserId,
  authUserEmail,
  onRejected,
  onParticipantsChange,
}: {
  participants: Participant[];
  itemId: string;
  authUserId: string | null;
  authUserEmail: string | null;
  onRejected: () => void;
  onParticipantsChange: (participants: Participant[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (participants.length === 0) {
    return <span className="text-xs text-ink-faint">Brak uczestników</span>;
  }

  const applyStatus = async (status: ParticipantStatus) => {
    if (status === "rejected") {
      const res = await rejectItemParticipation(itemId);
      if (!res.error) onRejected();
      return;
    }
    const res = await updateOwnParticipationStatus(itemId, status);
    if (!res.error) {
      onParticipantsChange(
        participants.map((p) =>
          isOwnParticipant(p, authUserId, authUserEmail) ? { ...p, status } : p,
        ),
      );
    }
    setOpenId(null);
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {participants.map((p) => {
        const status = p.status ?? "invited";
        const own = isOwnParticipant(p, authUserId, authUserEmail);
        const menu = own ? participationMenuOptions(status) : [];
        const rejected = status === "rejected";

        if (!own || menu.length === 0) {
          return <ParticipantChip key={p.id} participant={p} />;
        }

        return (
          <div key={p.id} className="relative">
            <button
              type="button"
              onClick={() => setOpenId((id) => (id === p.id ? null : p.id))}
              className={`inline-flex items-center gap-0.5 rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-ink transition hover:bg-surface-raised ${
                rejected ? "opacity-60" : ""
              }`}
            >
              {p.name || p.email}
              <span className="text-[10px] text-ink-faint">
                · {PARTICIPANT_STATUS_LABELS[status]}
              </span>
              <ChevronDown size={12} className="text-ink-faint" />
            </button>
            {openId === p.id && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="Zamknij menu"
                  onClick={() => setOpenId(null)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-line bg-surface-overlay py-1 shadow-pop">
                  {menu.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => void applyStatus(opt.next)}
                      className={`block w-full px-3 py-2 text-left text-sm transition hover:bg-surface-raised ${
                        opt.danger ? "text-red-400" : "text-ink"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ParticipantChip({ participant: p }: { participant: Participant }) {
  const status = p.status ?? "invited";
  const rejected = status === "rejected";
  return (
    <span
      className={`rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-ink ${
        rejected ? "opacity-60" : ""
      }`}
    >
      {p.name || p.email}
      <span className="ml-1 text-[10px] text-ink-faint">
        · {PARTICIPANT_STATUS_LABELS[status]}
      </span>
    </span>
  );
}

function TeamParticipantsEditor({
  participants,
  teamMembers,
  onChange,
}: {
  participants: Participant[];
  teamMembers: TeamMember[];
  onChange: (p: Participant[]) => void;
}) {
  const selectedIds = new Set(participants.map((p) => p.teamMemberId).filter(Boolean));
  const available = teamMembers.filter((m) => !m.muted && !selectedIds.has(m.id));

  const addMember = (memberId: string) => {
    const m = teamMembers.find((x) => x.id === memberId);
    if (!m) return;
    onChange([...participants, participantFromTeamMember(m)]);
  };

  return (
    <div className="space-y-2">
      {participants.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {participants.map((p) => {
            const status = p.status ?? "invited";
            const rejected = status === "rejected";
            return (
              <span
                key={p.id}
                className={`flex items-center gap-1 rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-ink ${
                  rejected ? "opacity-60" : ""
                }`}
              >
                <span>
                  {p.name || p.email}
                  <span className="ml-1 text-[10px] text-ink-faint">
                    · {PARTICIPANT_STATUS_LABELS[status]}
                  </span>
                </span>
                {!rejected && (
                  <button
                    type="button"
                    onClick={() => onChange(participants.filter((x) => x.id !== p.id))}
                    className="text-ink-faint hover:text-ink"
                    aria-label="Usuń uczestnika"
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
      {available.length > 0 ? (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) addMember(e.target.value);
          }}
          className="w-full rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-sm text-ink outline-none"
        >
          <option value="">Dodaj z zespołu…</option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {teamMemberLabel(m)}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs text-ink-faint">
          {teamMembers.filter((m) => !m.muted).length === 0
            ? teamMembers.length > 0
              ? "Wszystkie kontakty są wyciszone. Przywróć je w Ustawienia → Kontakty."
              : "Brak osób w zespole. Zaproś kogoś w Ustawienia → Zespół."
            : "Wszyscy dostępni członkowie są już dodani."}
        </p>
      )}
    </div>
  );
}

function ChecklistEditor({
  checklist,
  assignees,
  onChange,
}: {
  checklist: ChecklistItem[];
  assignees: ChecklistAssignee[];
  onChange: (c: ChecklistItem[]) => void;
}) {
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [pasteHint, setPasteHint] = useState<string | null>(null);

  useEffect(() => {
    if (!focusItemId) return;
    const el = inputRefs.current.get(focusItemId);
    if (el) {
      el.focus();
      setFocusItemId(null);
    }
  }, [checklist, focusItemId]);

  const newChecklistItem = (): ChecklistItem => ({
    id: uid(),
    text: "",
    done: false,
  });

  const addPointAtEnd = () => {
    const item = newChecklistItem();
    onChange([...checklist, item]);
    setFocusItemId(item.id);
  };

  const insertPointAfter = (index: number) => {
    const item = newChecklistItem();
    const next = [...checklist];
    next.splice(index + 1, 0, item);
    onChange(next);
    setFocusItemId(item.id);
  };

  const applyPaste = (text: string, replaceIndex?: number) => {
    const parsed = parseChecklistPaste(text);
    if (parsed.length === 0) return;

    const newItems = parsed.map((t) => ({ id: uid(), text: t, done: false }));

    if (replaceIndex !== undefined) {
      const row = checklist[replaceIndex];
      const before = checklist.slice(0, replaceIndex);
      const after = checklist.slice(replaceIndex + 1);
      if (row && !row.text.trim()) {
        const [first, ...rest] = newItems;
        onChange([...before, { ...row, text: first.text }, ...rest, ...after]);
        return;
      }
      onChange([...before, ...(row ? [row] : []), ...newItems, ...after]);
      return;
    }

    const base = [...checklist];
    const trimmedLast = base.length > 0 && !base[base.length - 1].text.trim();
    if (trimmedLast) base.pop();
    onChange([...base, ...newItems]);
  };

  const onPaste = (e: React.ClipboardEvent, replaceIndex?: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!shouldParseChecklistPaste(text)) return;
    e.preventDefault();
    setPasteHint(null);
    applyPaste(text, replaceIndex);
  };

  const pasteFromClipboard = async () => {
    setPasteHint(null);
    try {
      if (!navigator.clipboard?.readText) {
        setPasteHint("Schowek niedostępny w tej przeglądarce.");
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setPasteHint("Schowek jest pusty.");
        return;
      }
      if (!shouldParseChecklistPaste(text)) {
        setPasteHint("Nie rozpoznano listy — użyj myślników, przecinków lub wielu linii.");
        return;
      }
      applyPaste(text);
    } catch {
      setPasteHint("Brak dostępu do schowka.");
    }
  };

  return (
    <div className="space-y-2">
      {checklist.length > 0 && (
        <div className="space-y-1">
          {checklist.map((c, index) => (
            <div key={c.id} className="group flex items-center gap-2">
              <input
                type="checkbox"
                checked={c.done}
                onChange={(e) =>
                  onChange(checklist.map((x) => (x.id === c.id ? { ...x, done: e.target.checked } : x)))
                }
                className="h-3.5 w-3.5 accent-accent"
              />
              <input
                ref={(el) => {
                  if (el) inputRefs.current.set(c.id, el);
                  else inputRefs.current.delete(c.id);
                }}
                value={c.text}
                placeholder="Punkt…"
                onPaste={(e) => onPaste(e, index)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  e.preventDefault();
                  if (!c.text.trim()) return;
                  insertPointAfter(index);
                }}
                onChange={(e) =>
                  onChange(checklist.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))
                }
                className={`min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-ink-faint ${
                  c.done ? "text-ink-faint line-through" : "text-ink"
                }`}
              />
              <ChecklistAssigneePicker
                assignees={assignees}
                assignedUserId={c.assignedUserId}
                onChange={(assignedUserId) =>
                  onChange(
                    checklist.map((x) => (x.id === c.id ? { ...x, assignedUserId } : x)),
                  )
                }
              />
              <button
                onClick={() => onChange(checklist.filter((x) => x.id !== c.id))}
                className="text-ink-faint opacity-0 transition group-hover:opacity-100 hover:text-ink"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={addPointAtEnd}
        className="flex items-center gap-1 text-sm text-ink-light transition hover:text-ink"
      >
        <Plus size={14} /> Punkt
      </button>
      <div
        tabIndex={0}
        onPaste={(e) => onPaste(e)}
        className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 outline-none transition focus:border-line-strong focus:bg-surface-raised/50"
      >
        <span className="min-w-0 flex-1 text-xs text-ink-faint">
          Wklej listę (Ctrl+V) — myślniki, przecinki, linie z godzinami
        </span>
        <button
          type="button"
          onClick={() => void pasteFromClipboard()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface-overlay px-2 py-1 text-xs font-medium text-ink-light transition hover:border-line-strong hover:bg-surface-raised hover:text-ink"
        >
          <ClipboardPaste size={12} aria-hidden />
          Wklej
        </button>
      </div>
      {pasteHint && <p className="text-xs text-ink-faint">{pasteHint}</p>}
    </div>
  );
}

function ChecklistAssigneePicker({
  assignees,
  assignedUserId,
  onChange,
}: {
  assignees: ChecklistAssignee[];
  assignedUserId?: string | null;
  onChange: (assignedUserId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (assignees.length === 0) return null;

  const assigned = Boolean(assignedUserId);
  const displayName = assigned
    ? checklistAssigneeLabel(assignees, assignedUserId)
    : "Nieprzypisane";

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={displayName}
        className={`max-w-[6rem] truncate rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
          assigned
            ? "border-accent/40 bg-accent/10 text-accent-soft"
            : "border-line bg-surface-raised text-ink-faint"
        }`}
      >
        {assigned ? displayName : "Nieprzyp."}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 min-w-[10rem] max-w-[min(11rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface-overlay py-1 shadow-pop">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={`block w-full px-3 py-1.5 text-left text-xs transition hover:bg-surface-raised ${
              !assignedUserId ? "text-accent-soft" : "text-ink-light"
            }`}
          >
            Nieprzypisane
          </button>
          {assignees.map((a) => (
            <button
              key={a.userId}
              type="button"
              onClick={() => {
                onChange(a.userId);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-surface-raised ${
                assignedUserId === a.userId ? "text-accent-soft" : "text-ink"
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent-soft">
                {a.initials}
              </span>
              <span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentsEditor({
  attachments,
  onChange,
  fileRef,
}: {
  attachments: Attachment[];
  onChange: (a: Attachment[]) => void;
  fileRef: RefObject<HTMLInputElement>;
}) {
  const addFile = (file: File) => {
    if (isAttachmentTooLarge(file)) {
      alert(ATTACHMENT_TOO_LARGE_MESSAGE);
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      onChange([
        ...attachments,
        { id: uid(), kind: "file", url: String(reader.result), title: file.name },
      ]);
    reader.readAsDataURL(file);
  };

  return (
    <div>
      {attachments.length > 0 && (
        <div className="mb-1.5 space-y-1">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-sm">
              {a.kind === "link" ? (
                <LinkIcon size={13} className="text-ink-faint" />
              ) : (
                <Paperclip size={13} className="text-ink-faint" />
              )}
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                download={a.kind === "file" ? a.title : undefined}
                className="flex-1 truncate text-accent-soft hover:underline"
              >
                {a.title || a.url}
              </a>
              <button
                onClick={() => onChange(attachments.filter((x) => x.id !== a.id))}
                className="text-ink-faint hover:text-ink"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          placeholder="Wklej link i Enter…"
          onKeyDown={(e) => {
            const v = e.currentTarget.value.trim();
            if (e.key === "Enter" && v) {
              onChange([...attachments, { id: uid(), kind: "link", url: v, title: v }]);
              e.currentTarget.value = "";
            }
          }}
          className="flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-light transition hover:bg-surface-overlay hover:text-ink"
        >
          <Paperclip size={13} /> Plik
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) addFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

function CompactFieldButton({
  icon,
  label,
  value,
  onClick,
  disabled,
  readOnly,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onClick?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  if (disabled) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line/60 bg-surface-raised/30 px-2.5 py-2 opacity-60">
        <span className="shrink-0">{icon}</span>
        <span className="text-xs text-ink-faint">{label}</span>
        <span className="ml-auto truncate text-[11px] text-ink-faint">Ustaw termin</span>
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line/60 bg-surface-raised/30 px-2.5 py-2">
        <span className="shrink-0">{icon}</span>
        <span className="text-xs text-ink-light">{label}</span>
        <span className="ml-auto min-w-0 truncate text-[11px] text-ink-faint">{value}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line/60 bg-surface-raised/40 px-2.5 py-2 text-left transition hover:border-line hover:bg-surface-raised"
    >
      <span className="shrink-0">{icon}</span>
      <span className="text-xs text-ink-light">{label}</span>
      <span className="ml-auto min-w-0 truncate text-[11px] text-ink-faint">{value}</span>
      <ChevronDown size={12} className="shrink-0 text-ink-faint" />
    </button>
  );
}

function CompactReminderField({
  reminders,
  onChange,
  hasDueDate,
}: {
  reminders: Reminder[];
  onChange: (r: Reminder[]) => void;
  hasDueDate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCustom(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const summary =
    reminders.length === 0
      ? "Brak"
      : reminders.length === 1
        ? "1"
        : `${reminders.length} przyp.`;

  const addRelativeReminder = (minutes: number) => {
    if (reminders.some((r) => !r.remindAt && r.offsetMinutes === minutes)) return;
    onChange([...reminders, { id: uid(), offsetMinutes: minutes, firedAt: null }]);
  };

  const addAbsoluteReminder = (iso: string) => {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return;
    if (reminders.some((r) => r.remindAt && new Date(r.remindAt!).getTime() === t)) return;
    onChange([...reminders, { id: uid(), offsetMinutes: 0, remindAt: iso, firedAt: null }]);
  };

  const openCustom = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 60 - (d.getMinutes() % 15), 0, 0);
    setCustomValue(toLocalDatetimeValue(d.toISOString()));
    setCustom(true);
  };

  return (
    <div className="relative min-w-0 flex-1" ref={wrapRef}>
      <CompactFieldButton
        icon={<Bell size={14} className="text-amber-400/80" />}
        label="Przypomnienia"
        value={summary}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-w-[calc(100vw-2.5rem)] rounded-lg border border-line bg-surface-overlay p-2 shadow-pop">
          {reminders.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {reminders.map((r) => (
                <span
                  key={r.id}
                  className="flex items-center gap-1 rounded-full bg-amber-400/[0.14] px-2 py-0.5 text-[11px] text-amber-300"
                >
                  {reminderDisplayLabel(r)}
                  <button
                    type="button"
                    onClick={() => onChange(reminders.filter((x) => x.id !== r.id))}
                    className="opacity-70 hover:opacity-100"
                    aria-label="Usuń przypomnienie"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {!custom ? (
            <>
              {hasDueDate ? (
                <div className="flex flex-col gap-0.5">
                  {REMINDER_MENU_PRESETS.map((p) => (
                    <button
                      key={p.minutes}
                      type="button"
                      onClick={() => {
                        addRelativeReminder(p.minutes);
                        setOpen(false);
                      }}
                      disabled={reminders.some((r) => !r.remindAt && r.offsetMinutes === p.minutes)}
                      className="rounded-md px-2 py-1.5 text-left text-xs text-ink transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mb-1 px-2 text-[10px] text-ink-faint">
                  Presety przed terminem wymagają ustawienia terminu.
                </p>
              )}
              <button
                type="button"
                onClick={openCustom}
                className={`w-full rounded-md border border-line bg-surface-raised px-2 py-1.5 text-left text-xs text-ink hover:border-line-strong ${
                  hasDueDate ? "mt-1" : ""
                }`}
              >
                Własna data i godzina
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <input
                type="datetime-local"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                className="w-full rounded-md border border-line bg-surface-raised px-2 py-1.5 text-xs text-ink outline-none"
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (customValue) addAbsoluteReminder(fromLocalDatetimeValue(customValue));
                    setOpen(false);
                    setCustom(false);
                  }}
                  className="flex-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white"
                >
                  Dodaj
                </button>
                <button
                  type="button"
                  onClick={() => setCustom(false)}
                  className="rounded-md border border-line px-2 py-1 text-xs text-ink-faint"
                >
                  Wstecz
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CompactDeadlineField({
  deadlineAt,
  itemDate,
  readOnly,
  onChange,
}: {
  deadlineAt?: string | null;
  itemDate: Pick<Item, "hasDueDate" | "start">;
  readOnly?: boolean;
  onChange: (deadlineAt: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCustom(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const summary = deadlineAt
    ? fmt(new Date(deadlineAt), "d MMM, HH:mm")
    : "Brak";

  return (
    <div className="relative min-w-0 flex-1" ref={wrapRef}>
      <CompactFieldButton
        icon={<AlarmClock size={14} className="text-red-400/80" />}
        label="Deadline"
        value={summary}
        readOnly={readOnly}
        onClick={() => !readOnly && setOpen((v) => !v)}
      />
      {open && !readOnly && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-w-[calc(100vw-2.5rem)] rounded-lg border border-line bg-surface-overlay p-2 shadow-pop">
          {deadlineAt && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="mb-2 w-full rounded-md border border-line px-2 py-1 text-left text-xs text-red-400 hover:bg-surface-raised"
            >
              Usuń deadline
            </button>
          )}
          {!custom ? (
            <>
              <div className="flex flex-wrap gap-1">
                {DEADLINE_PRESET_DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      onChange(deadlineAtNoonFromItem(itemDate, d));
                      setOpen(false);
                    }}
                    className="rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-ink hover:border-line-strong"
                  >
                    +{d} dni
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setCustom(true);
                  setCustomValue(
                    toLocalDatetimeValue(deadlineAt ?? deadlineAtNoonFromItem(itemDate, 7)),
                  );
                }}
                className="mt-2 w-full rounded-md border border-line bg-surface-raised px-2 py-1.5 text-left text-xs text-ink hover:border-line-strong"
              >
                Własne
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <input
                type="datetime-local"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                className="w-full rounded-md border border-line bg-surface-raised px-2 py-1.5 text-xs text-ink outline-none"
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (customValue) onChange(fromLocalDatetimeValue(customValue));
                    setOpen(false);
                    setCustom(false);
                  }}
                  className="flex-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white"
                >
                  Zapisz
                </button>
                <button
                  type="button"
                  onClick={() => setCustom(false)}
                  className="rounded-md border border-line px-2 py-1 text-xs text-ink-faint"
                >
                  Wstecz
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function toLocalDatetimeValue(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function fromLocalDatetimeValue(value: string): string {
  return new Date(value).toISOString();
}
