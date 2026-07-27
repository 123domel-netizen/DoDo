import { buildNadzorPodstawowyPreset } from "./catalogPreset";
import type {
  PreviewChatMessage,
  PreviewCrew,
  PreviewProject,
  PreviewUser,
  ProjectsPreviewState,
  ScheduleBlock,
  SupervisionItem,
} from "./types";

export const PREVIEW_STORAGE_KEY = "dodo-projects-preview-v1";
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
      number: 114,
      name: "Vestino - Więcbork",
      kind: "nadzor",
      adminUserId: "u-admin",
      memberIds: ["u-admin", "u-jacek", "u-ola"],
      createdAt: "2026-06-01T10:00:00.000Z",
      status: "active",
    },
    {
      id: "p-115",
      orgId: PREVIEW_ORG_ID,
      number: 115,
      name: "Dom jednorodzinny - Sępólno",
      kind: "nadzor",
      adminUserId: "u-admin",
      memberIds: ["u-admin", "u-jacek", "u-marek"],
      createdAt: "2026-06-02T10:00:00.000Z",
      status: "active",
    },
    {
      id: "p-121",
      orgId: PREVIEW_ORG_ID,
      number: 121,
      name: "Osiedle Leśne",
      kind: "budowa",
      adminUserId: "u-admin",
      memberIds: ["u-admin", "u-ola", "u-marek"],
      createdAt: "2026-06-03T10:00:00.000Z",
      status: "active",
    },
    {
      id: "p-130",
      orgId: PREVIEW_ORG_ID,
      number: 130,
      name: "PZT Więcbork",
      kind: "projektowanie",
      adminUserId: "u-jacek",
      memberIds: ["u-jacek", "u-admin"],
      createdAt: "2026-06-04T10:00:00.000Z",
      status: "active",
    },
  ];

  const crews: PreviewCrew[] = [
    { id: "crew-elew", name: "Ekipa elewacyjna", color: "#3b82f6" },
    { id: "crew-dach", name: "Ekipa dachowa", color: "#f59e0b" },
    { id: "crew-inst", name: "Instalacje", color: "#10b981" },
  ];

  const scheduleBlocks: ScheduleBlock[] = [
    {
      id: "sb-1",
      projectId: "p-121",
      title: "Elewacja — budynek A",
      crewId: "crew-elew",
      startDate: "2026-07-20",
      endDate: "2026-07-31",
      status: "w_realizacji",
      color: "#3b82f6",
      note: "Potwierdź termin elewacji",
    },
    {
      id: "sb-2",
      projectId: "p-121",
      title: "Dach — budynek B",
      crewId: "crew-dach",
      startDate: "2026-07-22",
      endDate: "2026-08-05",
      status: "potwierdzone",
      color: "#f59e0b",
      note: "",
    },
    {
      id: "sb-3",
      projectId: "p-121",
      title: "Instalacje CO",
      crewId: "crew-inst",
      startDate: "2026-08-01",
      endDate: "2026-08-12",
      status: "planowane",
      color: "#10b981",
      note: "",
    },
  ];

  const supervisionItems: SupervisionItem[] = [
    {
      id: "si-1",
      projectId: "p-114",
      categoryId: "stan-zero",
      activity: "Zbrojenie fundamentów",
      status: "do_wpisania",
      noticedAt: "2026-07-20",
      note: "Zakończono zbrojenie fundamentów",
      reportedByUserId: "u-ola",
      writtenAt: null,
      writtenByUserId: null,
    },
    {
      id: "si-2",
      projectId: "p-115",
      categoryId: "stan-surowy-zamkniety",
      activity: "Konstrukcja dachu",
      status: "do_wpisania",
      noticedAt: "2026-07-22",
      note: "Rozpoczęto montaż konstrukcji dachu",
      reportedByUserId: "u-marek",
      writtenAt: null,
      writtenByUserId: null,
    },
    {
      id: "si-3",
      projectId: "p-114",
      categoryId: "wpisy-wstepne",
      activity: "Przekazanie placu budowy",
      status: "wpisane",
      noticedAt: "2026-06-05",
      note: "",
      reportedByUserId: "u-admin",
      writtenAt: "2026-06-06",
      writtenByUserId: "u-admin",
    },
    {
      id: "si-4",
      projectId: "p-115",
      categoryId: "stan-zero",
      activity: "Wykopy fundamentowe",
      status: "do_sprawdzenia",
      noticedAt: "2026-07-18",
      note: "Sprawdzić głębokość",
      reportedByUserId: "u-jacek",
      writtenAt: null,
      writtenByUserId: null,
    },
  ];

  const messages: PreviewChatMessage[] = [
    {
      id: "m1",
      authorUserId: "u-admin",
      body: "#114 Vestino - Więcbork zrób PZT-kę @Jacek",
      createdAt: "2026-07-25T09:12:00.000Z",
      projectRefs: [
        {
          entityType: "project",
          entityId: "p-114",
          projectNumber: 114,
          labelSnapshot: "#114 Vestino - Więcbork",
        },
      ],
      mentionNames: ["Jacek"],
    },
    {
      id: "m2",
      authorUserId: "u-ola",
      body: "#121 Osiedle Leśne potwierdź termin elewacji",
      createdAt: "2026-07-25T10:05:00.000Z",
      projectRefs: [
        {
          entityType: "project",
          entityId: "p-121",
          projectNumber: 121,
          labelSnapshot: "#121 Osiedle Leśne",
        },
      ],
      mentionNames: [],
    },
    {
      id: "m3",
      authorUserId: "u-marek",
      body: "#115 Dom jednorodzinny - Sępólno sprawdź, czy można wpisać zakończenie zbrojenia fundamentów",
      createdAt: "2026-07-25T11:40:00.000Z",
      projectRefs: [
        {
          entityType: "project",
          entityId: "p-115",
          projectNumber: 115,
          labelSnapshot: "#115 Dom jednorodzinny - Sępólno",
        },
      ],
      mentionNames: [],
    },
  ];

  return {
    version: 1,
    orgId: PREVIEW_ORG_ID,
    users: DEMO_USERS,
    viewAsUserId,
    projects,
    nextNumberHint: 131,
    catalog,
    supervisionItems,
    crews,
    scheduleBlocks,
    messages,
  };
}

export function emptyishState(): ProjectsPreviewState {
  return {
    ...buildDemoState(),
    projects: [],
    supervisionItems: [],
    scheduleBlocks: [],
    messages: [],
    nextNumberHint: 1,
  };
}

export { uid };
