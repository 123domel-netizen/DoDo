import { describe, expect, it, beforeEach } from "vitest";
import { parseBulkProjects } from "./bulkParse";
import { findCrewConflicts } from "./crewConflicts";
import { isProjectsPreviewEnabled } from "./enabled";
import { normalizeSearchText } from "./normalize";
import {
  buildOrgFeed,
  buildProjectFeed,
  partitionProjectFeed,
  type OrgFeedEntry,
  type ProjectFeedEntry,
} from "./projectFeed";
import {
  countDoWpisania,
  projectNextDeadline,
  projectStageLabel,
} from "./projectMetrics";
import {
  resetProjectsPreviewRepoForTests,
  type ProjectsPreviewRepository,
} from "./repository";
import type { ProjectsPreviewState } from "./types";
import { scheduleOverflow } from "./scheduleOverflow";
import {
  DAY_PX_DEFAULT,
  DAY_PX_MAX,
  DAY_PX_MIN,
  buildScheduleContentRange,
  clampDayPx,
  dayPxForVisibleDays,
  expandRangeToMinDays,
  scrollLeftForDayStart,
  startOfWeekIso,
  tickLevelForDayPx,
  ticksForRange,
} from "./scheduleZoom";
import {
  categoryCollapseKey,
  filterCollapsedBoardRows,
  projectCollapseKey,
  subcategoryCollapseKey,
} from "./scheduleRowCollapse";
import { searchProjects, visibleProjects } from "./search";
import { buildDemoState } from "./demoSeed";
import { collectScheduleDashboardHints } from "./dashboardScheduleHints";
import {
  collectScheduleDashboardFeed,
  collectScheduleDashboardWorks,
  formatScheduleWorkLine,
} from "./dashboardScheduleWorks";
import {
  resolveDashboardSchedulesCollapsed,
  userBelongsToActiveProject,
} from "./dashboardSchedulesCollapse";
import { isoToPlDate, plDateToIso } from "./dateFormat";
import { buildBudowaScheduleCatalog } from "./scheduleCatalog";
import {
  allocateWindows,
  buildProjectSchedulePreset,
  countPresetItems,
  defaultPlannedEndDate,
  inclusiveDayCount,
} from "./schedulePresetSeed";

describe("projectsPreview date format", () => {
  it("formats and parses dzień/miesiąc/rok", () => {
    expect(isoToPlDate("2026-07-29")).toBe("29/07/2026");
    expect(plDateToIso("29/07/2026")).toBe("2026-07-29");
    expect(plDateToIso("1.8.2026")).toBe("2026-08-01");
    expect(plDateToIso("31/02/2026")).toBeNull();
  });
});

describe("projectsPreview schedule preset seed", () => {
  it("defaults planned end to ~12 months", () => {
    expect(defaultPlannedEndDate("2026-08-01")).toBe("2027-07-31");
  });

  it("allocates windows by weight without gaps", () => {
    const wins = allocateWindows("2026-01-01", "2026-01-10", [1, 1, 1]);
    expect(wins).toHaveLength(3);
    expect(wins[0]!.start).toBe("2026-01-01");
    expect(wins[2]!.end).toBe("2026-01-10");
    expect(inclusiveDayCount(wins[0]!.start, wins[2]!.end)).toBe(10);
  });

  it("builds only subcategory blocks from catalog scopes", () => {
    const catalog = buildBudowaScheduleCatalog();
    const counts = countPresetItems(catalog);
    let n = 0;
    const seeded = buildProjectSchedulePreset({
      projectId: "p-x",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      catalog,
      uid: () => `sb-${++n}`,
    });
    expect(seeded.categoryMeta).toHaveLength(counts.categories);
    expect(seeded.blocks).toHaveLength(counts.subcategories);
    expect(seeded.blocks.every((b) => b.role === "subcategory")).toBe(true);
    expect(seeded.blocks.every((b) => b.crewId === "")).toBe(true);
  });
});

describe("projectsPreview normalize + search", () => {
  it("strips Polish diacritics", () => {
    expect(normalizeSearchText("Więcbork")).toBe("wiecbork");
    expect(normalizeSearchText("Sępólno")).toBe("sepolno");
  });

  it("finds by number, name fragment, and ascii", () => {
    const projects = buildDemoState().projects;
    expect(searchProjects(projects, "114")[0]?.project.number).toBe("114");
    expect(searchProjects(projects, "Vestino")[0]?.project.number).toBe("114");
    expect(searchProjects(projects, "Wiecbork")[0]?.project.number).toBe("114");
    expect(searchProjects(projects, "vest")[0]?.project.number).toBe("114");
    expect(searchProjects(projects, "wiec")[0]?.project.number).toBe("114");
    expect(searchProjects(projects, "więc")[0]?.project.number).toBe("114");
  });

  it("ranks exact number first", () => {
    const projects = buildDemoState().projects;
    const hits = searchProjects(projects, "11");
    expect(hits[0]?.rank).toBe(2);
  });
});

describe("projectsPreview visibility", () => {
  it("hides projects from non-members", () => {
    const projects = buildDemoState().projects;
    const asGuest = visibleProjects(projects, "u-outsider");
    expect(asGuest).toHaveLength(0);
    const asJacek = visibleProjects(projects, "u-jacek");
    expect(asJacek.map((p) => p.number).sort()).toEqual(["114", "115"]);
  });
});

