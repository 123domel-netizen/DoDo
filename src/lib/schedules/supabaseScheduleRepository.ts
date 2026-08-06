import { buildNadzorPodstawowyPreset } from "@/lib/projectsPreview/catalogPreset";
import {
  LocalPreviewAdapter,
  type ProjectsPreviewRepository,
  type ScheduleEventInput,
  type ScheduleEventQuery,
} from "@/lib/projectsPreview/repository";
import { buildBudowaScheduleCatalog } from "@/lib/projectsPreview/scheduleCatalog";
import type { ScheduleCatalogPreset } from "@/lib/projectsPreview/scheduleCatalog";
import { buildProjectSchedulePreset } from "@/lib/projectsPreview/schedulePresetSeed";
import { normalizeProjectCode } from "@/lib/projectsPreview/types";
import { normalizeWorkerList, totalLaborHours } from "@/lib/projectsPreview/workerShifts";
import type {
  CrewAttendance,
  CrewAttendanceStatus,
  CrewEquipmentLog,
  DocEventStatus,
  PreviewCrew,
  PreviewProject,
  PreviewUser,
  ProjectsPreviewState,
  ProjectStatus,
  ScheduleBlock,
  ScheduleCategoryMeta,
  ScheduleEvent,
  SupervisionCatalogCategory,
  SupervisionCatalogPreset,
} from "@/lib/projectsPreview/types";
import { cloudEnabled, supabase } from "@/lib/supabase";
import type { ScheduleRepository } from "./scheduleRepositoryPort";

type BundleRow = {
  projects: PreviewProject[];
  users: PreviewUser[];
  crews: PreviewCrew[];
  scheduleBlocks: ScheduleBlock[];
  scheduleEvents: ScheduleEvent[];
  categoryMeta: ScheduleCategoryMeta[];
  crewAttendance: CrewAttendance[];
  crewEquipmentLogs: CrewEquipmentLog[];
  catalog: SupervisionCatalogPreset;
  scheduleCatalog: ScheduleCatalogPreset;
  nextNumberHint: number;
};

const cache = new Map<string, SupabaseScheduleRepository>();

/** Postgres uuid columns reject local demo ids like `se-abc123`. */
function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}

function asCloudId(id: string | undefined): string {
  return id && isUuid(id) ? id : crypto.randomUUID();
}

