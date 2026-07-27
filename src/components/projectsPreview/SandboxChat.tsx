import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Hash, Send } from "lucide-react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import { searchProjects } from "@/lib/projectsPreview/search";
import {
  applyProjectRef,
  projectQueryAt,
} from "@/lib/projectsPreview/projectRefs";
import {
  projectLabel,
  type PreviewChatMessage,
  type ProjectRefEntity,
} from "@/lib/projectsPreview/types";
import { ProjectChip } from "./ProjectChip";
import { ProjectChipPanel } from "./ProjectChipPanel";

interface SandboxChatProps {
  onBack: () => void;
  onOpenProject: (projectId: string) => void;
  initialFilterProjectId?: string | null;
}

export function SandboxChat({
  onBack,
  onOpenProject,
  initialFilterProjectId = null,
}: SandboxChatProps) {
  const repo = useProjectsPreviewRepo();
  const [filterProjectId, setFilterProjectId] = useState<string | null>(
    initialFilterProjectId,
  );
  const messages = repo.listMessages(filterProjectId);
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [pendingRefs, setPendingRefs] = useState<ProjectRefEntity[]>([]);
  const [chipPanelId, setChipPanelId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFilterProjectId(initialFilterProjectId ?? null);
  }, [initialFilterProjectId]);

  const query = projectQueryAt(draft, caret);
  const pickerHits = (() => {
    if (!query) return [];
    const visible = repo.visibleProjectList({ status: "active" });
    return searchProjects(visible, query.query).slice(0, 8);
  })();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const pickProject = (projectId: string) => {
    const p = repo.getProjectIfVisible(projectId);
    if (!p || !query) return;
    const label = projectLabel(p);
    const next = applyProjectRef(draft, caret, query, label);
    setDraft(next.text);
    setCaret(next.caret);
    setPendingRefs((prev) => {
      if (prev.some((r) => r.entityId === p.id)) return prev;
      return [
        ...prev,
        {
          entityType: "project",
          entityId: p.id,
          projectNumber: p.number,
          labelSnapshot: label,
        },
      ];
    });
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    try {
      repo.sendMessage(body, pendingRefs);
      setDraft("");
      setCaret(0);
      setPendingRefs([]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Nie udało się wysłać.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
          aria-label="Wróć"
        >
          <ArrowLeft size={18} />
        </button>
        <Hash size={15} className="text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">Czat demo</h2>
          <p className="truncate text-[11px] text-ink-faint">
            Lokalne wiadomości preview · tylko członkowie mogą oznaczać #
          </p>
        </div>
      </div>

      {filterProjectId ? (
        <div className="flex items-center gap-2 border-b border-line bg-accent/5 px-3 py-1.5 text-[11px] text-ink-light">
          <span className="min-w-0 flex-1 truncate">
            Filtr: {repo.projectDisplay(filterProjectId)}
          </span>
          <button
            type="button"
            onClick={() => setFilterProjectId(null)}
            className="shrink-0 text-accent hover:underline"
          >
            Wyczyść
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto thin-scrollbar px-3 py-3 sm:px-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-faint">
            Brak wiadomości w tym widoku.
          </p>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              author={repo.userName(m.authorUserId)}
              onChipClick={(id) => setChipPanelId(id)}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {chipPanelId ? (
        <div className="border-t border-line px-3 py-2 sm:px-4">
          <ProjectChipPanel
            projectId={chipPanelId}
            onClose={() => setChipPanelId(null)}
            onOpenProject={(id) => {
              setChipPanelId(null);
              onOpenProject(id);
            }}
            onFilterMessages={(id) => {
              setChipPanelId(null);
              setFilterProjectId(id);
            }}
          />
        </div>
      ) : null}

      <div className="relative shrink-0 border-t border-line px-3 py-2 sm:px-4">
        {query && pickerHits.length > 0 ? (
          <div className="absolute bottom-full left-3 right-3 mb-1 max-h-48 overflow-y-auto thin-scrollbar rounded-xl border border-line bg-surface-overlay py-1 shadow-pop sm:left-4 sm:right-4">
            {pickerHits.map(({ project }) => (
              <button
                key={project.id}
                type="button"
                onClick={() => pickProject(project.id)}
                className="flex w-full flex-col px-3 py-2 text-left transition hover:bg-surface-raised"
              >
                <span className="text-sm font-medium text-ink">
                  {projectLabel(project)}
                </span>
              </button>
            ))}
          </div>
        ) : query ? (
          <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border border-line bg-surface-overlay px-3 py-2 text-xs text-ink-faint shadow-pop sm:left-4 sm:right-4">
            Brak dostępnych projektów dla „#{query.query}”
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            rows={2}
            placeholder="Napisz wiadomość… użyj # aby oznaczyć projekt"
            onChange={(e) => {
              setDraft(e.target.value);
              setCaret(e.target.selectionStart);
            }}
            onSelect={(e) =>
              setCaret((e.target as HTMLTextAreaElement).selectionStart)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className="min-h-[2.75rem] min-w-0 flex-1 resize-none rounded-xl border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim()}
            className="shrink-0 rounded-xl bg-accent-grad p-2.5 text-white shadow-glow transition hover:brightness-110 disabled:opacity-40"
            aria-label="Wyślij"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  author,
  onChipClick,
}: {
  message: PreviewChatMessage;
  author: string;
  onChipClick: (projectId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface-raised/30 px-3 py-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{author}</span>
        <span className="text-[10px] text-ink-faint">
          {new Date(message.createdAt).toLocaleString("pl-PL", {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-ink">
        {message.body}
      </p>
      {message.projectRefs.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {message.projectRefs.map((r) => (
            <ProjectChip
              key={`${message.id}-${r.entityId}`}
              refEntity={r}
              onClick={() => onChipClick(r.entityId)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