describe("projectsPreview bulk parser", () => {
  it("parses semicolon rows and detects conflicts", () => {
    const text = [
      "114; Vestino - Więcbork",
      "200; Nowy",
      "; Bad",
      "201; ",
    ].join("\n");
    const res = parseBulkProjects(text, { existingNumbers: new Set(["114"]) });
    expect(res.okCount).toBe(1);
    const line1 = res.rows.find((r) => r.line === 1);
    expect(line1 && !line1.ok && line1.error).toBe("number_exists");
    expect(res.rows.find((r) => r.line === 2 && r.ok)?.number).toBe("200");
    expect(res.rows.find((r) => r.line === 3)?.ok).toBe(false);
    const line4 = res.rows.find((r) => r.line === 4);
    expect(line4 && !line4.ok && line4.error).toBe("missing_name");
  });

  it("parses whitespace rows and alphanumeric codes", () => {
    const res = parseBulkProjects("210 Alpha\nB-12; Beta", {
      existingNumbers: new Set(),
    });
    expect(res.okCount).toBe(2);
    expect(res.rows.find((r) => r.ok && r.number === "B-12")).toBeTruthy();
  });
});

describe("projectsPreview repository", () => {
  let repo: ProjectsPreviewRepository;

  beforeEach(() => {
    repo = resetProjectsPreviewRepoForTests(buildDemoState());
  });

  it("enforces unique numbers and does not call cloud", () => {
    expect(repo.assertNoCloud()).toEqual({
      supabase: false,
      edge: false,
      graph: false,
      r2: false,
    });
    const fail = repo.createProject({
      number: "114",
      name: "Duplikat",
      memberIds: [],
    });
    expect(fail.ok).toBe(false);
    const ok = repo.createProject({
      number: "999",
      name: "Test",
      memberIds: ["u-ola"],
    });
    expect(ok.ok).toBe(true);
  });

  it("seeds categories + subcategories without works on create", () => {
    const res = repo.createProject({
      number: "888",
      name: "Z presetem",
      memberIds: [],
      schedulePreset: {
        startDate: "2026-08-01",
        endDate: "2027-07-31",
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const blocks = repo.listSchedule(res.project.id);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.role === "subcategory")).toBe(true);
    expect(blocks.some((b) => b.categoryId === "reklamacja")).toBe(false);
    expect(blocks.every((b) => b.startDate >= "2026-08-01")).toBe(true);
    expect(blocks.every((b) => b.endDate <= "2027-07-31")).toBe(true);
    const meta = repo
      .getState()
      .categoryMeta.filter((m) => m.projectId === res.project.id);
    expect(meta.length).toBeGreaterThan(0);
    expect(meta.some((m) => m.categoryId === "stan-0")).toBe(true);
    expect(meta.every((m) => m.startDate && m.endDate)).toBe(true);
  });

  it("accepts alphanumeric project codes", () => {
    const res = repo.createProject({
      number: "B-2026/01",
      name: "Kod tekstowy",
      memberIds: [],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.project.number).toBe("B-2026/01");
  });

  it("picker only lists visible projects", () => {
    repo.setViewAs("u-outsider");
    expect(repo.visibleProjectList()).toHaveLength(0);
    repo.setViewAs("u-jacek");
    expect(repo.visibleProjectList().every((p) => p.number !== "121")).toBe(true);
  });

  it("lists Do wpisania across visible projects", () => {
    const list = repo.listToWrite();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((i) => i.status === "do_wpisania")).toBe(true);
    expect(repo.countToWrite()).toBe(list.length);
    expect(repo.countToWrite("p-114")).toBe(1);
  });

  it("scopes crew conflicts to what the viewer can see", () => {
    repo.setViewAs("u-jacek");
    expect(repo.crewConflicts()).toHaveLength(0);
    repo.setViewAs("u-admin");
    expect(repo.crewConflicts(["p-121"])).toEqual(repo.crewConflicts());
  });

  it("links documentary events to a schedule block and deletes them", () => {
    const linked = repo.listEventsForBlock("sb-1a");
    expect(linked.map((i) => i.id)).toEqual(["si-5"]);
    expect(linked.every((e) => e.kind === "dokumentacyjne")).toBe(true);
    repo.deleteScheduleEvent("si-5");
    expect(repo.listEventsForBlock("sb-1a")).toHaveLength(0);
  });

  it("filters events by kind and to-write queue", () => {
    expect(
      repo.listScheduleEvents("p-121", undefined, { kind: "budowlane" })
        .map((e) => e.id),
    ).toEqual(["se-2", "se-1"]);
    expect(
      repo
        .listScheduleEvents(undefined, undefined, { toWriteOnly: true })
        .every((e) => e.status === "do_wpisania"),
    ).toBe(true);
  });

  it("stamps writtenAt when a documentary event is marked wpisane", () => {
    repo.setDocEventStatus("si-1", "wpisane");
    const done = repo.listScheduleEvents("p-114").find((e) => e.id === "si-1");
    expect(done?.status).toBe("wpisane");
    expect(done?.writtenAt).toBeTruthy();
    expect(repo.countToWrite("p-114")).toBe(0);
  });

  it("seeds a cold-start schedule template once", () => {
    expect(repo.listSchedule("p-140")).toHaveLength(0);
    const created = repo.seedScheduleTemplate("p-140");
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((b) => b.role === "subcategory")).toBe(true);
    expect(created.some((b) => b.categoryId === "reklamacja")).toBe(false);
    expect(repo.seedScheduleTemplate("p-140")).toHaveLength(0);
  });
});

