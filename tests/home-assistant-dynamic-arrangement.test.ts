import { describe, expect, it } from "vitest";

import { buildTodayArrangementSummary } from "@/lib/home-assistant";

describe("home assistant dynamic arrangement", () => {
  it("uses remaining windows based on current time", () => {
    const summary = buildTodayArrangementSummary({
      courseContext: {
        todayCourses: [],
        todayCourseSummary: "今天没有课程。",
        todayFreeWindowSummary: "",
        todayArrangementSummary: "",
      },
      mustDoTasks: [],
      shouldDoTasks: [],
      reminderTasks: [],
      canWaitTasks: [],
      baseInput: "2026-03-26T23:17:00+08:00",
    } as any);

    expect(summary).toContain("剩余可执行空档：今天剩余可执行空档已结束");
    expect(summary).not.toContain("09:00");
  });

  it("prioritizes tasks that can fit in remaining windows", () => {
    const summary = buildTodayArrangementSummary({
      courseContext: {
        todayCourses: [],
        todayCourseSummary: "今天没有课程。",
        todayFreeWindowSummary: "",
        todayArrangementSummary: "",
      },
      mustDoTasks: [
        {
          id: "long",
          title: "长任务",
          estimatedMinutes: 120,
          deadline: new Date("2026-03-26T14:00:00+08:00"),
          priorityScore: 95,
          startAt: null,
        },
        {
          id: "short",
          title: "短任务",
          estimatedMinutes: 20,
          deadline: new Date("2026-03-26T20:50:00+08:00"),
          priorityScore: 80,
          startAt: null,
        },
      ],
      shouldDoTasks: [],
      reminderTasks: [],
      canWaitTasks: [],
      baseInput: "2026-03-26T20:20:00+08:00",
    } as any);

    expect(summary).toContain("建议优先：短任务、长任务");
  });
});
