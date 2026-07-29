import { useMemo, useState } from "react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import type { ScheduleEvent, ScheduleEventKind } from "@/lib/projectsPreview/types";
import { ScheduleEventSheet, type ScheduleEventDraft } from "./ScheduleEventSheet";
import { ScheduleEventsTable } from "./ScheduleEventsTable";

interface EventsViewProps {
  kind: ScheduleEventKind;
  /** Shared filtr budów from the shell („all” or selected ids). */
  projectIds?: string[] | "all";
}

/**
 * Sekcja Zdarzenia: tabela budowlanych albo dokumentacyjnych
 * (nie Gantt — ten żyje wyłącznie w Tablicy).
 */
export function EventsView({ kind, projectIds = "all" }: EventsViewProps) {
  const repo = useProjectsPreviewRepo();
  const state = repo.getState();
  const [edit, setEdit] = useState<{
    event: ScheduleEvent | null;
    projectId: string;
  } | null>(null);

  const projects = useMemo(() => {
    const visible = state.projects.filter(
      (p) =>
        p.adminUserId === state.viewAsUserId ||
        p.memberIds.includes(state.viewAsUserId),
    );
    if (projectIds === "all") return visible;
    const wanted = new Set(projectIds);
    return visible.filter((p) => wanted.has(p.id));
  }, [state.projects, state.viewAsUserId, projectIds]);

  const scopeIds = useMemo(
    () => new Set(projects.map((p) => p.id)),
    [projects],
  );

  const events = useMemo(
    () =>
      state.scheduleEvents.filter(
        (e) => e.kind === kind && scopeIds.has(e.projectId),
      ),
    [state.scheduleEvents, kind, scopeIds],
  );

  const blocks = useMemo(
    () => state.scheduleBlocks.filter((b) => scopeIds.has(b.projectId)),
    [state.scheduleBlocks, scopeIds],
  );

  const defaultProjectId = projects[0]?.id ?? "";

  const openCreate = () => {
    if (!defaultProjectId) {
      alert("Najpierw dodaj budowę na Liście.");
      return;
    }
    setEdit({ event: null, projectId: defaultProjectId });
  };

  const save = (data: ScheduleEventDraft) => {
    repo.upsertScheduleEvent(data);
    setEdit(null);
  };

  return (
    <>
      <ScheduleEventsTable
        kind={kind}
        events={events}
        projects={projects}
        blocks={blocks}
        onEdit={(event) =>
          setEdit({ event, projectId: event.projectId })
        }
        onAdd={openCreate}
      />
      {edit ? (
        <ScheduleEventSheet
          projectId={edit.projectId}
          blocks={blocks.filter((b) => b.projectId === edit.projectId)}
          blockId={edit.event?.blockId ?? null}
          defaultCategoryId={edit.event?.categoryId}
          event={edit.event}
          defaultKind={kind}
          lockKind
          catalog={state.catalog}
          scheduleCatalog={state.scheduleCatalog}
          onClose={() => setEdit(null)}
          onSave={save}
          onDelete={
            edit.event
              ? () => {
                  repo.deleteScheduleEvent(edit.event!.id);
                  setEdit(null);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}