describe("projectsPreview migration", () => {
  const asState = (raw: unknown) => raw as ProjectsPreviewState;

  it("strips kind/messages and normalizes legacy stage ids", () => {
    const legacy = {
      ...buildDemoState(),
      projects: buildDemoState().projects.map((p) => ({
        ...p,
        kind: "projektowanie",
      })),
      scheduleEvents: [],
      supervisionItems: [
        {
          id: "si-legacy",
          projectId: "p-114",
          categoryId: "stan-zero",
          activity: "Stare zdarzenie",
          status: "do_wpisania" as const,
          noticedAt: "2026-07-01",
          note: "",
          reportedByUserId: "u-admin",
          writtenAt: null,
          writtenByUserId: null,
        },
      ],
      messages: [{ id: "m1" }],
    };
    const repo = resetProjectsPreviewRepoForTests(asState(legacy));
    const state = repo.getState();
    expect(state.projects.every((p) => !("kind" in p))).toBe(true);
    expect("messages" in state).toBe(false);
    expect("supervisionItems" in state).toBe(false);
    const migrated = state.scheduleEvents.find((e) => e.id === "si-legacy");
    expect(migrated?.kind).toBe("dokumentacyjne");
    expect(migrated?.categoryId).toBe("stan-0");
    expect(migrated?.blockId).toBe(null);
    expect(migrated?.date).toBe("2026-07-01");
    expect(migrated?.title).toBe("Stare zdarzenie");
  });

  it("migrates a v6 blob: nadzór → dokumentacyjne, logistyka → budowlane", () => {
    const v6 = {
      ...buildDemoState(),
      scheduleEvents: [
        {
          id: "se-old",
          projectId: "p-121",
          blockId: "sb-2",
          title: "Dostawa więźby",
          date: "2026-07-24",
          note: "",
        },
      ],
      supervisionItems: [
        {
          id: "si-old",
          projectId: "p-121",
          categoryId: "stan-0",
          activity: "Inny",
          customLabel: "Własny opis",
          status: "brak" as const,
          noticedAt: null,
          note: "",
          reportedByUserId: null,
          writtenAt: "2026-07-05",
          writtenByUserId: "u-admin",
          blockId: "sb-1a",
        },
      ],
    };
    const repo = resetProjectsPreviewRepoForTests(asState(v6));
    const events = repo.getState().scheduleEvents;
    expect(events).toHaveLength(2);

    const logistics = events.find((e) => e.id === "se-old");
    expect(logistics?.kind).toBe("budowlane");
    expect(logistics?.status).toBeUndefined();

    const doc = events.find((e) => e.id === "si-old");
    expect(doc?.kind).toBe("dokumentacyjne");
    // `brak` no longer exists — it lands as something actionable.
    expect(doc?.status).toBe("do_sprawdzenia");
    expect(doc?.title).toBe("Własny opis");
    expect(doc?.date).toBe("2026-07-05");
    expect(doc?.blockId).toBe("sb-1a");
  });
});

describe("projectsPreview project metrics", () => {
  it("reports stage, deadline and Do wpisania count", () => {
    const state = buildDemoState();
    expect(
      projectStageLabel("p-121", state.scheduleBlocks, state.scheduleCatalog, "2026-07-23"),
    ).toBe("Stan deweloperski zewnętrzny");
    expect(projectNextDeadline("p-121", state.scheduleBlocks, "2026-07-23")).toBe(
      "2026-07-25",
    );
    expect(countDoWpisania("p-121", state.scheduleEvents)).toBe(1);
    expect(projectStageLabel("p-140", state.scheduleBlocks, state.scheduleCatalog)).toBe(
      null,
    );
    expect(projectNextDeadline("p-140", state.scheduleBlocks)).toBe(null);
  });
});

describe("projectsPreview crew conflicts", () => {
  it("detects overlapping crew assignments", () => {
    const conflicts = findCrewConflicts([
      {
        id: "a",
        projectId: "p1",
        title: "A",
        categoryId: "stan-0",
        scope: "Fundamenty: Zbroj. fundam.",
        role: "work",
        parentId: null,
        crewId: "c1",
        startDate: "2026-07-01",
        endDate: "2026-07-10",
        status: "planowane",
        color: "#000",
        note: "",
      },
      {
        id: "b",
        projectId: "p2",
        title: "B",
        categoryId: "stan-0",
        scope: "Fundamenty: Szalunki i betonowanie",
        role: "work",
        parentId: null,
        crewId: "c1",
        startDate: "2026-07-08",
        endDate: "2026-07-15",
        status: "planowane",
        color: "#000",
        note: "",
      },
    ]);
    expect(conflicts).toHaveLength(1);
  });

  it("ignores subcategory containers in conflicts", () => {
    const conflicts = findCrewConflicts([
      {
        id: "sub",
        projectId: "p1",
        title: "Okno",
        categoryId: "stan-0",
        scope: "Fundamenty",
        role: "subcategory",
        parentId: null,
        crewId: "c1",
        startDate: "2026-07-01",
        endDate: "2026-07-20",
        status: "planowane",
        color: "#000",
        note: "",
      },
      {
        id: "w",
        projectId: "p1",
        title: "Praca",
        categoryId: "stan-0",
        scope: "Fundamenty",
        role: "work",
        parentId: "sub",
        crewId: "c1",
        startDate: "2026-07-01",
        endDate: "2026-07-10",
        status: "planowane",
        color: "#000",
        note: "",
      },
    ]);
    expect(conflicts).toHaveLength(0);
  });
});

