import { describe, expect, it, beforeEach } from "vitest";
import { parseBulkProjects } from "./bulkParse";
import { findCrewConflicts } from "./crewConflicts";
import { isProjectsPreviewEnabled } from "./enabled";
import { normalizeSearchText } from "./normalize";
import { applyProjectRef, projectQueryAt } from "./projectRefs";
import {
  resetProjectsPreviewRepoForTests,
  type ProjectsPreviewRepository,
} from "./repository";
import { searchProjects, visibleProjects } from "./search";
import { buildDemoState } from "./demoSeed";

describe("projectsPreview normalize + search", () => {
  it("strips Polish diacritics", () => {
    expect(normalizeSearchText("Więcbork")).toBe("wiecbork");
    expect(normalizeSearchText("Sępólno")).toBe("sepolno");
  });

  it("finds by number, name fragment, and ascii", () => {
    const projects = buildDemoState().projects;
    expect(searchProjects(projects, "114")[0]?.project.number).toBe(114);
    expect(searchProjects(projects, "Vestino")[0]?.project.number).toBe(114);
    expect(searchProjects(projects, "Wiecbork")[0]?.project.number).toBe(114);
    expect(searchProjects(projects, "vest")[0]?.project.number).toBe(114);
    expect(searchProjects(projects, "wiec")[0]?.project.number).toBe(114);
    expect(searchProjects(projects, "więc")[0]?.project.number).toBe(114);
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
    expect(asJacek.map((p) => p.number).sort()).toEqual([114, 115, 130]);
  });
});

describe("projectsPreview bulk parser", () => {
  it("parses mode A and detects conflicts", () => {
    const text = [
      "114; Vestino - Więcbork; Nadzór budowy",
      "200; Nowy; Budowa",
      "xxx; Bad; Budowa",
      "201; ; Budowa",
      "202; X; Nieznany",
    ].join("\n");
    const res = parseBulkProjects(text, {
      mode: "a",
      existingNumbers: new Set([114]),
    });
    expect(res.okCount).toBe(1);
    const line1 = res.rows.find((r) => r.line === 1);
    expect(line1 && !line1.ok && line1.error).toBe("number_exists");
    expect(res.rows.find((r) => r.line === 2 && r.ok)?.number).toBe(200);
    expect(res.rows.find((r) => r.line === 3)?.ok).toBe(false);
    const line5 = res.rows.find((r) => r.line === 5);
    expect(line5 && !line5.ok && line5.error).toBe("unknown_kind");
  });

  it("parses mode B with shared kind", () => {
    const res = parseBulkProjects("210 Alpha\n211 Beta", {
      mode: "b",
      sharedKind: "budowa",
      existingNumbers: new Set(),
    });
    expect(res.okCount).toBe(2);
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
      number: 114,
      name: "Duplikat",
      kind: "inny",
      memberIds: [],
    });
    expect(fail.ok).toBe(false);
    const ok = repo.createProject({
      number: 999,
      name: "Test",
      kind: "inny",
      memberIds: ["u-ola"],
    });
    expect(ok.ok).toBe(true);
  });

  it("picker only lists visible projects", () => {
    repo.setViewAs("u-outsider");
    expect(repo.visibleProjectList()).toHaveLength(0);
    repo.setViewAs("u-jacek");
    expect(repo.visibleProjectList().every((p) => p.number !== 121)).toBe(true);
  });

  it("filters messages by project ref", () => {
    const msgs = repo.listMessages("p-114");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.projectRefs[0]?.projectNumber).toBe(114);
  });

  it("blocks tagging invisible project", () => {
    repo.setViewAs("u-outsider");
    expect(() =>
      repo.sendMessage("x", [
        {
          entityType: "project",
          entityId: "p-114",
          projectNumber: 114,
          labelSnapshot: "#114 Vestino - Więcbork",
        },
      ]),
    ).toThrow();
  });

  it("lists Do wpisania across nadzor projects", () => {
    const list = repo.listToWrite();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((i) => i.status === "do_wpisania")).toBe(true);
  });
});

describe("projectsPreview crew conflicts", () => {
  it("detects overlapping crew assignments", () => {
    const conflicts = findCrewConflicts([
      {
        id: "a",
        projectId: "p1",
        title: "A",
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
});

describe("projectsPreview # query", () => {
  it("detects and applies project chip", () => {
    const q = projectQueryAt("Hej #11", 7);
    expect(q?.query).toBe("11");
    const next = applyProjectRef("Hej #11", 7, q!, "#114 Vestino - Więcbork");
    expect(next.text).toContain("#114 Vestino - Więcbork");
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
