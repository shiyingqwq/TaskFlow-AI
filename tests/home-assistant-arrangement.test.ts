import { describe, expect, it } from "vitest";

import { buildTodayFreeWindowSummary } from "@/lib/home-assistant";

describe("home assistant arrangement summary", () => {
  it("returns ended message when current time is after day end", () => {
    const summary = buildTodayFreeWindowSummary([], "2026-03-25T23:17:00+08:00");
    expect(summary).toContain("剩余可执行空档已结束");
  });

  it("computes remaining windows from current time instead of full-day windows", () => {
    const summary = buildTodayFreeWindowSummary(
      [
        {
          id: "course-1",
          title: "晚课",
          weekday: 3,
          startTime: "19:30",
          endTime: "20:30",
          location: null,
        },
      ],
      "2026-03-25T19:00:00+08:00",
    );

    expect(summary).toContain("19:00-19:30");
    expect(summary).toContain("20:30-21:30");
    expect(summary).not.toContain("09:00");
  });
});