describe("projectsPreview schedule hierarchy", () => {
  let repo: ProjectsPreviewRepository;

  beforeEach(() => {
    repo = resetProjectsPreviewRepoForTests();
  });

  it("promotes work to subcategory and keeps a child work", () => {
    const work = repo.listSchedule("p-121").find(
      (b) => b.id === "sb-2" && b.role === "work",
    );
    expect(work).toBeTruthy();
    const parent = repo.promoteToSubcategory(work!.id);
    expect(parent?.role).toBe("subcategory");
    const children = repo
      .listSchedule("p-121")
      .filter((b) => b.parentId === work!.id);
    expect(children).toHaveLength(1);
    expect(children[0]!.startDate).toBe(work!.startDate);
    expect(children[0]!.endDate).toBe(work!.endDate);
  });

  it("allows work without category (investment row)", () => {
    const row = repo.upsertScheduleBlock({
      projectId: "p-121",
      categoryId: "__project__",
      scope: "Ogrodzenie tymczasowe",
      title: "Ogrodzenie tymczasowe",
      role: "work",
      parentId: "sb-1",
      crewId: "crew-1",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      status: "planowane",
      color: "#888",
      note: "",
    });
    expect(row.categoryId).toBe("__project__");
    expect(row.parentId).toBeNull();
    expect(row.role).toBe("work");
    expect(
      repo.listSchedule("p-121").find((b) => b.id === row.id)?.categoryId,
    ).toBe("__project__");
    expect(repo.promoteToSubcategory(row.id)).toBeNull();
  });

  it("allows upsert of work outside parent window", () => {
    const overflow = scheduleOverflow(
      { startDate: "2026-08-01", endDate: "2026-08-04" },
      { startDate: "2026-07-20", endDate: "2026-07-31" },
    );
    expect(overflow.outside).toBe(true);
    expect(overflow.after).toBeGreaterThan(0);

    const row = repo.upsertScheduleBlock({
      projectId: "p-121",
      categoryId: "deweloperski-zew",
      scope: "Termoizolacja ścian",
      title: "Poza oknem",
      role: "work",
      parentId: "sb-1",
      crewId: "crew-elew",
      startDate: "2026-08-01",
      endDate: "2026-08-04",
      status: "planowane",
      color: "#3b82f6",
      note: "",
    });
    expect(row.parentId).toBe("sb-1");
    expect(row.startDate).toBe("2026-08-01");
  });
});

describe("projectsPreview schedule events", () => {
  let repo: ProjectsPreviewRepository;

  beforeEach(() => {
    repo = resetProjectsPreviewRepoForTests();
  });

  it("stores point events on a block without treating them as work", () => {
    const created = repo.upsertScheduleEvent({
      projectId: "p-121",
      blockId: "sb-2",
      kind: "budowlane",
      title: "Przyjedzie dźwig",
      date: "2026-07-30",
      note: "",
    });
    expect(created.title).toBe("Przyjedzie dźwig");
    expect(created.status).toBeUndefined();
    const listed = repo.listScheduleEvents("p-121", "sb-2");
    expect(listed.some((e) => e.id === created.id)).toBe(true);
    expect(repo.listSchedule("p-121").every((b) => b.id !== created.id)).toBe(
      true,
    );
  });

  it("creates a documentary event straight into the to-write queue", () => {
    const before = repo.countToWrite("p-121");
    const created = repo.upsertScheduleEvent({
      projectId: "p-121",
      blockId: "sb-1a",
      kind: "dokumentacyjne",
      title: "",
      categoryId: "stan-0",
      activity: "Zakończono zbrojenie",
      status: "do_wpisania",
      date: "2026-07-29",
    });
    // Title falls back to the catalog activity.
    expect(created.title).toBe("Zakończono zbrojenie");
    expect(created.reportedByUserId).toBe("u-admin");
    expect(repo.countToWrite("p-121")).toBe(before + 1);
  });

  it("keeps documentary events but drops budowlane when a block is deleted", () => {
    expect(repo.listScheduleEvents("p-121", "sb-1").length).toBeGreaterThan(0);
    repo.deleteScheduleBlock("sb-1");
    expect(repo.listScheduleEvents("p-121", "sb-1")).toHaveLength(0);
    // Cascade: child work sb-1a is removed; its documentary event survives unlinked.
    expect(repo.listSchedule().some((b) => b.id === "sb-1a")).toBe(false);
    const doc = repo.listScheduleEvents("p-121").find((e) => e.id === "si-5");
    expect(doc?.blockId).toBe(null);
  });

  it("allows an event with no block at all", () => {
    const created = repo.upsertScheduleEvent({
      projectId: "p-114",
      blockId: null,
      kind: "budowlane",
      title: "Wizyta inspektora",
      date: "2026-07-30",
    });
    expect(created.blockId).toBe(null);
    expect(repo.listScheduleEvents("p-114").some((e) => e.id === created.id)).toBe(
      true,
    );
  });

  it("stores optional time and sets reportedBy on budowlane create", () => {
    const created = repo.upsertScheduleEvent({
      projectId: "p-114",
      blockId: null,
      kind: "budowlane",
      title: "Dostawa stali",
      date: "2026-08-03",
      time: "09:30",
    });
    expect(created.time).toBe("09:30");
    expect(created.reportedByUserId).toBe("u-admin");
  });

  it("removeProjectCategory deletes meta and all blocks in the category", () => {
    const before = repo
      .listSchedule("p-121")
      .filter((b) => b.categoryId === "instalacje");
    expect(before.length).toBeGreaterThan(0);
    repo.upsertCategoryMeta({
      projectId: "p-121",
      categoryId: "instalacje",
      title: "Instalacje custom",
      note: "",
    });
    const { deletedBlockIds, deletedEventIds } = repo.removeProjectCategory(
      "p-121",
      "instalacje",
    );
    expect(deletedBlockIds.length).toBe(before.length);
    expect(deletedEventIds.length).toBeGreaterThanOrEqual(0);
    expect(
      repo.listSchedule("p-121").every((b) => b.categoryId !== "instalacje"),
    ).toBe(true);
    expect(repo.getCategoryMeta("p-121", "instalacje")).toBe(null);
    expect(
      repo
        .listScheduleEvents("p-121")
        .every((e) => e.categoryId !== "instalacje"),
    ).toBe(true);
  });
});

