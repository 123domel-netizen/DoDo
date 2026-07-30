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
import type {
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
    if (meta) void this.syncCategoryMeta(meta);
    if (opts?.shiftChildrenByDays) {
      const cat = meta?.categoryId ?? categoryId;
      void this.syncBlocks(
        this.inner
          .listSchedule(projectId)
          .filter((b) => b.categoryId === cat),
      );
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
    const row = this.inner.upsertCrew({
      ...crew,
      id: asCloudId(crew.id),
    });
    void this.syncCrew(row);
    return row;
  }

  deleteCrew(id: string) {
    const res = this.inner.deleteCrew(id);
    if (res.ok) void supabase?.from("construction_crews").delete().eq("id", id);
    return res;
  }

  upsertScheduleBlock(block: Omit<ScheduleBlock, "id"> & { id?: string }) {
    const row = this.inner.upsertScheduleBlock({
      ...block,
      id: asCloudId(block.id),
    });
    void this.syncBlock(row);
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
    const res = this.inner.demoteSubcategory(id, opts);
    if (res.ok) void this.reload();
    return res;
  }

  deleteScheduleBlock(id: string) {
    this.inner.deleteScheduleBlock(id);
    void supabase?.from("schedule_blocks").delete().eq("id", id);
  }

  moveScheduleBlock(
    id: string,
    startDate: string,
    endDate: string,
    opts?: { shiftChildrenByDays?: number },
  ) {
    this.inner.moveScheduleBlock(id, startDate, endDate, opts);
    if (opts?.shiftChildrenByDays) {
      const touched = this.inner
        .listSchedule()
        .filter((b) => b.id === id || b.parentId === id);
      void this.syncBlocks(touched);
      return;
    }
    void supabase
      ?.from("schedule_blocks")
      .update({ start_date: startDate, end_date: endDate })
      .eq("id", id);
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
    void supabase?.from("schedule_events").delete().eq("id", id);
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

  private async loadFromCloud() {
    if (!cloudEnabled || !supabase) {
      this.loadError = "Brak połączenia z chmurą.";
      return;
    }
    try {
      await supabase.rpc("schedule_ensure_catalogs", { p_org_id: this.orgId });
      const bundle = await fetchOrgBundle(this.orgId);
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
      await this.reload();
    }
  }

  private async syncBlock(row: ScheduleBlock) {
    if (!supabase) return;
    const { error } = await supabase.from("schedule_blocks").upsert({
      id: row.id,
      project_id: row.projectId,
      title: row.title,
      category_id: row.categoryId,
      scope: row.scope,
      role: row.role,
      parent_id: row.parentId || null,
      crew_id: row.crewId || null,
      start_date: row.startDate,
      end_date: row.endDate,
      status: row.status,
      color: row.color,
      note: row.note,
    });
    if (error) {
      console.warn("[schedules] sync block failed:", error.message);
      await this.reload();
    }
  }

  private async syncBlocks(blocks: ScheduleBlock[]) {
    for (const b of blocks) await this.syncBlock(b);
  }

  private async syncEvent(row: ScheduleEvent) {
    if (!supabase) return;
    const { error } = await supabase.from("schedule_events").upsert({
      id: row.id,
      project_id: row.projectId,
      block_id: row.blockId,
      kind: row.kind,
      title: row.title,
      event_date: row.date,
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
      await this.reload();
    }
  }

  private async syncCategoryMeta(row: ScheduleCategoryMeta) {
    if (!supabase) return;
    await supabase.from("schedule_category_meta").upsert({
      project_id: row.projectId,
      category_id: row.categoryId,
      title: row.title,
      note: row.note,
      start_date: row.startDate || null,
      end_date: row.endDate || null,
    });
  }

  private async syncReclassify(
    projectId: string,
    fromCategoryId: string,
    toCategoryId: string,
  ) {
    if (!supabase) return;
    await supabase
      .from("schedule_blocks")
      .update({ category_id: toCategoryId })
      .eq("project_id", projectId)
      .eq("category_id", fromCategoryId);
    await supabase
      .from("schedule_events")
      .update({ category_id: toCategoryId })
      .eq("project_id", projectId)
      .eq("category_id", fromCategoryId);
    await supabase
      .from("schedule_category_meta")
      .update({ category_id: toCategoryId })
      .eq("project_id", projectId)
      .eq("category_id", fromCategoryId);
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

  const [blocksRes, eventsRes, metaRes] = await Promise.all([
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
  ]);

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
    catalog,
    scheduleCatalog,
    nextNumberHint: settingsRes.data?.next_number_hint ?? 1,
  };
}
