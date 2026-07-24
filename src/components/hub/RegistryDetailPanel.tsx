import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  CalendarPlus,
  CheckSquare,
  ExternalLink,
  Gavel,
  MessageSquare,
  StickyNote,
  Undo2,
  X,
} from "lucide-react";
import {
  fetchRegistryLabels,
  updateDecision,
  updateNote,
  upsertRegistryLabels,
} from "@/lib/chat/api";
import {
  beginConvertToItem,
  decisionToNote,
  noteToDecision,
  revokeDecision,
  revokeNote,
  type ConvertTarget,
} from "@/lib/chat/convert";
import {
  jumpToMessage,
  openConversation,
  showTodoInPanel,
} from "@/lib/chat/init";
import { useChatStore } from "@/lib/chat/store";
import { overviewTitle } from "@/lib/chat/feed";
import { isShareGroup } from "@/lib/share";
import { useStore } from "@/state/store";
import { formatMessageTime } from "@/components/chat/MessageBubble";
import { TagIdsEditor } from "@/components/tags/TagIdsEditor";
import { setRouteHash } from "@/lib/navigation";

export type RegistryFocus = {
  kind: "decision" | "note";
  id: string;
  conversationId: string;
  messageId: string | null;
  title: string;
  body: string;
  note: string;
  createdBy: string;
  at: string;
  groupId: string | null;
  tagIds: string[];
};

interface RegistryDetailBodyProps {
  focus: RegistryFocus;
  onFocusChange: (next: RegistryFocus) => void;
  onClose: () => void;
  /** panel = prawy panel hubu; sheet = overlay nad rozmową */
  presentation: "panel" | "sheet";
}