describe("projectsPreview project feed (chronologia budowy)", () => {
  let repo: ProjectsPreviewRepository;

  beforeEach(() => {
    repo = resetProjectsPreviewRepoForTests();
  });

  const idsOf = (entries: ProjectFeedEntry[]) => entries.map((e) => e.event.id);

  it("mixes both kinds of zdarzenia, newest first", () => {
    const state = buildDemoState();
    const feed = buildProjectFeed(
      "p-121",
      state.scheduleEvents,
      state.scheduleBlocks,
    );
    expect(idsOf(feed)).toEqual(["se-1", "si-5", "se-2", "si-6"]);
    expect(feed.filter((e) => e.event.kind === "budowlane")).toHaveLength(2);
    expect(feed.filter((e) => e.event.kind === "dokumentacyjne")).toHaveLength(2);
    // The bridge block travels with the entry so the row can jump back.
    expect(feed.find((e) => e.event.id === "si-5")?.block?.id).toBe("sb-1a");
  });

  it("keeps other budowy out of the feed", () => {
    const state = buildDemoState();
    const feed = buildProjectFeed(
      "p-114",
      state.scheduleEvents,
      state.scheduleBlocks,
    );
    expect(idsOf(feed)).toEqual(["si-1", "si-3"]);
  });

  it("filters by kind and by documentary status", () => {
    expect(idsOf(repo.listProjectFeed("p-121", "budowlane"))).toEqual([
      "se-1",
      "se-2",
    ]);
    expect(idsOf(repo.listProjectFeed("p-121", "dokumentacyjne"))).toEqual([
      "si-5",
      "si-6",
    ]);
    expect(idsOf(repo.listProjectFeed("p-121", "do_wpisania"))).toEqual(["si-5"]);
    expect(idsOf(repo.listProjectFeed("p-121", "wpisane"))).toEqual(["si-6"]);
  });

  it("splits planned from history around today", () => {
    const feed = repo.listProjectFeed("p-121");
    const { planned, history } = partitionProjectFeed(feed, "2026-07-25");
    // Planned runs soonest-first, history stays newest-first.
    expect(idsOf(planned)).toEqual(["si-5", "se-1"]);
    expect(idsOf(history)).toEqual(["se-2", "si-6"]);

    const allPast = partitionProjectFeed(feed, "2027-01-01");
    expect(allPast.planned).toHaveLength(0);
    expect(idsOf(allPast.history)).toHaveLength(4);
  });

  it("keeps a documentary event in history when its block is deleted", () => {
    expect(
      repo.listScheduleEvents("p-121").find((e) => e.id === "si-5")?.blockId,
    ).toBe("sb-1a");
    repo.deleteScheduleBlock("sb-1a");
    const event = repo.listScheduleEvents("p-121").find((e) => e.id === "si-5");
    expect(event).toBeTruthy();
    expect(event?.blockId).toBe(null);
    expect(repo.listEventsForBlock("sb-1a")).toHaveLength(0);
    // The event stays in the chronology, just without a block chip.
    const entry = repo
      .listProjectFeed("p-121")
      .find((e) => e.event.id === "si-5");
    expect(entry?.block).toBe(null);
  });
});

