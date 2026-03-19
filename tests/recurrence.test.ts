import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import { getRecurrenceSummary, getTaskProgress } from "@/lib/recurrence";

describe("recurrence progress", () => {
  it("tracks daily multi-count progress", () => {
    const base = dayjs.tz("2026-03-18 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const result = getTaskProgress(
      {
        recurrenceType: "daily",
        recurrenceTargetCount: 3,
        progressLogs: [
          { completedAt: "2026-03-18T01:00:00.000Z" },
          { completedAt: "2026-03-18T03:00:00.000Z" },
        ],
      },
      base,
    );

    expect(result.currentCount).toBe(2);
    expect(result.completed).toBe(false);
    expect(result.helperText).toContain("2/3");
  });

  it("treats unscheduled weekdays as inactive today", () => {
    const base = dayjs.tz("2026-03-18 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const result = getTaskProgress(
      {
        recurrenceType: "weekly",
        recurrenceDays: [1, 5],
        recurrenceTargetCount: 1,
        progressLogs: [],
      },
      base,
    );

    expect(result.activeToday).toBe(false);
    expect(result.helperText).toContain("下次是");
  });

  it("summarizes limited recurrence", () => {
    expect(
      getRecurrenceSummary({
        recurrenceType: "limited",
        recurrenceTargetCount: 2,
        recurrenceLimit: 5,
      }),
    ).toContain("共 5 次");
  });
});
