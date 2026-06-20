import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useStore } from "@/state/store";
import type { Attachment, ChecklistItem, DualVisibilityMode, Item, Participant, Reminder } from "@/types";
import { uid, defaultTaskDueRange, calendarBlockFromDeadline, itemDurationMinutes } from "@/lib/factory";
import { parseChecklistPaste, shouldParseChecklistPaste } from "@/lib/checklistPaste";
import { cloudEnabled } from "@/lib/supabase";
import { fmt } from "@/lib/format";
import { TimeEditor } from "@/components/item/TimeEditor";
import {
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
  Tag,
} from "lucide-react";

const REMINDER_PRESETS: { label: string; minutes: number }[] = [
  { label: "W momencie", minutes: 0 },
  { label: "5 min przed", minutes: 5 },
  { label: "10 min przed", minutes: 10 },
  { label: "15 min przed", minutes: 15 },
  { label: "30 min przed", minutes: 30 },
  { label: "1 godz. przed", minutes: 60 },
  { label: "1 dzień przed", minutes: 1440 },
];

function durationLabel(a: Date, b: Date): string {
  const m = Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
  if (m >= 1440 && m % 1440 === 0) return `${m / 1440} dni`;
  if (m >= 1440) return `${Math.round((m / 1440) * 10) / 10} dni`;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h} godz ${mm} min` : `${h} godz`;
  }
  return `${m} min`;
}

export function ItemEditorPanel() {
  const editingId = useStore((s) => s.editingId);
  const draft = useStore((s) => s.draft);
  const items = useStore((s) => s.items);
  const groups = useStore((s) => s.groups);
  const patchItem = useStore((s) => s.patchItem);
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const patchDraft = useStore((s) => s.patchDraft);
  const deleteItem = useStore((s) => s.deleteItem);
  const discardDraft = useStore((s) => s.discardDraft);
  const closeEditor = useStore((s) => s.closeEditor);
  const setEditing = useStore((s) => s.setEditing);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const isDraft = !!draft && editingId === draft.id;
  const item = isDraft ? draft : editingId ? items[editingId] : undefined;

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
  const it = item;
  const group = it.groupId ? groups.find((g) => g.id === it.groupId) : undefined;

  const update = (patch: Partial<Item>) =>
    isDraft ? patchDraft(patch) : patchItem(it.id, patch);
  const canAdd = it.title.trim().length > 0;

  const isOpen = (k: string, hasContent: boolean) => open[k] ?? hasContent;
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !(o[k] ?? false) }));

  const start = new Date(it.start);
  const end = new Date(it.end);
  const showDueDate = it.hasDueDate;
  const durationMin = showDueDate ? itemDurationMinutes(it.start, it.end) : 0;
  const isPointInTime = showDueDate && !it.allDay && durationMin === 0;

  const setDueDate = () => {
    const { start: s, end: e } = defaultTaskDueRange();
    update({ hasDueDate: true, start: s, end: e, allDay: false });
    setOpen((o) => ({ ...o, time: true }));
  };

  const clearDueDate = () => {
    if (it.type !== "task") return;
    update({ hasDueDate: false, reminders: [] });
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
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => (it.type === "task" ? convertToEvent() : convertToTask())}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-light transition hover:bg-surface-raised hover:text-ink"
          title="Przełącz typ"
        >
          {it.type === "task" ? <CheckSquare size={13} /> : <CalendarClock size={13} />}
          {it.type === "task" ? "Zadanie" : "Wydarzenie"}
          <ChevronDown size={13} className="text-ink-faint" />
        </button>

        <div className="ml-auto flex items-center gap-0.5">
          {it.type === "task" && (
            <button
              onClick={() =>
                isDraft ? update({ done: !it.done }) : toggleTaskDone(it.id)
              }
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                it.done
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-ink-light hover:bg-surface-raised hover:text-ink"
              }`}
            >
              <Check size={13} /> {it.done ? "Zrobione" : "Oznacz"}
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
            className="rounded-md p-1.5 text-ink-faint transition hover:bg-red-500/10 hover:text-red-400"
            title={isDraft ? "Odrzuć" : "Usuń"}
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={closeEditor}
            className="rounded-md p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
            title="Zamknij (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar px-5 pb-5">
        <input
          value={it.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Bez tytułu"
          autoFocus
          className="mb-3 w-full border-0 bg-transparent text-2xl font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-faint"
        />

        {/* Time — summary that expands into editable inputs */}
        <button
          onClick={() => toggle("time")}
          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-surface-raised"
        >
          <Icon>
            <CalendarClock size={16} />
          </Icon>
          <span className="text-sm text-ink">
            {!showDueDate ? (
              <span className="text-ink-faint">Bez terminu</span>
            ) : it.allDay ? (
              <>
                {fmt(start, "EEEE, d MMM")}
                {fmt(start, "yyyy-MM-dd") !== fmt(end, "yyyy-MM-dd") && (
                  <> – {fmt(new Date(end.getTime() - 1), "d MMM")}</>
                )}
              </>
            ) : isPointInTime ? (
              <>
                {fmt(start, "EEEE, d MMM")}
                <span className="mx-1.5 text-ink-faint">·</span>
                {fmt(start, "HH:mm")}
              </>
            ) : (
              <>
                {fmt(start, "EEEE, d MMM")}
                <span className="mx-1.5 text-ink-faint">·</span>
                {fmt(start, "HH:mm")} → {fmt(end, "HH:mm")}
                <span className="ml-1.5 text-ink-faint">{durationLabel(start, end)}</span>
              </>
            )}
          </span>
        </button>
        {isOpen("time", showDueDate) && (
          <div className="mb-1 ml-9 mt-1">
            {!showDueDate ? (
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
        )}

        {/* Group */}
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
        </button>
        {isOpen("group", false) && (
          <div className="mb-1 ml-9 mt-1 flex flex-wrap gap-1.5">
            <GroupChip
              label="brak"
              color="#6c6c76"
              active={!it.groupId}
              onClick={() => update({ groupId: null })}
            />
            {groups.map((g) => (
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

        <Divider />

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
          <ParticipantsEditor
            participants={it.participants}
            onChange={(participants) => update({ participants })}
          />
        </OptionalRow>

        {/* Reminders — tylko gdy jest termin */}
        {showDueDate ? (
          <OptionalRow
            icon={<Bell size={15} />}
            label="Przypomnienia"
            hasContent={it.reminders.length > 0}
            openKey="reminders"
            open={open}
            setOpen={setOpen}
            summary={
              it.reminders.length > 0 ? `${it.reminders.length}` : undefined
            }
          >
            <RemindersEditor
              reminders={it.reminders}
              onChange={(reminders) => update({ reminders })}
            />
          </OptionalRow>
        ) : (
          <div className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 opacity-60">
            <Icon>
              <Bell size={15} />
            </Icon>
            <span className="text-sm text-ink-faint">Przypomnienia</span>
            <span className="ml-auto text-xs text-ink-faint">Ustaw termin</span>
          </div>
        )}

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

        <Divider />

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
          <ChecklistEditor checklist={it.checklist} onChange={(checklist) => update({ checklist })} />
        </OptionalRow>

        <Divider />

        {/* Visibility — de-emphasised footer */}
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
          {cloudEnabled && it.type === "task" && it.showInCalendar && it.showInTodo && (
            <>
              <div className="border-t border-line" />
              <div className="px-3 py-2.5">
                <div className="mb-1 text-xs text-ink-light">Sync Google (to zadanie)</div>
                <select
                  value={it.googleSyncOverride ?? ""}
                  onChange={(e) =>
                    update({
                      googleSyncOverride: (e.target.value || null) as DualVisibilityMode | null,
                    })
                  }
                  className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink"
                >
                  <option value="">Domyślnie (z ustawień)</option>
                  <option value="both_linked">Kalendarz + Tasks</option>
                  <option value="calendar_only">Tylko Kalendarz</option>
                  <option value="tasks_only">Tylko Tasks</option>
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {isDraft && (
        <div className="border-t border-line p-3">
          <button
            onClick={closeEditor}
            disabled={!canAdd}
            className="w-full rounded-lg bg-accent-grad px-3 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {canAdd
              ? it.type === "task"
                ? "Dodaj zadanie"
                : "Dodaj wydarzenie"
              : "Wpisz tytuł, aby dodać"}
          </button>
        </div>
      )}
    </div>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return <span className="flex w-5 shrink-0 justify-center text-ink-faint">{children}</span>;
}

function Divider() {
  return <div className="my-2 border-t border-line" />;
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
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1 text-xs text-ink-light">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
      className={`relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full p-0.5 transition-colors ${
        checked ? "bg-accent" : "bg-line-strong"
      }`}
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

function ParticipantsEditor({
  participants,
  onChange,
}: {
  participants: Participant[];
  onChange: (p: Participant[]) => void;
}) {
  return (
    <div>
      {participants.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {participants.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-1 rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-ink"
            >
              {p.name}
              <button
                onClick={() => onChange(participants.filter((x) => x.id !== p.id))}
                className="text-ink-faint hover:text-ink"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        placeholder="Dodaj uczestnika i Enter…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.currentTarget.value.trim()) {
            onChange([...participants, { id: uid(), name: e.currentTarget.value.trim() }]);
            e.currentTarget.value = "";
          }
        }}
        className="w-full border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  );
}

function ChecklistEditor({
  checklist,
  onChange,
}: {
  checklist: ChecklistItem[];
  onChange: (c: ChecklistItem[]) => void;
}) {
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
    if (base.length > 0 && !base[base.length - 1].text.trim()) base.pop();
    onChange([...base, ...newItems]);
  };

  const onPaste = (e: React.ClipboardEvent, replaceIndex?: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!shouldParseChecklistPaste(text)) return;
    e.preventDefault();
    applyPaste(text, replaceIndex);
  };

  return (
    <div onPaste={(e) => onPaste(e)}>
      {checklist.length === 0 && (
        <div className="mb-2 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-ink-faint">
          Wklej listę (Ctrl+V) — myślniki, przecinki, linie z godzinami
        </div>
      )}
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
              value={c.text}
              placeholder="Punkt…"
              onPaste={(e) => onPaste(e, index)}
              onChange={(e) =>
                onChange(checklist.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))
              }
              className={`flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-ink-faint ${
                c.done ? "text-ink-faint line-through" : "text-ink"
              }`}
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
      <button
        onClick={() => onChange([...checklist, { id: uid(), text: "", done: false }])}
        className="mt-1 flex items-center gap-1 text-sm text-ink-light transition hover:text-ink"
      >
        <Plus size={14} /> Punkt
      </button>
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
    if (file.size > 1_500_000) {
      alert("Plik jest za duży do trybu lokalnego (max ~1.5 MB). Użyj linku lub backendu.");
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

function RemindersEditor({
  reminders,
  onChange,
}: {
  reminders: Reminder[];
  onChange: (r: Reminder[]) => void;
}) {
  const label = (m: number) =>
    REMINDER_PRESETS.find((p) => p.minutes === m)?.label ??
    (m % 1440 === 0
      ? `${m / 1440} dni przed`
      : m % 60 === 0
        ? `${m / 60} godz. przed`
        : `${m} min przed`);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {reminders.map((r) => (
        <span
          key={r.id}
          className="flex items-center gap-1 rounded-full bg-amber-400/[0.14] px-2 py-0.5 text-xs text-amber-300"
        >
          <Bell size={11} />
          {label(r.offsetMinutes)}
          <button
            onClick={() => onChange(reminders.filter((x) => x.id !== r.id))}
            className="opacity-70 hover:opacity-100"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <select
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          const minutes = Number(e.target.value);
          if (reminders.some((r) => r.offsetMinutes === minutes)) return;
          onChange([...reminders, { id: uid(), offsetMinutes: minutes, firedAt: null }]);
        }}
        className="rounded-full bg-surface-raised px-2 py-1 text-xs text-ink-light outline-none ring-1 ring-line hover:text-ink"
      >
        <option value="">+ przypomnienie</option>
        {REMINDER_PRESETS.map((p) => (
          <option key={p.minutes} value={p.minutes}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