describe("projectsPreview org feed (wszystkie budowy)", () => {
  let repo: ProjectsPreviewRepository;

  beforeEach(() => {
    repo = resetProjectsPreviewRepoForTests();
  });

  const idsOf = (entries: OrgFeedEntry[]) => entries.map((e) => e.event.id);

  it("merges budowy into one chronology and tags each entry with its projectId", () => {
    const state = buildDemoState();
    const feed = buildOrgFeed(
      ["p-114", "p-121"],
      state.scheduleEvents,
      state.scheduleBlocks,
    );
    const projectIds = new Set(feed.map((e) => e.projectId));
    expect(projectIds).toEqual(new Set(["p-114", "p-121"]));
    // Newest first, across budowy.
    const dates = feed.map((e) => e.at);
    expect(dates.slice().sort((a, b) => b.localeCompare(a))).toEqual(dates);
    expect(idsOf(feed)).toContain("si-1");
    expect(idsOf(feed)).toContain("se-1");
  });

  it("honours filter and limit, and hides budowy the viewer cannot see", () => {
    expect(
      repo.listOrgFeed("budowlane").every((e) => e.event.kind === "budowlane"),
    ).toBe(true);
    expect(repo.listOrgFeed("all", 2)).toHaveLength(2);

    repo.setViewAs("u-jacek");
    const visible = new Set(repo.listOrgFeed().map((e) => e.projectId));
    expect(visible.has("p-121")).toBe(false);
  });
});

describe("projectsPreview crews", () => {
  let repo: ProjectsPreviewRepository;

  beforeEach(() => {
    repo = resetProjectsPreviewRepoForTests();
  });

  it("creates and updates a crew", () => {
    const created = repo.upsertCrew({
      name: "Ekipa stolarska",
      color: "#8b5cf6",
      headcount: 5,
      supervisor: "Jan",
      company: "Drewno SA",
      phone: "123",
    });
    expect(created.name).toBe("Ekipa stolarska");
    expect(created.headcount).toBe(5);
    expect(created.supervisor).toBe("Jan");
    expect(repo.getState().crews.some((c) => c.id === created.id)).toBe(true);
    const updated = repo.upsertCrew({
      id: created.id,
      name: "Ekipa stolarska 2",
      color: "#ef4444",
      headcount: 4,
      supervisor: "Jan",
      company: "Drewno SA",
      phone: "123",
    });
    expect(updated.name).toBe("Ekipa stolarska 2");
    expect(updated.headcount).toBe(4);
  });

  it("blocks deleting a crew that is in use", () => {
    const res = repo.deleteCrew("crew-elew");
    expect(res.ok).toBe(false);
  });
});

describe("projectsPreview production flag", () => {
  it("is off unless VITE_PROJECTS_PREVIEW=1 (this suite runs without flag)", () => {
    // In default vitest env the flag is unset → module must report disabled.
    expect(isProjectsPreviewEnabled()).toBe(
      import.meta.env.VITE_PROJECTS_PREVIEW === "1",
    );
  });
});

describe("projectsPreview scheduleRowCollapse", () => {
  const sampleRows = [
    { id: "sec-a", section: true, projectId: "p-a", blocks: [] as { id: string }[] },
    {
      id: "cat-a1",
      categoryLane: true,
      projectId: "p-a",
      categoryId: "c1",
      blocks: [] as { id: string }[],
    },
    {
      id: "sub-a1",
      subcategory: true,
      projectId: "p-a",
      categoryId: "c1",
      blocks: [{ id: "sub-a1" }],
    },
    {
      id: "work-a1",
      parentId: "sub-a1",
      projectId: "p-a",
      categoryId: "c1",
      blocks: [{ id: "work-a1" }],
    },
    { id: "sec-b", section: true, projectId: "p-b", blocks: [] as { id: string }[] },
    {
      id: "cat-b1",
      categoryLane: true,
      projectId: "p-b",
      categoryId: "c1",
      blocks: [] as { id: string }[],
    },
  ];

  it("hides everything under a collapsed investment", () => {
    const collapsed = new Set([projectCollapseKey("p-a")]);
    const visible = filterCollapsedBoardRows(sampleRows, collapsed, 2).map(
      (r) => r.id,
    );
    expect(visible).toEqual(["sec-a", "sec-b", "cat-b1"]);
  });

  it("keeps category / subcategory collapse under open investments", () => {
    const collapsed = new Set([
      categoryCollapseKey("p-a", "c1"),
      subcategoryCollapseKey("sub-a1"),
    ]);
    const visible = filterCollapsedBoardRows(sampleRows, collapsed, 2).map(
      (r) => r.id,
    );
    expect(visible).toEqual(["sec-a", "cat-a1", "sec-b", "cat-b1"]);
  });

  it("shows project-level works even when revealLevel is categories-only", () => {
    const rows = [
      { id: "sec-a", section: true, projectId: "p-a", blocks: [] as { id: string }[] },
      {
        id: "work-inv",
        projectLevel: true,
        projectId: "p-a",
        categoryId: "__project__",
        blocks: [{ id: "work-inv" }],
      },
      {
        id: "cat-a1",
        categoryLane: true,
        projectId: "p-a",
        categoryId: "c1",
        blocks: [] as { id: string }[],
      },
    ];
    const visible = filterCollapsedBoardRows(rows, new Set(), 0).map((r) => r.id);
    expect(visible).toContain("work-inv");
    expect(visible).toContain("cat-a1");
  });

  it("keeps crew-lane works expanded regardless of revealLevel", () => {
    const rows = [
      {
        id: "sec-crew-1",
        section: true,
        crew: { id: "c1" },
        blocks: [] as { id: string }[],
      },
      { id: "work-1", indented: true, blocks: [{ id: "work-1" }] },
      {
        id: "sec-crew-none",
        section: true,
        blocks: [] as { id: string }[],
      },
      { id: "work-2", indented: true, blocks: [{ id: "work-2" }] },
    ];
    const visible = filterCollapsedBoardRows(rows, new Set(), 0).map((r) => r.id);
    expect(visible).toEqual([
      "sec-crew-1",
      "work-1",
      "sec-crew-none",
      "work-2",
    ]);
  });

  it("hides category and subcategory rows but keeps works when showCategoryRows is off", () => {
    const visible = filterCollapsedBoardRows(sampleRows, new Set(), 0, {
      showCategoryRows: false,
    }).map((r) => r.id);
    expect(visible).toEqual(["sec-a", "work-a1", "sec-b"]);
  });
});