function normalizeLoadedEventTime(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const t = String(raw).trim();
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function getSupabaseScheduleRepo(
  orgId: string,
  userId: string,
): SupabaseScheduleRepository {
  const key = `${orgId}:${userId}`;
  let repo = cache.get(key);
  if (!repo || repo.orgId !== orgId) {
    repo = new SupabaseScheduleRepository(orgId, userId);
    cache.set(key, repo);
  }
  return repo;
}

export function resetSupabaseScheduleRepo() {
  cache.clear();
}

export class SupabaseScheduleRepository implements ScheduleRepository {
  readonly mode = "cloud" as const;
  readonly orgId: string;
  private userId: string;
  private inner: ProjectsPreviewRepository;
  private loadPromise: Promise<void>;
  private loadError: string | null = null;
  /** Optimistic deletes — survive focus/reload until cloud confirms. */
  private pendingDeletedBlockIds = new Set<string>();
  private pendingDeletedEventIds = new Set<string>();
  private pendingDeletedCrewIds = new Set<string>();
  private pendingDeletedCategoryKeys = new Set<string>();
  private pendingDeletedAttendanceIds = new Set<string>();
  /** Optimistic attendance upserts — reload must not wipe unsynced RH. */
  private pendingAttendance = new Map<string, CrewAttendance>();
  private pendingEquipment = new Map<string, CrewEquipmentLog[]>();
  /** Optimistic date moves — focus reload must not snap bars back. */
  private pendingBlockDates = new Map<
    string,
    { startDate: string; endDate: string }
  >();
  private pendingCategoryMeta = new Map<string, ScheduleCategoryMeta>();

  constructor(orgId: string, userId: string) {
    this.orgId = orgId;
    this.userId = userId;
    this.inner = new LocalPreviewAdapter(emptyCloudState(orgId, userId), {
      skipStorage: true,
    });
    this.loadPromise = this.loadFromCloud();
  }

  private async ensureLoaded() {
    await this.loadPromise;
    if (this.loadError) throw new Error(this.loadError);
  }

  getState(): ProjectsPreviewState {
    return this.inner.getState();
  }

  subscribe(fn: () => void): () => void {
    return this.inner.subscribe(fn);
  }

  currentUserId(): string {
    return this.userId;
  }

  visibleProjectList(
    opts?: Parameters<ScheduleRepository["visibleProjectList"]>[0],
  ) {
    return this.inner.visibleProjectList(opts);
  }

  getProjectLastEvent(projectId: string) {
    return this.inner.getProjectLastEvent(projectId);
  }

  getProjectIfVisible(id: string) {
    return this.inner.getProjectIfVisible(id);
  }

  numberExists(number: string, excludeId?: string) {
    return this.inner.numberExists(number, excludeId);
  }

  suggestNextNumber() {
    return this.inner.suggestNextNumber();
  }

  createProject(
    input: Parameters<ScheduleRepository["createProject"]>[0],
  ): ReturnType<ScheduleRepository["createProject"]> {
    void this.createProjectSync(input).then((res) => {
      if (!res.ok) console.warn("[schedules] create:", res.error);
    });
    return { ok: false, error: "Zapis w chmurze…" };
  }

  async createProjectSync(
    input: Parameters<ScheduleRepository["createProject"]>[0],
  ): Promise<{ ok: true; project: PreviewProject } | { ok: false; error: string }> {
    if (!cloudEnabled || !supabase) {
      return { ok: false, error: "Brak połączenia z chmurą." };
    }
    await this.ensureLoaded();

    const code = normalizeProjectCode(input.number);
    if (!code) return { ok: false, error: "Podaj numer lub ID budowy." };
    if (!input.name.trim()) return { ok: false, error: "Nazwa jest wymagana." };
    if (this.inner.numberExists(code)) {
      return { ok: false, error: "Numer już istnieje w zespole." };
    }

    const hasPreset =
      Boolean(input.schedulePreset?.startDate) &&
      Boolean(input.schedulePreset?.endDate);

    const tempProjectId = crypto.randomUUID();
    let blocks: ScheduleBlock[] = [];
    let categoryMeta: ScheduleCategoryMeta[] = [];

    if (hasPreset && input.schedulePreset) {
      const seeded = buildProjectSchedulePreset({
        projectId: tempProjectId,
        startDate: input.schedulePreset.startDate,
        endDate: input.schedulePreset.endDate,
        catalog: this.inner.getState().scheduleCatalog,
        uid: () => crypto.randomUUID(),
      });
      blocks = seeded.blocks;
      categoryMeta = seeded.categoryMeta;
    }

    const { data, error } = await supabase.rpc("create_project_with_schedule_preset", {
      p_org_id: this.orgId,
      p_number: code,
      p_name: input.name.trim(),
      p_member_ids: input.memberIds,
      p_schedule_preset: hasPreset,
      p_start_date: input.schedulePreset?.startDate ?? null,
      p_end_date: input.schedulePreset?.endDate ?? null,
      p_blocks: blocks,
      p_category_meta: categoryMeta,
    });

    if (error) {
      const msg = error.message.includes("number exists")
        ? "Numer już istnieje w zespole."
        : error.message;
      return { ok: false, error: msg };
    }

    await this.reload();
    const row = data as {
      id: string;
      number: string;
      name: string;
      adminUserId: string;
      memberIds: string[];
      createdAt: string;
    };
    return {
      ok: true,
      project: {
        id: row.id,
        orgId: this.orgId,
        number: row.number,
        name: row.name,
        adminUserId: row.adminUserId,
        memberIds: (row.memberIds as string[]) ?? [this.userId],
        createdAt: row.createdAt,
        status: "active",
      },
    };
  }

  importProjects(
    rows: { number: string; name: string }[],
  ): ReturnType<ScheduleRepository["importProjects"]> {
    void this.importProjectsSync(rows);
    return { ok: false, error: "Import w chmurze…" };
  }

  async importProjectsSync(
    rows: { number: string; name: string }[],
  ): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
    await this.ensureLoaded();
    for (const r of rows) {
      const res = await this.createProjectSync({
        number: r.number,
        name: r.name,
        memberIds: [],
      });
      if (!res.ok) return res;
    }
    return { ok: true, count: rows.length };
  }

  updateProject(
    id: string,
    patch: Partial<
      Pick<PreviewProject, "number" | "name" | "memberIds" | "status">
    >,
  ): ReturnType<ScheduleRepository["updateProject"]> {
    const local = this.inner.updateProject(id, patch);
    if (local.ok) void this.updateProjectSync(id, patch);
    return local;
  }

  async updateProjectSync(
    id: string,
    patch: Partial<
      Pick<PreviewProject, "number" | "name" | "memberIds" | "status">
    >,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!supabase) return { ok: false, error: "Brak chmury." };
    await this.ensureLoaded();
    const p = this.inner.getState().projects.find((x: PreviewProject) => x.id === id);
    if (!p) return { ok: false, error: "Brak budowy." };

    let number = p.number;
    if (patch.number !== undefined) {
      number = normalizeProjectCode(patch.number);
    }

    const { error } = await supabase
      .from("construction_projects")
      .update({
        number,
        name: patch.name?.trim() ?? p.name,
        status: patch.status ?? p.status,
      })
      .eq("id", id);

    if (error) return { ok: false, error: error.message };

    if (patch.memberIds) {
      const members = Array.from(new Set([p.adminUserId, ...patch.memberIds]));
      await supabase
        .from("construction_project_members")
        .delete()
        .eq("project_id", id);
      if (members.length) {
        await supabase.from("construction_project_members").insert(
          members.map((user_id) => ({ project_id: id, user_id })),
        );
      }
    }

    await this.reload();
    return { ok: true };
  }

  resetCatalogPreset() {
    const preset = buildNadzorPodstawowyPreset();
    this.inner.resetCatalogPreset();
    void this.saveCatalog("supervision", preset);
  }

  updateSupervisionCatalog(categories: SupervisionCatalogCategory[]) {
    this.inner.updateSupervisionCatalog(categories);
    const state = this.inner.getState();
    void this.saveCatalog("supervision", state.catalog);
  }

  reclassifyProjectCategory(
    projectId: string,
    fromCategoryId: string,
    toCategoryId: string,
  ) {
    this.inner.reclassifyProjectCategory(projectId, fromCategoryId, toCategoryId);
    void this.syncReclassify(projectId, fromCategoryId, toCategoryId);
  }

  upsertCategoryMeta(
    input: Parameters<ScheduleRepository["upsertCategoryMeta"]>[0],
  ) {
    const row = this.inner.upsertCategoryMeta(input);
    void this.syncCategoryMeta(row);
    return row;
  }

  removeProjectCategory(projectId: string, categoryId: string) {
    const result = this.inner.removeProjectCategory(projectId, categoryId);
    for (const id of result.deletedBlockIds) this.pendingDeletedBlockIds.add(id);
    for (const id of result.deletedEventIds) this.pendingDeletedEventIds.add(id);
    this.pendingDeletedCategoryKeys.add(`${projectId}:${categoryId}`);
    void this.persistCategoryRemoval(projectId, categoryId, result);
    return result;
  }

  /**
   * Cloud FK only nulls event.block_id on block delete — events keep category_id
   * and a later reload brings the category lane back. Persist full removal.
   */
  private async persistCategoryRemoval(
    projectId: string,
    categoryId: string,
    result: {
      deletedBlockIds: string[];
      deletedEventIds: string[];
      touchedEventIds: string[];
    },
  ) {
    if (!supabase) return;
    const blockIds = result.deletedBlockIds.filter(isUuid);
    if (blockIds.length) {
      const { error } = await supabase
        .from("schedule_blocks")
        .delete()
        .in("id", blockIds);
      if (error) {
        console.warn("[schedules] delete category blocks failed:", error.message);
      } else {
        for (const id of blockIds) this.pendingDeletedBlockIds.delete(id);
      }
    } else {
      for (const id of result.deletedBlockIds) this.pendingDeletedBlockIds.delete(id);
    }

    const eventIds = result.deletedEventIds.filter(isUuid);
    if (eventIds.length) {
      const { error } = await supabase
        .from("schedule_events")
        .delete()
        .in("id", eventIds);
      if (error) {
        console.warn("[schedules] delete category events failed:", error.message);
      } else {
        for (const id of eventIds) this.pendingDeletedEventIds.delete(id);
      }
    } else {
      for (const id of result.deletedEventIds) this.pendingDeletedEventIds.delete(id);
    }

    const { error: metaErr } = await supabase
      .from("schedule_category_meta")
      .delete()
      .eq("project_id", projectId)
      .eq("category_id", categoryId);
    if (metaErr) {
      console.warn("[schedules] delete category meta failed:", metaErr.message);
    } else {
      this.pendingDeletedCategoryKeys.delete(`${projectId}:${categoryId}`);
    }

    // Remapped events (np. dokumentacyjne) — upsert bez reload przy błędzie,
    // żeby nie przywrócić właśnie usuniętej kategorii.
    const touched = result.touchedEventIds.filter(isUuid);
    if (touched.length === 0) return;
    const events = this.inner
      .listScheduleEvents()
      .filter((e) => touched.includes(e.id));
    for (const row of events) {
      const { error } = await supabase.from("schedule_events").upsert({
        id: row.id,
        project_id: row.projectId,
        block_id: row.blockId && isUuid(row.blockId) ? row.blockId : null,
        kind: row.kind,
        title: row.title,
        event_date: row.date,
        event_time: row.time ? `${row.time}:00` : null,
        note: row.note,
        category_id: row.categoryId ?? null,
        status: row.status ?? null,
        activity: row.activity ?? null,
        custom_label: row.customLabel ?? null,
        written_at: row.writtenAt ?? null,
        reported_by_user_id: row.reportedByUserId ?? null,
        written_by_user_id: row.writtenByUserId ?? null,
      });
      if (error) {
        console.warn("[schedules] remap category event failed:", error.message);
      }
    }
  }

  moveCategoryWindow(
    projectId: string,
    categoryId: string,
    startDate: string,
    endDate: string,
    opts?: { shiftChildrenByDays?: number },
  ) {
    this.inner.moveCategoryWindow(
      projectId,
      categoryId,
      startDate,
      endDate,
      opts,
    );
    const meta = this.inner.getCategoryMeta(projectId, categoryId);
    if (meta) {
      this.pendingCategoryMeta.set(`${projectId}:${categoryId}`, meta);
      void this.syncCategoryMeta(meta);
    }
    if (opts?.shiftChildrenByDays) {
      const cat = meta?.categoryId ?? categoryId;
      const touched = this.inner
        .listSchedule(projectId)
        .filter((b) => b.categoryId === cat);
      for (const b of touched) {
        this.pendingBlockDates.set(b.id, {
          startDate: b.startDate,
          endDate: b.endDate,
        });
      }
      void this.syncBlocks(touched);
    }
  }

  getCategoryMeta(projectId: string, categoryId: string) {
    return this.inner.getCategoryMeta(projectId, categoryId);
  }

  listSchedule(projectId?: string) {
    return this.inner.listSchedule(projectId);
  }

  crewConflicts(projectIds?: string[]) {
    return this.inner.crewConflicts(projectIds);
  }

  crewWorkCount(crewId: string) {
    return this.inner.crewWorkCount(crewId);
  }

  seedScheduleTemplate(projectId: string) {
    const before = new Set(this.inner.getState().scheduleBlocks.map((b) => b.id));
    this.inner.seedScheduleTemplate(projectId);
    this.rewriteNonUuidBlockIds(before);
    const toSync = this.inner
      .listSchedule(projectId)
      .filter((b) => !before.has(b.id));
    void this.syncBlocks(toSync);
    return toSync;
  }

  upsertCrew(crew: Omit<PreviewCrew, "id"> & { id?: string }) {
    const before = new Map(
      this.inner.getState().scheduleBlocks.map((b) => [b.id, b.color] as const),
    );
    const row = this.inner.upsertCrew({
      ...crew,
      id: asCloudId(crew.id),
    });
    void this.syncCrew(row);
    const recolored = this.inner
      .getState()
      .scheduleBlocks.filter((b) => before.get(b.id) !== b.color);
    if (recolored.length) void this.syncBlocks(recolored);
    return row;
  }

  deleteCrew(id: string) {
    const res = this.inner.deleteCrew(id);
    if (!res.ok) return res;
    this.pendingDeletedCrewIds.add(id);
    void this.persistCrewDeletion(id);
    return res;
  }

  listAttendance(
    from: string,
    to: string,
    opts?: { projectIds?: string[] | "all"; companyKey?: string },
  ) {
    return this.inner.listAttendance(from, to, opts);
  }

  upsertCrewAttendance(
    input: Parameters<ScheduleRepository["upsertCrewAttendance"]>[0],
  ) {
    const equipment =
      input.equipment !== undefined
        ? input.equipment.map((e) => ({
            ...e,
            id: asCloudId(e.id),
          }))
        : undefined;
    const workers =
      input.workers !== undefined
        ? normalizeWorkerList(input.workers)
        : undefined;
    const row = this.inner.upsertCrewAttendance({
      ...input,
      id: asCloudId(input.id),
      equipment,
      workers,
    });
    const logs = this.inner
      .getState()
      .crewEquipmentLogs.filter((e) => e.attendanceId === row.id);
    this.pendingDeletedAttendanceIds.delete(row.id);
    this.pendingAttendance.set(row.id, { ...row });
    this.pendingEquipment.set(
      row.id,
      logs.map((e) => ({ ...e })),
    );
    void this.syncAttendance(row, logs);
    return row;
  }

  deleteCrewAttendance(id: string) {
    this.inner.deleteCrewAttendance(id);
    this.pendingAttendance.delete(id);
    this.pendingEquipment.delete(id);
    this.pendingDeletedAttendanceIds.add(id);
    void this.persistAttendanceDeletion(id);
  }

  setAttendanceStatus(id: string, status: CrewAttendanceStatus) {
    this.inner.setAttendanceStatus(id, status);
    const row = this.inner.getState().crewAttendance.find((a) => a.id === id);
    if (!row) return;
    const logs = this.inner
      .getState()
      .crewEquipmentLogs.filter((e) => e.attendanceId === id);
    this.pendingAttendance.set(row.id, { ...row });
    this.pendingEquipment.set(
      row.id,
      logs.map((e) => ({ ...e })),
    );
    void this.syncAttendance(row, logs);
  }

  private async syncAttendance(
    row: CrewAttendance,
    logs: CrewEquipmentLog[],
  ) {
    if (!supabase) return;
    if (!isUuid(row.crewId) || !isUuid(row.projectId)) {
      console.warn(
        "[schedules] sync attendance skipped: crew/project id is not a UUID",
        row.crewId,
        row.projectId,
      );
      return;
    }

    // Reuse cloud row for unique (crew, project, day) so we don't dual-insert.
    let cloudId = row.id;
    const { data: existing, error: findErr } = await supabase
      .from("construction_crew_attendance")
      .select("id")
      .eq("crew_id", row.crewId)
      .eq("project_id", row.projectId)
      .eq("work_date", row.workDate)
      .maybeSingle();
    if (findErr) {
      console.warn(
        "[schedules] lookup attendance failed:",
        findErr.message,
        "— czy migracja 0057 jest na remote?",
      );
      return;
    }
    if (existing?.id && isUuid(existing.id) && existing.id !== row.id) {
      cloudId = existing.id;
      this.adoptAttendanceId(row.id, cloudId);
    } else if (!isUuid(cloudId)) {
      cloudId = crypto.randomUUID();
      this.adoptAttendanceId(row.id, cloudId);
    }

    const latest =
      this.inner.getState().crewAttendance.find((a) => a.id === cloudId) ?? {
        ...row,
        id: cloudId,
      };
    const latestLogsRaw = this.inner
      .getState()
      .crewEquipmentLogs.filter((e) => e.attendanceId === cloudId);
    const latestLogs = latestLogsRaw.length ? latestLogsRaw : logs;

    const basePayload = {
      id: cloudId,
      org_id: this.orgId,
      crew_id: latest.crewId,
      project_id: latest.projectId,
      work_date: latest.workDate,
      headcount: latest.headcount,
      labor_hours: latest.laborHours,
      status: latest.status,
      note: latest.note,
      created_by:
        latest.createdByUserId && isUuid(latest.createdByUserId)
          ? latest.createdByUserId
          : null,
      confirmed_by:
        latest.confirmedByUserId && isUuid(latest.confirmedByUserId)
          ? latest.confirmedByUserId
          : null,
      confirmed_at: latest.confirmedAt,
      updated_at: new Date().toISOString(),
    };

    let { error } = await supabase.from("construction_crew_attendance").upsert({
      ...basePayload,
      workers: latest.workers,
    });
    if (error && /workers/i.test(error.message)) {
      console.warn(
        "[schedules] attendance.workers missing — sync without column (run 0058):",
        error.message,
      );
      ({ error } = await supabase
        .from("construction_crew_attendance")
        .upsert(basePayload));
    }
    if (error) {
      console.warn("[schedules] sync attendance failed:", error.message);
      this.pendingAttendance.set(cloudId, { ...latest });
      this.pendingEquipment.set(
        cloudId,
        latestLogs.map((e) => ({ ...e })),
      );
      return;
    }

    const { error: delErr } = await supabase
      .from("construction_crew_equipment_logs")
      .delete()
      .eq("attendance_id", cloudId);
    if (delErr) {
      console.warn("[schedules] clear equipment failed:", delErr.message);
      return;
    }
    if (latestLogs.length) {
      const { error: insErr } = await supabase
        .from("construction_crew_equipment_logs")
        .insert(
          latestLogs.map((e) => ({
            id: asCloudId(e.id),
            attendance_id: cloudId,
            equipment_key: e.equipmentKey,
            equipment_label: e.equipmentLabel,
            quantity: e.quantity,
            hours: e.hours,
          })),
        );
      if (insErr) {
        console.warn("[schedules] sync equipment failed:", insErr.message);
        return;
      }
    }

    this.pendingAttendance.delete(cloudId);
    this.pendingEquipment.delete(cloudId);
    this.pendingDeletedAttendanceIds.delete(cloudId);
  }

  /** Point local attendance + equipment + pending maps at the cloud id. */
  private adoptAttendanceId(fromId: string, toId: string) {
    if (fromId === toId) return;
    const state = this.inner.getState();
    const row = state.crewAttendance.find((a) => a.id === fromId);
    if (!row) return;
    const crewAttendance = [
      ...state.crewAttendance.filter((a) => a.id !== fromId && a.id !== toId),
      { ...row, id: toId },
    ];
    const crewEquipmentLogs = state.crewEquipmentLogs.map((e) =>
      e.attendanceId === fromId ? { ...e, attendanceId: toId } : e,
    );
    this.inner.hydrate({
      ...state,
      crewAttendance,
      crewEquipmentLogs,
    });
    const pendingRow = this.pendingAttendance.get(fromId);
    if (pendingRow) {
      this.pendingAttendance.delete(fromId);
      this.pendingAttendance.set(toId, { ...pendingRow, id: toId });
    }
    const pendingLogs = this.pendingEquipment.get(fromId);
    if (pendingLogs) {
      this.pendingEquipment.delete(fromId);
      this.pendingEquipment.set(
        toId,
        pendingLogs.map((e) => ({ ...e, attendanceId: toId })),
      );
    }
    if (this.pendingDeletedAttendanceIds.has(fromId)) {
      this.pendingDeletedAttendanceIds.delete(fromId);
      this.pendingDeletedAttendanceIds.add(toId);
    }
  }

  private async persistAttendanceDeletion(id: string) {
    if (!supabase || !isUuid(id)) {
      if (!isUuid(id)) this.pendingDeletedAttendanceIds.delete(id);
      return;
    }
    const { error } = await supabase
      .from("construction_crew_attendance")
      .delete()
      .eq("id", id);
    if (error) {
      console.warn("[schedules] delete attendance failed:", error.message);
      return;
    }
    this.pendingDeletedAttendanceIds.delete(id);
  }

  private async persistCrewDeletion(id: string) {
    if (!supabase) {
      this.pendingDeletedCrewIds.delete(id);
      return;
    }
    if (!isUuid(id)) {
      this.pendingDeletedCrewIds.delete(id);
      return;
    }
    const { error } = await supabase
      .from("construction_crews")
      .delete()
      .eq("id", id);
    if (error) {
      console.warn("[schedules] delete crew failed:", error.message);
      return;
    }
    this.pendingDeletedCrewIds.delete(id);
  }

  upsertScheduleBlock(block: Omit<ScheduleBlock, "id"> & { id?: string }) {
    const categoryId = block.categoryId || "stan-0";
    const hadMeta = Boolean(
      this.inner.getCategoryMeta(block.projectId, categoryId),
    );
    const row = this.inner.upsertScheduleBlock({
      ...block,
      id: asCloudId(block.id),
    });
    this.pendingBlockDates.set(row.id, {
      startDate: row.startDate,
      endDate: row.endDate,
    });
    void this.syncBlock(row);
    if (!hadMeta) {
      const meta = this.inner.getCategoryMeta(row.projectId, row.categoryId);
      if (meta) void this.syncCategoryMeta(meta);
    }
    return row;
  }

  promoteToSubcategory(blockId: string) {
    const before = new Set(this.inner.getState().scheduleBlocks.map((b) => b.id));
    const row = this.inner.promoteToSubcategory(blockId);
    if (!row) return row;
    this.rewriteNonUuidBlockIds(before);
    const parent = this.inner.getState().scheduleBlocks.find((b) => b.id === row.id) ?? row;
    const children = this.inner
      .getState()
      .scheduleBlocks.filter((b) => b.parentId === parent.id && !before.has(b.id));
    void this.syncBlocks([parent, ...children]);
    return parent;
  }

  demoteSubcategory(id: string, opts?: { keepAsWork?: boolean }) {
    const keepAsWork = opts?.keepAsWork ?? true;
    const stateBefore = this.inner.getState();
    const childrenBefore = stateBefore.scheduleBlocks
      .filter((b) => b.parentId === id)
      .map((b) => b.id);
    const eventIdsToDelete = keepAsWork
      ? []
      : stateBefore.scheduleEvents
          .filter(
            (e) =>
              e.kind === "budowlane" && e.blockId === id,
          )
          .map((e) => e.id);
    const res = this.inner.demoteSubcategory(id, opts);
    if (!res.ok) return res;
    if (!keepAsWork) {
      this.pendingDeletedBlockIds.add(id);
      for (const eid of eventIdsToDelete) this.pendingDeletedEventIds.add(eid);
    }
    void this.persistDemote(id, keepAsWork, childrenBefore, eventIdsToDelete);
    return res;
  }

  private async persistDemote(
    id: string,
    keepAsWork: boolean,
    childIds: string[],
    eventIdsToDelete: string[],
  ) {
    if (!supabase) {
      this.pendingDeletedBlockIds.delete(id);
      for (const eid of eventIdsToDelete) this.pendingDeletedEventIds.delete(eid);
      return;
    }
    const uuidChildren = childIds.filter(isUuid);
    if (uuidChildren.length) {
      const { error } = await supabase
        .from("schedule_blocks")
        .update({ parent_id: null })
        .in("id", uuidChildren);
      if (error) {
        console.warn("[schedules] demote children failed:", error.message);
      }
    }
    if (keepAsWork) {
      const row = this.inner.getState().scheduleBlocks.find((b) => b.id === id);
      if (row) await this.syncBlock(row);
      return;
    }
    const eventUuids = eventIdsToDelete.filter(isUuid);
    if (eventUuids.length) {
      const { error } = await supabase
        .from("schedule_events")
        .delete()
        .in("id", eventUuids);
      if (error) {
        console.warn("[schedules] demote events failed:", error.message);
      } else {
        for (const eid of eventUuids) this.pendingDeletedEventIds.delete(eid);
      }
    } else {
      for (const eid of eventIdsToDelete) this.pendingDeletedEventIds.delete(eid);
    }
    if (!isUuid(id)) {
      this.pendingDeletedBlockIds.delete(id);
      return;
    }
    const { error } = await supabase
      .from("schedule_blocks")
      .delete()
      .eq("id", id);
    if (error) {
      console.warn("[schedules] demote delete failed:", error.message);
      return;
    }
    this.pendingDeletedBlockIds.delete(id);
  }

  deleteScheduleBlock(id: string) {
    const before = this.inner.getState();
    const target = before.scheduleBlocks.find((b) => b.id === id);
    const ids = [
      id,
      ...(target?.role === "subcategory"
        ? before.scheduleBlocks.filter((b) => b.parentId === id).map((b) => b.id)
        : []),
    ];
    const idSet = new Set(ids);
    const eventIds = before.scheduleEvents
      .filter(
        (e) =>
          e.kind === "budowlane" && e.blockId && idSet.has(e.blockId),
      )
      .map((e) => e.id);
    this.inner.deleteScheduleBlock(id);
    for (const x of ids) this.pendingDeletedBlockIds.add(x);
    for (const eid of eventIds) this.pendingDeletedEventIds.add(eid);
    for (const x of ids) this.pendingBlockDates.delete(x);
    void this.persistBlockDeletion(ids, eventIds);
  }

  private async persistBlockDeletion(ids: string[], eventIds: string[]) {
    if (!supabase) {
      for (const id of ids) this.pendingDeletedBlockIds.delete(id);
      for (const eid of eventIds) this.pendingDeletedEventIds.delete(eid);
      return;
    }
    const uuids = ids.filter(isUuid);
    for (const id of ids) {
      if (!isUuid(id)) this.pendingDeletedBlockIds.delete(id);
    }
    const eventUuids = eventIds.filter(isUuid);
    for (const eid of eventIds) {
      if (!isUuid(eid)) this.pendingDeletedEventIds.delete(eid);
    }
    if (eventUuids.length) {
      const { error } = await supabase
        .from("schedule_events")
        .delete()
        .in("id", eventUuids);
      if (error) {
        console.warn("[schedules] delete block events failed:", error.message);
      } else {
        for (const eid of eventUuids) this.pendingDeletedEventIds.delete(eid);
      }
    }
    if (!uuids.length) return;
    const { error } = await supabase
      .from("schedule_blocks")
      .delete()
      .in("id", uuids);
    if (error) {
      console.warn("[schedules] delete blocks failed:", error.message);
      return;
    }
    for (const id of uuids) this.pendingDeletedBlockIds.delete(id);
  }

  moveScheduleBlock(
    id: string,
    startDate: string,
    endDate: string,
    opts?: { shiftChildrenByDays?: number },
  ) {
    this.inner.moveScheduleBlock(id, startDate, endDate, opts);
    const touched = this.inner
      .listSchedule()
      .filter(
        (b) =>
          b.id === id ||
          (Boolean(opts?.shiftChildrenByDays) && b.parentId === id),
      );
    for (const b of touched) {
      this.pendingBlockDates.set(b.id, {
        startDate: b.startDate,
        endDate: b.endDate,
      });
    }
    // Always upsert full rows — bare `.update()` without await never fires
    // in supabase-js thenables, so work-bar moves never reached the cloud.
    void this.syncBlocks(touched);
  }

  listScheduleEvents(
    projectId?: string,
    blockId?: string,
    opts?: ScheduleEventQuery,
  ) {
    return this.inner.listScheduleEvents(projectId, blockId, opts);
  }

  listEventsForBlock(blockId: string, opts?: ScheduleEventQuery) {
    return this.inner.listEventsForBlock(blockId, opts);
  }

  upsertScheduleEvent(event: ScheduleEventInput) {
    const row = this.inner.upsertScheduleEvent({
      ...event,
      id: asCloudId(event.id),
    });
    void this.syncEvent(row);
    return row;
  }

  deleteScheduleEvent(id: string) {
    this.inner.deleteScheduleEvent(id);
    this.pendingDeletedEventIds.add(id);
    void this.persistEventDeletion(id);
  }

  private async persistEventDeletion(id: string) {
    if (!supabase) {
      this.pendingDeletedEventIds.delete(id);
      return;
    }
    if (!isUuid(id)) {
      this.pendingDeletedEventIds.delete(id);
      return;
    }
    const { error } = await supabase
      .from("schedule_events")
      .delete()
      .eq("id", id);
    if (error) {
      console.warn("[schedules] delete event failed:", error.message);
      return;
    }
    this.pendingDeletedEventIds.delete(id);
  }

  setDocEventStatus(id: string, status: DocEventStatus) {
    this.inner.setDocEventStatus(id, status);
    const e = this.inner.getState().scheduleEvents.find((x: ScheduleEvent) => x.id === id);
    if (e) void this.syncEvent(e);
  }

  listToWrite() {
    return this.inner.listToWrite();
  }

  countToWrite(projectId?: string) {
    return this.inner.countToWrite(projectId);
  }

  listProjectFeed(
    projectId: string,
    filter?: Parameters<ScheduleRepository["listProjectFeed"]>[1],
  ) {
    return this.inner.listProjectFeed(projectId, filter);
  }

  listOrgFeed(
    filter?: Parameters<ScheduleRepository["listOrgFeed"]>[0],
    limit?: number,
  ) {
    return this.inner.listOrgFeed(filter, limit);
  }

  userName(id: string) {
    return this.inner.userName(id);
  }

  projectDisplay(id: string) {
    return this.inner.projectDisplay(id);
  }

  private applyPendingOptimistic(bundle: BundleRow): BundleRow {
    let scheduleBlocks = bundle.scheduleBlocks.filter(
      (b) => !this.pendingDeletedBlockIds.has(b.id),
    );
    if (this.pendingBlockDates.size) {
      scheduleBlocks = scheduleBlocks.map((b) => {
        const patch = this.pendingBlockDates.get(b.id);
        return patch
          ? { ...b, startDate: patch.startDate, endDate: patch.endDate }
          : b;
      });
    }

    let categoryMeta = bundle.categoryMeta.filter(
      (m) =>
        !this.pendingDeletedCategoryKeys.has(`${m.projectId}:${m.categoryId}`),
    );
    if (this.pendingCategoryMeta.size) {
      const byKey = new Map<string, ScheduleCategoryMeta>(
        categoryMeta.map((m) => [`${m.projectId}:${m.categoryId}`, m]),
      );
      for (const [key, meta] of this.pendingCategoryMeta) {
        byKey.set(key, meta);
      }
      categoryMeta = [...byKey.values()];
    }

    return {
      ...bundle,
      scheduleBlocks,
      scheduleEvents: bundle.scheduleEvents.filter(
        (e) => !this.pendingDeletedEventIds.has(e.id),
      ),
      crews: bundle.crews.filter((c) => !this.pendingDeletedCrewIds.has(c.id)),
      categoryMeta,
      crewAttendance: (() => {
        const byId = new Map(
          bundle.crewAttendance
            .filter((a) => !this.pendingDeletedAttendanceIds.has(a.id))
            .map((a) => [a.id, a]),
        );
        for (const [id, row] of this.pendingAttendance) {
          if (this.pendingDeletedAttendanceIds.has(id)) continue;
          byId.set(id, row);
        }
        return [...byId.values()];
      })(),
      crewEquipmentLogs: (() => {
        const pendingAttIds = new Set(this.pendingEquipment.keys());
        const logs = bundle.crewEquipmentLogs.filter(
          (e) =>
            !this.pendingDeletedAttendanceIds.has(e.attendanceId) &&
            !pendingAttIds.has(e.attendanceId),
        );
        for (const [attId, pending] of this.pendingEquipment) {
          if (this.pendingDeletedAttendanceIds.has(attId)) continue;
          logs.push(...pending);
        }
        return logs;
      })(),
    };
  }

  /** Retry in-flight deletes/moves before hydrate so focus-reload cannot undo them. */
  private async flushPendingOptimistic() {
    if (!supabase) return;
    const blocks = [...this.pendingDeletedBlockIds].filter(isUuid);
    if (blocks.length) {
      const { error } = await supabase
        .from("schedule_blocks")
        .delete()
        .in("id", blocks);
      if (!error) {
        for (const id of blocks) this.pendingDeletedBlockIds.delete(id);
      } else {
        console.warn("[schedules] flush block deletes failed:", error.message);
      }
    }
    const events = [...this.pendingDeletedEventIds].filter(isUuid);
    if (events.length) {
      const { error } = await supabase
        .from("schedule_events")
        .delete()
        .in("id", events);
      if (!error) {
        for (const id of events) this.pendingDeletedEventIds.delete(id);
      } else {
        console.warn("[schedules] flush event deletes failed:", error.message);
      }
    }
    const crews = [...this.pendingDeletedCrewIds].filter(isUuid);
    for (const id of crews) {
      const { error } = await supabase
        .from("construction_crews")
        .delete()
        .eq("id", id);
      if (!error) this.pendingDeletedCrewIds.delete(id);
      else console.warn("[schedules] flush crew delete failed:", error.message);
    }
    for (const key of [...this.pendingDeletedCategoryKeys]) {
      const [projectId, categoryId] = key.split(":");
      if (!projectId || !categoryId) continue;
      const { error } = await supabase
        .from("schedule_category_meta")
        .delete()
        .eq("project_id", projectId)
        .eq("category_id", categoryId);
      if (!error) this.pendingDeletedCategoryKeys.delete(key);
      else console.warn("[schedules] flush category meta failed:", error.message);
    }

    for (const [id, patch] of [...this.pendingBlockDates]) {
      if (!isUuid(id)) {
        this.pendingBlockDates.delete(id);
        continue;
      }
      const { error } = await supabase
        .from("schedule_blocks")
        .update({
          start_date: patch.startDate,
          end_date: patch.endDate,
        })
        .eq("id", id);
      if (!error) this.pendingBlockDates.delete(id);
      else console.warn("[schedules] flush block move failed:", error.message);
    }

    for (const [key, meta] of [...this.pendingCategoryMeta]) {
      const { error } = await supabase.from("schedule_category_meta").upsert({
        project_id: meta.projectId,
        category_id: meta.categoryId,
        title: meta.title,
        note: meta.note,
        start_date: meta.startDate || null,
        end_date: meta.endDate || null,
      });
      if (!error) this.pendingCategoryMeta.delete(key);
      else console.warn("[schedules] flush category meta upsert failed:", error.message);
    }

    for (const id of [...this.pendingDeletedAttendanceIds].filter(isUuid)) {
      const { error } = await supabase
        .from("construction_crew_attendance")
        .delete()
        .eq("id", id);
      if (!error) this.pendingDeletedAttendanceIds.delete(id);
      else console.warn("[schedules] flush attendance delete failed:", error.message);
    }

    for (const [id, row] of [...this.pendingAttendance]) {
      const logs = this.pendingEquipment.get(id) ?? [];
      await this.syncAttendance(row, logs);
    }
  }

  private async loadFromCloud() {
    if (!cloudEnabled || !supabase) {
      this.loadError = "Brak połączenia z chmurą.";
      return;
    }
    try {
      await supabase.rpc("schedule_ensure_catalogs", { p_org_id: this.orgId });
      await this.flushPendingOptimistic();
      const raw = await fetchOrgBundle(this.orgId);
      const bundle = this.applyPendingOptimistic(raw);
      this.inner.hydrate({
        version: 1,
        orgId: this.orgId,
        users: bundle.users,
        viewAsUserId: this.userId,
        projects: bundle.projects,
        nextNumberHint: bundle.nextNumberHint,
        catalog: bundle.catalog,
        scheduleCatalog: bundle.scheduleCatalog,
        crews: bundle.crews,
        scheduleBlocks: bundle.scheduleBlocks,
        scheduleEvents: bundle.scheduleEvents,
        categoryMeta: bundle.categoryMeta,
        crewAttendance: bundle.crewAttendance,
        crewEquipmentLogs: bundle.crewEquipmentLogs,
      });
      await this.ensureDefaultCatalogs(bundle);
    } catch (e) {
      this.loadError =
        e instanceof Error ? e.message : "Błąd ładowania harmonogramów.";
      console.warn("[schedules] load:", this.loadError);
    }
  }

  private async ensureDefaultCatalogs(bundle: BundleRow) {
    if (!supabase) return;
    const needsSupervision = !bundle.catalog?.categories?.length;
    const needsSchedule = !bundle.scheduleCatalog?.categories?.length;
    if (!needsSupervision && !needsSchedule) return;

    const supervision = needsSupervision
      ? buildNadzorPodstawowyPreset()
      : bundle.catalog;
    const schedule = needsSchedule
      ? buildBudowaScheduleCatalog()
      : bundle.scheduleCatalog;

    if (needsSupervision) {
      await supabase.from("schedule_catalogs").upsert({
        org_id: this.orgId,
        kind: "supervision",
        payload: supervision,
      });
    }
    if (needsSchedule) {
      await supabase.from("schedule_catalogs").upsert({
        org_id: this.orgId,
        kind: "schedule",
        payload: schedule,
      });
    }

    const state = this.inner.getState();
    this.inner.hydrate({
      ...state,
      catalog: supervision,
      scheduleCatalog: schedule,
    });
  }

  async reload() {
    this.loadPromise = this.loadFromCloud();
    await this.loadPromise;
  }

  /** Replace newly minted demo ids (`sb-…`) with UUIDs so Postgres upserts succeed. */
  private rewriteNonUuidBlockIds(beforeIds: Set<string>) {
    const state = this.inner.getState();
    const idMap = new Map<string, string>();
    const rewritten = state.scheduleBlocks.map((b) => {
      if (beforeIds.has(b.id) || isUuid(b.id)) return b;
      const nextId = crypto.randomUUID();
      idMap.set(b.id, nextId);
      return { ...b, id: nextId };
    });
    if (idMap.size === 0) return;
    const fixed = rewritten.map((b) => ({
      ...b,
      parentId:
        b.parentId && idMap.has(b.parentId) ? idMap.get(b.parentId)! : b.parentId,
      crewId: b.crewId && isUuid(b.crewId) ? b.crewId : "",
    }));
    this.inner.hydrate({ ...state, scheduleBlocks: fixed });
  }

  private async saveCatalog(
    kind: "supervision" | "schedule",
    preset: SupervisionCatalogPreset | ScheduleCatalogPreset,
  ) {
    if (!supabase) return;
    await supabase.from("schedule_catalogs").upsert({
      org_id: this.orgId,
      kind,
      payload: preset,
    });
  }

  private async syncCrew(row: PreviewCrew) {
    if (!supabase) return;
    if (this.pendingDeletedCrewIds.has(row.id)) return;
    const { error } = await supabase.from("construction_crews").upsert({
      id: row.id,
      org_id: this.orgId,
      name: row.name,
      color: row.color,
      headcount: row.headcount,
      supervisor: row.supervisor,
      company: row.company,
      phone: row.phone,
    });
    if (error) {
      console.warn("[schedules] sync crew failed:", error.message);
    }
  }

  private async syncBlock(row: ScheduleBlock) {
    if (!supabase) return;
    if (this.pendingDeletedBlockIds.has(row.id)) return;
    const parentId =
      row.parentId && isUuid(row.parentId) ? row.parentId : null;
    const crewId = row.crewId && isUuid(row.crewId) ? row.crewId : null;
    // Lokalne id (crew-elew / sb-…) nie przejdą FK — wyzeruj przed upsertem,
    // żeby sync nie failował i nie wywoływał reload() kasującego nowy blok.
    if (
      (row.parentId && !parentId) ||
      (row.crewId && !crewId)
    ) {
      this.inner.upsertScheduleBlock({
        ...row,
        parentId,
        crewId: crewId ?? "",
      });
    }
    const { error } = await supabase.from("schedule_blocks").upsert({
      id: row.id,
      project_id: row.projectId,
      title: row.title,
      category_id: row.categoryId,
      scope: row.scope,
      role: row.role,
      parent_id: parentId,
      crew_id: crewId,
      start_date: row.startDate,
      end_date: row.endDate,
      status: row.status,
      color: row.color,
      note: row.note,
    });
    if (error) {
      console.warn("[schedules] sync block failed:", error.message);
      return;
    }
    const pending = this.pendingBlockDates.get(row.id);
    if (
      pending &&
      pending.startDate === row.startDate &&
      pending.endDate === row.endDate
    ) {
      this.pendingBlockDates.delete(row.id);
    }
  }

  private async syncBlocks(blocks: ScheduleBlock[]) {
    for (const b of blocks) await this.syncBlock(b);
  }

  private async syncEvent(row: ScheduleEvent) {
    if (!supabase) return;
    if (this.pendingDeletedEventIds.has(row.id)) return;
    const blockId =
      row.blockId && isUuid(row.blockId) ? row.blockId : null;
    const { error } = await supabase.from("schedule_events").upsert({
      id: row.id,
      project_id: row.projectId,
      block_id: blockId,
      kind: row.kind,
      title: row.title,
      event_date: row.date,
      event_time: row.time ? `${row.time}:00` : null,
      note: row.note,
      category_id: row.categoryId ?? null,
      status: row.status ?? null,
      activity: row.activity ?? null,
      custom_label: row.customLabel ?? null,
      written_at: row.writtenAt ?? null,
      reported_by_user_id: row.reportedByUserId ?? null,
      written_by_user_id: row.writtenByUserId ?? null,
    });
    if (error) {
      console.warn("[schedules] sync event failed:", error.message);
    }
  }

  private async syncCategoryMeta(row: ScheduleCategoryMeta) {
    if (!supabase) return;
    const key = `${row.projectId}:${row.categoryId}`;
    this.pendingCategoryMeta.set(key, row);
    const { error } = await supabase.from("schedule_category_meta").upsert({
      project_id: row.projectId,
      category_id: row.categoryId,
      title: row.title,
      note: row.note,
      start_date: row.startDate || null,
      end_date: row.endDate || null,
    });
    if (error) {
      console.warn("[schedules] sync category meta failed:", error.message);
      return;
    }
    const pending = this.pendingCategoryMeta.get(key);
    if (
      pending &&
      pending.startDate === row.startDate &&
      pending.endDate === row.endDate &&
      pending.title === row.title &&
      pending.note === row.note
    ) {
      this.pendingCategoryMeta.delete(key);
    }
  }

  private async syncReclassify(
    projectId: string,
    fromCategoryId: string,
    toCategoryId: string,
  ) {
    if (!supabase) return;
    const { error: blocksErr } = await supabase
      .from("schedule_blocks")
      .update({ category_id: toCategoryId })
      .eq("project_id", projectId)
      .eq("category_id", fromCategoryId);
    if (blocksErr) {
      console.warn("[schedules] reclassify blocks failed:", blocksErr.message);
    }
    const { error: eventsErr } = await supabase
      .from("schedule_events")
      .update({ category_id: toCategoryId })
      .eq("project_id", projectId)
      .eq("category_id", fromCategoryId);
    if (eventsErr) {
      console.warn("[schedules] reclassify events failed:", eventsErr.message);
    }
    const { error: metaErr } = await supabase
      .from("schedule_category_meta")
      .update({ category_id: toCategoryId })
      .eq("project_id", projectId)
      .eq("category_id", fromCategoryId);
    if (metaErr) {
      console.warn("[schedules] reclassify meta failed:", metaErr.message);
    }
  }
}