function RegistryDetailBody({
  focus,
  onFocusChange,
  onClose,
  presentation,
}: RegistryDetailBodyProps) {
  const profiles = useChatStore((s) => s.profiles);
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const bumpRegistryEpoch = useChatStore((s) => s.bumpRegistryEpoch);
  const items = useStore((s) => s.items);
  const groups = useStore((s) => s.groups);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(focus.title || "");
  const [body, setBody] = useState(focus.body || "");
  const [decisionNote, setDecisionNote] = useState(focus.note || "");
  const [groupId, setGroupId] = useState<string | null>(focus.groupId ?? null);
  const [tagIds, setTagIds] = useState<string[]>(focus.tagIds ?? []);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(focus.title || "");
    setBody(focus.body || "");
    setDecisionNote(focus.note || "");
    setGroupId(focus.groupId ?? null);
    setTagIds(focus.tagIds ?? []);
    setSaveError(null);
  }, [focus.id, focus.kind, focus.title, focus.body, focus.note, focus.groupId, focus.tagIds]);

  // Uzupełnij etykiety z bazy (np. otwarcie z chipa systemowego bez listy hubu).
  useEffect(() => {
    let cancelled = false;
    void fetchRegistryLabels(focus.kind, [focus.id]).then((map) => {
      if (cancelled) return;
      const labels = map[focus.id];
      if (!labels) return;
      setGroupId(labels.groupId);
      setTagIds(labels.tagIds);
      onFocusChange({
        ...focus,
        groupId: labels.groupId,
        tagIds: labels.tagIds,
      });
    });
    return () => {
      cancelled = true;
    };
    // Tylko przy zmianie wpisu — nie przy każdej aktualizacji focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.id, focus.kind]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (labelTimer.current) clearTimeout(labelTimer.current);
    };
  }, []);

  const isDecision = focus.kind === "decision";
  const canEditNote = !isDecision && focus.createdBy === myUserId;
  const canEditDecision = isDecision && Boolean(myUserId);
  const canEditLabels = Boolean(myUserId);
  const assignableGroups = groups.filter(
    (g) => !isShareGroup(g) && g.system !== "archive",
  );

  const persistLabels = (nextGroupId: string | null, nextTagIds: string[]) => {
    if (!canEditLabels) return;
    if (labelTimer.current) clearTimeout(labelTimer.current);
    labelTimer.current = setTimeout(() => {
      void (async () => {
        const { labels, error } = await upsertRegistryLabels(focus.kind, focus.id, {
          groupId: nextGroupId,
          tagIds: nextTagIds,
        });
        if (error) {
          setSaveError(error);
          return;
        }
        setSaveError(null);
        if (labels) {
          onFocusChange({
            ...focus,
            groupId: labels.groupId,
            tagIds: labels.tagIds,
          });
          bumpRegistryEpoch();
        }
      })();
    }, 200);
  };
  const conv = overview.find((c) => c.id === focus.conversationId);
  const convTitle = conv
    ? overviewTitle(conv, myUserId, (id) => items[id]?.title)
    : "Rozmowa";
  const authorName = profiles[focus.createdBy]?.displayName || "Nieznany";

  const persistNote = (nextTitle: string, nextBody: string) => {
    if (!canEditNote) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        const { note, error } = await updateNote(focus.id, {
          title: nextTitle,
          body: nextBody,
        });
        if (error) {
          setSaveError(error);
          return;
        }
        setSaveError(null);
        if (note) {
          onFocusChange({
            ...focus,
            title: note.title,
            body: note.body,
          });
          bumpRegistryEpoch();
        }
      })();
    }, 450);
  };

  const persistDecisionNote = (nextNote: string) => {
    if (!canEditDecision) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        const { decision, error } = await updateDecision(focus.id, { note: nextNote });
        if (error) {
          setSaveError(error);
          return;
        }
        setSaveError(null);
        if (decision) {
          onFocusChange({
            ...focus,
            body: decision.body,
            note: decision.note,
          });
          bumpRegistryEpoch();
        }
      })();
    }, 450);
  };

  const remove = async () => {
    if (
      !confirm(
        isDecision
          ? "Cofnąć decyzję? Zniknie z rejestru i w czacie pojawi się powiadomienie."
          : "Cofnąć notatkę? Zniknie z rejestru i w czacie pojawi się powiadomienie.",
      )
    )
      return;
    setBusy(true);
    const { error } = isDecision
      ? await revokeDecision({
          id: focus.id,
          conversationId: focus.conversationId,
          body: focus.body,
        })
      : await revokeNote({
          id: focus.id,
          conversationId: focus.conversationId,
          title: focus.title,
          body: focus.body,
        });
    setBusy(false);
    if (error) {
      alert(error);
      return;
    }
    bumpRegistryEpoch();
    onClose();
  };

  const convertToItem = (target: ConvertTarget) => {
    const decisionText = isDecision
      ? [focus.body, decisionNote.trim()].filter(Boolean).join("\n\n")
      : [title.trim(), body.trim()].filter(Boolean).join("\n");
    beginConvertToItem(
      {
        body: decisionText,
        conversationId: focus.conversationId,
        messageId: focus.messageId,
        authorName: authorName || "uczestnika rozmowy",
      },
      target,
    );
  };

  const crossConvert = async () => {
    setBusy(true);
    const { error } = isDecision
      ? await decisionToNote({
          id: focus.id,
          conversationId: focus.conversationId,
          messageId: focus.messageId,
          body: focus.body,
          note: decisionNote,
          createdBy: focus.createdBy,
          decidedAt: focus.at,
          groupId,
          tagIds,
        })
      : await noteToDecision({
          id: focus.id,
          conversationId: focus.conversationId,
          messageId: focus.messageId,
          title: title.trim() || focus.title,
          body: body.trim() || focus.body,
          createdBy: focus.createdBy,
          notedAt: focus.at,
          groupId,
          tagIds,
        });
    setBusy(false);
    if (error) alert(error);
    else {
      bumpRegistryEpoch();
      onClose();
    }
  };

  const labelsBlock = (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-raised/40 px-2.5 py-2">
      <div>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
          Grupa
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!canEditLabels}
            onClick={() => {
              setGroupId(null);
              persistLabels(null, tagIds);
            }}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
              groupId === null
                ? "bg-accent/20 text-ink"
                : "border border-line text-ink-faint hover:text-ink"
            }`}
          >
            brak
          </button>
          {assignableGroups.map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={!canEditLabels}
              onClick={() => {
                setGroupId(g.id);
                persistLabels(g.id, tagIds);
              }}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                groupId === g.id
                  ? "bg-accent/20 text-ink"
                  : "border border-line text-ink-faint hover:text-ink"
              }`}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: g.color }}
              />
              {g.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
          Tagi
        </p>
        <TagIdsEditor
          tagIds={tagIds}
          onChange={(next) => {
            setTagIds(next);
            persistLabels(groupId, next);
          }}
        />
      </div>
      <p className="text-[10px] text-ink-faint">
        Widoczne tylko dla Ciebie — służą do filtrowania w hubie.
      </p>
    </div>
  );

  const openSource = async () => {
    if (presentation === "sheet") {
      onClose();
      if (focus.messageId) void jumpToMessage(focus.conversationId, focus.messageId);
      return;
    }
    await openConversation(focus.conversationId);
    setRouteHash({ view: "conversation", conversationId: focus.conversationId });
    if (focus.messageId) void jumpToMessage(focus.conversationId, focus.messageId);
  };

  const header =
    presentation === "sheet" ? (
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {isDecision ? (
            <Gavel size={15} className="text-accent" />
          ) : (
            <StickyNote size={15} className="text-accent" />
          )}
          {isDecision ? "Decyzja" : "Notatka"}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-ink-faint transition hover:text-ink"
          aria-label="Zamknij"
        >
          <X size={16} />
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
          aria-label="Wróć"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-semibold text-ink">
          {isDecision ? (
            <Gavel size={14} className="shrink-0 text-accent" />
          ) : (
            <StickyNote size={14} className="shrink-0 text-accent" />
          )}
          <span className="truncate">{isDecision ? "Decyzja" : "Notatka"}</span>
        </span>
      </div>
    );

  const content = (
    <div
      className={
        presentation === "sheet"
          ? "thin-scrollbar min-h-0 flex-1 overflow-y-auto px-1"
          : "thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3"
      }
    >
      {isDecision ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-line bg-surface-raised/60 px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Z korespondencji
            </p>
            <button
              type="button"
              onClick={() => void openSource()}
              className="mt-1 flex w-full items-center gap-1.5 text-left text-sm text-ink transition hover:text-accent"
            >
              <MessageSquare size={13} className="shrink-0 text-accent" />
              <span className="min-w-0 truncate font-medium">{convTitle}</span>
            </button>
            <p className="mt-1.5 text-[11px] text-ink-faint">
              {authorName} · {formatMessageTime(focus.at)}
            </p>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Treść decyzji
            </p>
            <div className="whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-sm leading-relaxed text-ink">
              {focus.body || "(brak treści)"}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Notatka do decyzji
            </span>
            <textarea
              value={decisionNote}
              onChange={(e) => {
                const next = e.target.value;
                setDecisionNote(next);
                persistDecisionNote(next);
              }}
              readOnly={!canEditDecision}
              rows={6}
              placeholder="Dopisz ustalenia, kontekst, kolejne kroki…"
              className="w-full resize-y rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-accent/50 read-only:opacity-80"
            />
            <p className="mt-1 text-[10px] text-ink-faint">
              Widoczna i edytowalna dla wszystkich w tej rozmowie.
            </p>
          </label>
          {labelsBlock}
          {saveError && <p className="text-[11px] text-red-400">{saveError}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="truncate text-[11px] text-ink-faint">{convTitle}</p>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Tytuł
            </span>
            <input
              value={title}
              onChange={(e) => {
                const next = e.target.value;
                setTitle(next);
                persistNote(next, body);
              }}
              readOnly={!canEditNote}
              placeholder="Tytuł notatki"
              className="w-full rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-sm font-semibold text-ink outline-none placeholder:text-ink-faint focus:border-accent/50 read-only:opacity-80"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Treść
            </span>
            <textarea
              value={body}
              onChange={(e) => {
                const next = e.target.value;
                setBody(next);
                persistNote(title, next);
              }}
              readOnly={!canEditNote}
              rows={8}
              placeholder="Treść notatki…"
              className="w-full resize-y rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-accent/50 read-only:opacity-80"
            />
          </label>
          {labelsBlock}
          {saveError && <p className="text-[11px] text-red-400">{saveError}</p>}
          <p className="text-[11px] text-ink-faint">
            {authorName} · {formatMessageTime(focus.at)}
          </p>
          {!canEditNote && (
            <p className="text-[11px] text-ink-faint">
              Edycja treści dostępna tylko dla autora notatki.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-1">
        {focus.messageId && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void openSource()}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
          >
            <ExternalLink size={14} className="text-accent" /> Pokaż w rozmowie
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => convertToItem("task")}
          className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
        >
          <CheckSquare size={14} className="text-ink-faint" /> Utwórz zadanie
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => convertToItem("event")}
          className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
        >
          <CalendarPlus size={14} className="text-ink-faint" /> Utwórz wydarzenie
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void crossConvert()}
          className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
        >
          {isDecision ? (
            <>
              <StickyNote size={14} className="text-ink-faint" /> Zapisz jako notatkę
            </>
          ) : (
            <>
              <Gavel size={14} className="text-ink-faint" /> Zapisz jako decyzję
            </>
          )}
        </button>
        {focus.createdBy === myUserId && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-xs text-red-400 transition hover:bg-surface-raised"
          >
            {isDecision ? (
              <>
                <Undo2 size={14} /> Cofnij decyzję
              </>
            ) : (
              <>
                <Undo2 size={14} /> Cofnij notatkę
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );

  if (presentation === "sheet") {
    return createPortal(
      <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
        <button
          type="button"
          className="absolute inset-0 bg-black/50"
          aria-label="Zamknij"
          onClick={onClose}
        />
        <div className="relative flex max-h-[85vh] min-h-[50vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface-overlay p-3 shadow-pop sm:rounded-2xl">
          {header}
          {content}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      {content}
    </div>
  );
}

/**
 * Detal decyzji/notatki w prawym panelu (hub → klik).
 */
export function RegistryDetailPanel() {
  const focus = useChatStore((s) => s.registryFocus);
  const setRegistryFocus = useChatStore((s) => s.setRegistryFocus);

  if (!focus) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-faint">
        Wybierz wpis z listy w hubie.
      </div>
    );
  }

  return (
    <RegistryDetailBody
      focus={focus}
      onFocusChange={setRegistryFocus}
      onClose={() => {
        setRegistryFocus(null);
        showTodoInPanel();
      }}
      presentation="panel"
    />
  );
}

/** Overlay nad rozmową — pełny detal jak w panelu hubu. */
export function RegistryDetailSheet({
  focus,
  onClose,
}: {
  focus: RegistryFocus;
  onClose: () => void;
}) {
  const [local, setLocal] = useState(focus);
  useEffect(() => {
    setLocal(focus);
  }, [focus]);

  return (
    <RegistryDetailBody
      focus={local}
      onFocusChange={setLocal}
      onClose={onClose}
      presentation="sheet"
    />
  );
}
