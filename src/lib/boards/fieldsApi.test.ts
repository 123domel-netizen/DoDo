import { describe, expect, it } from "vitest";
import { rowToField, rowToTopic } from "@/lib/boards/api";

describe("rowToField / field_values", () => {
  it("mapuje pole z opcjami i viewerami", () => {
    const f = rowToField({
      id: "f1",
      board_id: "b1",
      name: "Status",
      kind: "single",
      visibility: "all",
      sort_order: 1,
      options: [
        { id: "o1", label: "Nowe", sort_order: 1 },
        { id: "o2", label: "W toku", sort_order: 2 },
      ],
      viewer_ids: ["u2"],
    });
    expect(f.kind).toBe("single");
    expect(f.options).toHaveLength(2);
    expect(f.viewerIds).toEqual(["u2"]);
  });

  it("parsuje field_values w temacie", () => {
    const t = rowToTopic({
      id: "t1",
      board_id: "b1",
      title: "X",
      description: "",
      created_by: null,
      pinned_at: null,
      snoozed_until: null,
      closed_at: null,
      closed_by: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      code: null,
      locality: "Chojnice",
      sort_order: 1,
      conversation_id: "c1",
      last_activity_at: "2026-10-01T00:00:00Z",
      comment_count: 0,
      unread_count: 0,
      last_comment: null,
      items: [],
      field_values: {
        f1: { text: "ok", optionIds: [] },
        f2: { text: null, optionIds: ["o1", "o2"] },
      },
    });
    expect(t.fieldValues.f1).toEqual({ text: "ok", optionIds: [] });
    expect(t.fieldValues.f2?.optionIds).toEqual(["o1", "o2"]);
    expect(t.locality).toBe("Chojnice");
  });

  it("puste field_values gdy brak kolumny", () => {
    const t = rowToTopic({
      id: "t1",
      board_id: "b1",
      title: "X",
      description: "",
      created_by: null,
      pinned_at: null,
      snoozed_until: null,
      closed_at: null,
      closed_by: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      code: null,
      sort_order: 1,
      conversation_id: "c1",
      last_activity_at: "2026-10-01T00:00:00Z",
      comment_count: 0,
      unread_count: 0,
      last_comment: null,
      items: [],
    });
    expect(t.fieldValues).toEqual({});
  });
});