function emptyCloudState(orgId: string, userId: string): ProjectsPreviewState {
  return {
    version: 1,
    orgId,
    users: [{ id: userId, displayName: "Ty" }],
    viewAsUserId: userId,
    projects: [],
    nextNumberHint: 1,
    catalog: buildNadzorPodstawowyPreset(),
    scheduleCatalog: buildBudowaScheduleCatalog(),
    crews: [],
    scheduleBlocks: [],
    scheduleEvents: [],
    categoryMeta: [],
    crewAttendance: [],
    crewEquipmentLogs: [],
  };
}

async function fetchOrgBundle(orgId: string): Promise<BundleRow> {
  if (!supabase) throw new Error("Brak chmury.");

  const projectIds: string[] = [];

  const [
    projectsRes,
    membersRes,
    crewsRes,
    catalogsRes,
    settingsRes,
    orgMembersRes,
  ] = await Promise.all([
    supabase.from("construction_projects").select("*").eq("org_id", orgId),
    supabase.from("construction_project_members").select("project_id, user_id"),
    supabase.from("construction_crews").select("*").eq("org_id", orgId),
    supabase.from("schedule_catalogs").select("*").eq("org_id", orgId),
    supabase
      .from("schedule_org_settings")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle(),
    supabase.rpc("org_get_detail", { p_org_id: orgId }),
  ]);

  if (projectsRes.error) throw new Error(projectsRes.error.message);

  for (const p of projectsRes.data ?? []) projectIds.push(p.id);

  const [blocksRes, eventsRes, metaRes, attendanceRes] = await Promise.all([
    projectIds.length
      ? supabase.from("schedule_blocks").select("*").in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from("schedule_events").select("*").in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase
          .from("schedule_category_meta")
          .select("*")
          .in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("construction_crew_attendance")
      .select("*")
      .eq("org_id", orgId),
  ]);

  if (attendanceRes.error) {
    console.warn(
      "[schedules] load attendance failed:",
      attendanceRes.error.message,
      "— uruchom migracje 0057/0058 (supabase db push).",
    );
  }

  const attendanceIds = (attendanceRes.data ?? []).map((a) => a.id as string);
  const equipmentRes =
    attendanceIds.length > 0
      ? await supabase
          .from("construction_crew_equipment_logs")
          .select("*")
          .in("attendance_id", attendanceIds)
      : { data: [], error: null };

  const memberMap = new Map<string, string[]>();
  for (const m of membersRes.data ?? []) {
    const list = memberMap.get(m.project_id) ?? [];
    list.push(m.user_id);
    memberMap.set(m.project_id, list);
  }

  const projects: PreviewProject[] = (projectsRes.data ?? []).map((p) => ({
    id: p.id,
    orgId: p.org_id,
    number: p.number,
    name: p.name,
    adminUserId: p.admin_user_id,
    memberIds: memberMap.get(p.id) ?? [p.admin_user_id],
    createdAt: p.created_at,
    status: p.status as ProjectStatus,
  }));

  const detail = orgMembersRes.data as {
    members?: { userId: string; displayName: string | null }[];
  } | null;
  const users: PreviewUser[] = (detail?.members ?? []).map((m) => ({
    id: m.userId,
    displayName: m.displayName?.trim() || "Członek zespołu",
  }));

  const crews: PreviewCrew[] = (crewsRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    headcount: c.headcount,
    supervisor: c.supervisor ?? "",
    company: c.company ?? "",
    phone: c.phone ?? "",
  }));

  const scheduleBlocks: ScheduleBlock[] = (blocksRes.data ?? []).map((b) => ({
    id: b.id,
    projectId: b.project_id,
    title: b.title,
    categoryId: b.category_id,
    scope: b.scope,
    role: b.role as ScheduleBlock["role"],
    parentId: b.parent_id,
    crewId: b.crew_id ?? "",
    startDate: b.start_date,
    endDate: b.end_date,
    status: b.status as ScheduleBlock["status"],
    color: b.color,
    note: b.note ?? "",
  }));

  const scheduleEvents: ScheduleEvent[] = (eventsRes.data ?? []).map((e) => ({
    id: e.id,
    projectId: e.project_id,
    blockId: e.block_id,
    kind: e.kind as ScheduleEvent["kind"],
    title: e.title,
    date: e.event_date,
    time: normalizeLoadedEventTime(e.event_time),
    note: e.note ?? "",
    categoryId: e.category_id ?? undefined,
    status: e.status as ScheduleEvent["status"],
    activity: e.activity ?? undefined,
    customLabel: e.custom_label ?? undefined,
    writtenAt: e.written_at,
    reportedByUserId: e.reported_by_user_id,
    writtenByUserId: e.written_by_user_id,
  }));

  const categoryMeta: ScheduleCategoryMeta[] = (metaRes.data ?? []).map((m) => ({
    projectId: m.project_id,
    categoryId: m.category_id,
    title: m.title ?? "",
    note: m.note ?? "",
    startDate: m.start_date ?? "",
    endDate: m.end_date ?? "",
  }));

  const crewAttendance: CrewAttendance[] = (attendanceRes.data ?? []).map((a) => {
    const workers = normalizeWorkerList(a.workers);
    const headcount =
      workers.length > 0 ? workers.length : (a.headcount ?? 0);
    const laborHours =
      workers.length > 0
        ? totalLaborHours(workers)
        : Number(a.labor_hours) || 0;
    return {
      id: a.id,
      orgId: a.org_id,
      crewId: a.crew_id,
      projectId: a.project_id,
      workDate: a.work_date,
      headcount,
      laborHours,
      workers,
      status: a.status === "confirmed" ? "confirmed" : "declared",
      note: a.note ?? "",
      createdByUserId: a.created_by ?? null,
      confirmedByUserId: a.confirmed_by ?? null,
      confirmedAt: a.confirmed_at ?? null,
    };
  });

  const crewEquipmentLogs: CrewEquipmentLog[] = (equipmentRes.data ?? []).map(
    (e) => ({
      id: e.id,
      attendanceId: e.attendance_id,
      equipmentKey: e.equipment_key,
      equipmentLabel: e.equipment_label ?? "",
      quantity: e.quantity ?? 0,
      hours: Number(e.hours) || 0,
    }),
  );

  let catalog = buildNadzorPodstawowyPreset();
  let scheduleCatalog = buildBudowaScheduleCatalog();
  for (const c of catalogsRes.data ?? []) {
    if (c.kind === "supervision") catalog = c.payload as SupervisionCatalogPreset;
    if (c.kind === "schedule") scheduleCatalog = c.payload as ScheduleCatalogPreset;
  }

  return {
    projects,
    users,
    crews,
    scheduleBlocks,
    scheduleEvents,
    categoryMeta,
    crewAttendance,
    crewEquipmentLogs,
    catalog,
    scheduleCatalog,
    nextNumberHint: settingsRes.data?.next_number_hint ?? 1,
  };
}