describe("projectsPreview scheduleZoom", () => {
  it("clamps dayPx to min/max", () => {
    expect(clampDayPx(0.5)).toBe(DAY_PX_MIN);
    expect(clampDayPx(999)).toBe(DAY_PX_MAX);
    expect(clampDayPx(DAY_PX_DEFAULT)).toBe(DAY_PX_DEFAULT);
  });

  it("computes dayPx for a target visible window", () => {
    expect(dayPxForVisibleDays(1400, 14)).toBe(DAY_PX_MAX); // 100 → clamp 64
    expect(dayPxForVisibleDays(730, 730)).toBe(DAY_PX_MIN); // 1 → clamp 2
    expect(dayPxForVisibleDays(960, 30)).toBe(32);
  });

  it("picks tick level from dayPx thresholds", () => {
    expect(tickLevelForDayPx(32)).toBe("day");
    expect(tickLevelForDayPx(16)).toBe("week");
    expect(tickLevelForDayPx(8)).toBe("month");
    expect(tickLevelForDayPx(4)).toBe("quarter");
  });

  it("emits day ticks with weekday letters and week ticks on Mondays", () => {
    // 2024-07-01 is Monday
    const dayTicks = ticksForRange("2024-07-01", 7, 32);
    expect(dayTicks).toHaveLength(7);
    expect(dayTicks[0]?.weekday).toBeTruthy();
    expect(dayTicks[0]?.label).toBeTruthy();

    const weekTicks = ticksForRange("2024-07-01", 21, 16);
    expect(weekTicks.length).toBeGreaterThanOrEqual(3);
    expect(weekTicks.every((t) => t.label)).toBe(true);
  });

  it("computes Monday as the start of the PL week", () => {
    // 2026-07-28 is Tuesday → week starts 2026-07-27
    expect(startOfWeekIso("2026-07-28")).toBe("2026-07-27");
    // Sunday → previous Monday
    expect(startOfWeekIso("2026-07-26")).toBe("2026-07-20");
    expect(startOfWeekIso("2026-07-20")).toBe("2026-07-20");
  });

  it("scrollLeftForDayStart aligns day to chart left (no label offset)", () => {
    expect(
      scrollLeftForDayStart({
        rangeStart: "2026-07-01",
        dayPx: 32,
        iso: "2026-07-11",
      }),
    ).toBe(320);
  });

  it("expands short ranges to minDays while keeping content inside", () => {
    const short = {
      start: "2024-07-01",
      end: "2024-07-31",
      days: 31,
    };
    const expanded = expandRangeToMinDays(short, 730, "2024-07-15");
    expect(expanded.days).toBeGreaterThanOrEqual(730);
    expect(expanded.start <= short.start).toBe(true);
    expect(expanded.end >= short.end).toBe(true);
    expect(expandRangeToMinDays(short, null).days).toBe(31);
  });

  it("builds content range wide enough for all bar dates", () => {
    const range = buildScheduleContentRange(
      ["2026-08-01", "2027-07-31", "2026-07-29"],
      3,
      "2026-07-29",
    );
    expect(range.start <= "2026-07-29").toBe(true);
    expect(range.end >= "2027-07-31").toBe(true);
    expect(range.days).toBeGreaterThan(360);
  });
});

describe("projectsPreview dashboard schedule hints", () => {
  it("lists today and upcoming events for visible projects only", () => {
    const state = buildDemoState("u-ola");
    const { today, upcoming } = collectScheduleDashboardHints(state, {
      today: "2026-07-28",
    });
    expect(today.some((h) => h.id === "se-1")).toBe(true);
    expect(today.every((h) => h.date === "2026-07-28")).toBe(true);
    expect(upcoming.length).toBe(0);
    const asOutsider = collectScheduleDashboardHints(buildDemoState("u-outsider"), {
      today: "2026-07-28",
    });
    expect(asOutsider.today).toHaveLength(0);
  });
});

