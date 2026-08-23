import { buildNadzorPodstawowyPreset } from "./catalogPreset";
import { buildBudowaScheduleCatalog } from "./scheduleCatalog";
import type {
  PreviewCrew,
  PreviewProject,
  PreviewUser,
  ProjectsPreviewState,
  ScheduleBlock,
  ScheduleEvent,
} from "./types";

export const PREVIEW_STORAGE_KEY = "dodo-schedules-local-v1";
/** Legacy preview keys — never auto-load demo blobs into the app module. */
export const PREVIEW_STORAGE_KEY_V7 = "dodo-projects-preview-v7";
export const PREVIEW_STORAGE_KEY_V6 = "dodo-projects-preview-v6";
export const PREVIEW_STORAGE_KEY_V5 = "dodo-projects-preview-v5";
export const PREVIEW_ORG_ID = "preview-org-demo";

export const DEMO_USERS: PreviewUser[] = [
  { id: "u-admin", displayName: "Anna Kowalska" },
  { id: "u-jacek", displayName: "Jacek Nowak" },
  { id: "u-ola", displayName: "Ola Wiśniewska" },
  { id: "u-marek", displayName: "Marek Zieliński" },
  { id: "u-outsider", displayName: "Tomek Gość" },
];

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildDemoState(viewAsUserId = "u-admin"): ProjectsPreviewState {
  const catalog = buildNadzorPodstawowyPreset();
  const projects: PreviewProject[] = [
    {
      id: "p-114",
      orgId: PREVIEW_ORG_ID,
      number: "114",
      name: "Vestino - Więcbork",
      adminUserId: "u-admin",
      memberIds: ["u-admin", "u-jacek", "u-ola"],
      createdAt: "2026-06-01T10:00:00.000Z",
      status: "active",
    },
    {
      id: "p-115",
      orgId: PREVIEW_ORG_ID,
      number: "115",
      name: "Dom jednorodzinny - Sępólno",
      adminUserId: "u-admin",
      memberIds: ["u-admin", "u-jacek", "u-marek"],
      createdAt: "2026-06-02T10:00:00.000Z",
      status: "active",
    },
    {
      id: "p-121",
      orgId: PREVIEW_ORG_ID,
      number: "121",
      name: "Osiedle Leśne",
      adminUserId: "u-admin",
      memberIds: ["u-admin", "u-ola", "u-marek"],
      createdAt: "2026-06-03T10:00:00.000Z",
      status: "active",
    },
    // Cold start: no schedule, no events — demonstrates the empty budowa flow.
    {
      id: "p-140",
      orgId: PREVIEW_ORG_ID,
      number: "140",
      name: "Parking przy ul. Lipowej",
      adminUserId: "u-admin",
      memberIds: ["u-admin", "u-ola"],
      createdAt: "2026-07-24T10:00:00.000Z",
      status: "active",
    },
  ];

  const crews: PreviewCrew[] = [
    {
      id: "crew-elew",
      name: "Brygada elewacyjna",
      color: "#6b8ab8",
      headcount: 6,
      supervisor: "Piotr Lewandowski",
      company: "Elewacje Nord Sp. z o.o.",
      phone: "+48 500 100 200",
      members: [],
      viewerUserIds: [],
      createdByUserId: "u-admin",
    },
    {
      id: "crew-dach",
      name: "Brygada dachowa",
      color: "#c4a35a",
      headcount: 4,
      supervisor: "Marcin Kowalski",
      company: "Dach-Pro",
      phone: "+48 501 200 300",
      members: [],
      viewerUserIds: [],
      createdByUserId: "u-admin",
    },
    {
      id: "crew-inst",
      name: "Instalacje",
      color: "#5a9e84",
      headcount: 3,
      supervisor: "Anna Wiśniewska",
      company: "Instal-Plus",
      phone: "+48 502 300 400",
      members: [],
      viewerUserIds: [],
      createdByUserId: "u-admin",
    },
  ];

  const scheduleBlocks: ScheduleBlock[] = [
    {
      id: "sb-1",
      projectId: "p-121",
      categoryId: "deweloperski-zew",
      scope: "Termoizolacja ścian",
      title: "Elewacja — budynek A",
      role: "subcategory",
      parentId: null,
      crewId: "",
      startDate: "2026-07-20",
      endDate: "2026-07-31",
      status: "planowane",
      color: "#6b8ab8",
      note: "Okno podkategorii elewacji",
    },
    {
      id: "sb-1a",
      projectId: "p-121",
      categoryId: "deweloperski-zew",
      scope: "Termoizolacja ścian",
      title: "Klejenie styropianu",
      role: "work",
      parentId: "sb-1",
      crewId: "crew-elew",
      startDate: "2026-07-20",
      endDate: "2026-07-25",
      status: "w_realizacji",
      color: "#6b8ab8",
      note: "",
    },
    {
      id: "sb-1b",
      projectId: "p-121",
      categoryId: "deweloperski-zew",
      scope: "Termoizolacja ścian",
      title: "Tynk elewacyjny",
      role: "work",
      parentId: "sb-1",
      crewId: "crew-elew",
      startDate: "2026-07-26",
      endDate: "2026-07-31",
      status: "planowane",
      color: "#8aa0c4",
      note: "",
    },
    {
      id: "sb-1c",
      projectId: "p-121",
      categoryId: "deweloperski-zew",
      scope: "Termoizolacja ścian",
      title: "Rusztowania — demontaż",
      role: "work",
      parentId: "sb-1",
      crewId: "crew-elew",
      startDate: "2026-08-01",
      endDate: "2026-08-04",
      status: "planowane",
      color: "#a8b8d4",
      note: "Wychodzi poza okno podkategorii (demo overflow)",
    },
    {
      id: "sb-2",
      projectId: "p-121",
      categoryId: "stan-surowy-zamkniety",
      scope: "Konstrukcja dachu",
      title: "Dach — budynek B",
      role: "work",
      parentId: null,
      crewId: "crew-dach",
      startDate: "2026-07-22",
      endDate: "2026-08-05",
      status: "potwierdzone",
      color: "#c4a35a",
      note: "",
    },
    {
      id: "sb-3",
      projectId: "p-121",
      categoryId: "instalacje",
      scope: "Instalacje sanitarne",
      title: "Instalacje CO",
      role: "work",
      parentId: null,
      crewId: "crew-inst",
      startDate: "2026-08-01",
      endDate: "2026-08-12",
      status: "planowane",
      color: "#5a9e84",
      note: "",
    },
  ];

  const scheduleEvents: ScheduleEvent[] = [
    {
      id: "se-1",
      projectId: "p-121",
      // Podkategoria elewacji — nie robota.
      blockId: "sb-1",
      categoryId: "deweloperski-zew",
      kind: "budowlane",
      title: "Przyjedzie dźwig do układania stropu",
      date: "2026-07-28",
      note: "Potwierdzić godzinę z brygadą",
    },
    {
      id: "se-2",
      projectId: "p-121",
      // Tylko kategoria — wiersz „Stan surowy zamknięty”.
      blockId: null,
      categoryId: "stan-surowy-zamkniety",
      kind: "budowlane",
      title: "Dostawa więźby",
      date: "2026-07-24",
      note: "",
    },
    {
      id: "si-1",
      projectId: "p-114",
      blockId: null,
      kind: "dokumentacyjne",
      title: "Zakończono zbrojenie fundamentów.",
      date: "2026-07-20",
      note: "",
      status: "do_wpisania",
      categoryId: "stan-0",
      activity: "Zakończono zbrojenie fundamentów.",
      reportedByUserId: "u-ola",
      writtenAt: null,
      writtenByUserId: null,
    },
    {
      id: "si-2",
      projectId: "p-115",
      blockId: null,
      kind: "dokumentacyjne",
      title: "Rozpoczęto montaż konstrukcji dachu",
      date: "2026-07-22",
      note: "",
      status: "do_wpisania",
      categoryId: "stan-surowy-zamkniety",
      activity: "Rozpoczęto montaż konstrukcji dachu",
      reportedByUserId: "u-marek",
      writtenAt: null,
      writtenByUserId: null,
    },
    {
      id: "si-3",
      projectId: "p-114",
      blockId: null,
      kind: "dokumentacyjne",
      title: "Objąłem funkcję kierownika budowy dla przedmiotowej inwestycji.",
      date: "2026-06-05",
      note: "",
      status: "wpisane",
      categoryId: "wpisy-wstepne",
      activity:
        "Objąłem funkcję kierownika budowy dla przedmiotowej inwestycji.",
      reportedByUserId: "u-admin",
      writtenAt: "2026-06-06",
      writtenByUserId: "u-admin",
    },
    {
      id: "si-4",
      projectId: "p-115",
      blockId: null,
      kind: "dokumentacyjne",
      title: "Rozpoczęto wykopy pod fundamenty",
      date: "2026-07-18",
      note: "Sprawdzić głębokość",
      status: "do_sprawdzenia",
      categoryId: "stan-0",
      activity: "Rozpoczęto wykopy pod fundamenty",
      reportedByUserId: "u-jacek",
      writtenAt: null,
      writtenByUserId: null,
    },
    {
      id: "si-5",
      projectId: "p-121",
      // Opcjonalne powiązanie z robotą (demo mostu).
      blockId: "sb-1a",
      kind: "dokumentacyjne",
      title: "Odbiór robót elewacyjnych — budynek A",
      date: "2026-07-26",
      note: "",
      status: "do_wpisania",
      categoryId: "deweloperski-zew",
      activity: "Odbiór robót elewacyjnych — budynek A",
      reportedByUserId: "u-ola",
      writtenAt: null,
      writtenByUserId: null,
    },
    {
      id: "si-6",
      projectId: "p-121",
      blockId: null,
      kind: "dokumentacyjne",
      title: "Objąłem funkcję kierownika budowy dla przedmiotowej inwestycji.",
      date: "2026-06-10",
      note: "",
      status: "wpisane",
      categoryId: "wpisy-wstepne",
      activity:
        "Objąłem funkcję kierownika budowy dla przedmiotowej inwestycji.",
      reportedByUserId: "u-admin",
      writtenAt: "2026-06-11",
      writtenByUserId: "u-admin",
    },
  ];

  return {
    version: 1,
    orgId: PREVIEW_ORG_ID,
    users: DEMO_USERS,
    viewAsUserId,
    projects,
    nextNumberHint: 141,
    catalog,
    scheduleCatalog: buildBudowaScheduleCatalog(),
    crews,
    scheduleBlocks,
    scheduleEvents,
    categoryMeta: [],
    crewAttendance: [],
    crewEquipmentLogs: [],
  };
}

export function emptyishState(): ProjectsPreviewState {
  return buildEmptyScheduleState();
}

/**
 * Produkcyjny / DEV start: puste budowy, katalogi z presetów, jeden użytkownik.
 * Bez DEMO_USERS i bez przykładowych projektów.
 */
export function buildEmptyScheduleState(opts?: {
  orgId?: string;
  userId?: string;
  displayName?: string;
}): ProjectsPreviewState {
  const userId = opts?.userId?.trim() || "local-user";
  const displayName = opts?.displayName?.trim() || "Ty";
  return {
    version: 1,
    orgId: opts?.orgId?.trim() || "local-schedules",
    users: [{ id: userId, displayName }],
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

export { uid };