describe("projectsPreview dashboard schedule works", () => {
  it("splits in-progress vs starting-soon and pads to min 5", () => {
    const state = buildDemoState("u-ola");
    const { inProgress, startingSoon } = collectScheduleDashboardWorks(state, {
      today: "2026-07-28",
      soonDays: 10,
      minUpcoming: 5,
    });
    expect(inProgress.every((w) => w.inProgress)).toBe(true);
    expect(startingSoon.every((w) => w.startDate > "2026-07-28")).toBe(true);
    const futureWorks = state.scheduleBlocks.filter(
      (b) =>
        b.role === "work" &&
        b.startDate > "2026-07-28" &&
        b.status !== "zakonczone" &&
        b.status !== "wstrzymane",
    );
    if (futureWorks.length >= 5) {
      expect(startingSoon.length).toBeGreaterThanOrEqual(5);
    }
    if (inProgress[0]) {
      expect(formatScheduleWorkLine(inProgress[0])).toContain("#");
    }
    const asOutsider = collectScheduleDashboardWorks(buildDemoState("u-outsider"), {
      today: "2026-07-28",
    });
    expect(asOutsider.inProgress).toHaveLength(0);
    expect(asOutsider.startingSoon).toHaveLength(0);
  });

  it("interleaves schedule events among works by date", () => {
    const state = buildDemoState("u-ola");
    const { inProgress, startingSoon } = collectScheduleDashboardFeed(state, {
      today: "2026-07-28",
      soonDays: 10,
      minUpcoming: 5,
    });
    expect(inProgress.some((i) => i.type === "event" && i.event.id === "se-1")).toBe(
      true,
    );
    const dates = startingSoon.map((i) => i.sortDate);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
    expect(startingSoon.some((i) => i.type === "work")).toBe(true);
  });
});

describe("projectsPreview dashboard schedules collapse", () => {
  it("defaults collapsed when user has no active projects", () => {
    const state = buildDemoState("u-ola");
    expect(userBelongsToActiveProject(state.projects, "u-ola")).toBe(true);
    expect(userBelongsToActiveProject(state.projects, "u-outsider")).toBe(false);
    expect(
      resolveDashboardSchedulesCollapsed({
        userId: "u-outsider",
        projects: state.projects,
        stored: null,
      }),
    ).toBe(true);
    expect(
      resolveDashboardSchedulesCollapsed({
        userId: "u-ola",
        projects: state.projects,
        stored: null,
      }),
    ).toBe(false);
    expect(
      resolveDashboardSchedulesCollapsed({
        userId: "u-outsider",
        projects: state.projects,
        stored: false,
      }),
    ).toBe(false);
  });
});

describe("projectsPreview hierarchical window move", () => {
  let repo: ProjectsPreviewRepository;

  beforeEach(() => {
    repo = resetProjectsPreviewRepoForTests();
  });

  it("moves category children on shift, not on resize", () => {
    const projectId = "p-121";
    const categoryId = "stan-0";
    repo.upsertCategoryMeta({
      projectId,
      categoryId,
      title: "Stan zero",
      note: "",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    const sub = repo.upsertScheduleBlock({
      projectId,
      title: "Podkat",
      categoryId,
      scope: "test",
      role: "subcategory",
      parentId: null,
      crewId: "",
      startDate: "2026-01-05",
      endDate: "2026-01-20",
      status: "planowane",
      color: "#888",
      note: "",
    });
    const work = repo.upsertScheduleBlock({
      projectId,
      title: "Zakres",
      categoryId,
      scope: "test",
      role: "work",
      parentId: sub.id,
      crewId: "",
      startDate: "2026-01-08",
      endDate: "2026-01-12",
      status: "planowane",
      color: "#888",
      note: "",
    });

    repo.moveCategoryWindow(projectId, categoryId, "2026-02-01", "2026-03-03", {
      shiftChildrenByDays: 31,
    });
    expect(repo.getCategoryMeta(projectId, categoryId)?.startDate).toBe(
      "2026-02-01",
    );
    expect(repo.listSchedule().find((b) => b.id === sub.id)?.startDate).toBe(
      "2026-02-05",
    );
    expect(repo.listSchedule().find((b) => b.id === work.id)?.startDate).toBe(
      "2026-02-08",
    );

    repo.moveCategoryWindow(projectId, categoryId, "2026-02-01", "2026-04-01");
    expect(repo.listSchedule().find((b) => b.id === sub.id)?.startDate).toBe(
      "2026-02-05",
    );
    expect(repo.listSchedule().find((b) => b.id === work.id)?.startDate).toBe(
      "2026-02-08",
    );
  });

  it("moves subcategory ranges on shift, not on resize", () => {
    const sub = repo.upsertScheduleBlock({
      projectId: "p-121",
      title: "Podkat",
      categoryId: "stan-0",
      scope: "test",
      role: "subcategory",
      parentId: null,
      crewId: "",
      startDate: "2026-01-01",
      endDate: "2026-01-20",
      status: "planowane",
      color: "#888",
      note: "",
    });
    const work = repo.upsertScheduleBlock({
      projectId: "p-121",
      title: "Zakres",
      categoryId: "stan-0",
      scope: "test",
      role: "work",
      parentId: sub.id,
      crewId: "",
      startDate: "2026-01-05",
      endDate: "2026-01-10",
      status: "planowane",
      color: "#888",
      note: "",
    });

    repo.moveScheduleBlock(sub.id, "2026-01-11", "2026-01-30", {
      shiftChildrenByDays: 10,
    });
    expect(repo.listSchedule().find((b) => b.id === work.id)?.startDate).toBe(
      "2026-01-15",
    );
    expect(repo.listSchedule().find((b) => b.id === work.id)?.endDate).toBe(
      "2026-01-20",
    );

    repo.moveScheduleBlock(sub.id, "2026-01-11", "2026-02-15");
    expect(repo.listSchedule().find((b) => b.id === work.id)?.startDate).toBe(
      "2026-01-15",
    );
    expect(repo.listSchedule().find((b) => b.id === work.id)?.endDate).toBe(
      "2026-01-20",
    );
  });
});
