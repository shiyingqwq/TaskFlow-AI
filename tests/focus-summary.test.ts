import { describe, expect, it } from "vitest";

import { buildFocusSummaryFallback } from "@/lib/focus-summary";

describe("focus summary fallback", () => {
  it("summarizes the current main task when there is a clear focus", () => {
    const summary = buildFocusSummaryFallback({
      databaseReady: true,
      focusMode: "task",
      totalTaskCount: 6,
      reviewCount: 1,
      dueWaitingCount: 1,
      blockedCount: 1,
      topTaskTitles: ["填写本期入党积极分子名单表", "加入本期入党积极分子群"],
      currentBestTask: {
        title: "填写本期入党积极分子名单表",
        deadline: new Date("2026-03-20T10:00:00.000Z"),
        nextActionSuggestion: "先核对要求，再推进最小可执行的一步。",
      },
      focusReviewTask: null,
      focusWaitingTask: null,
      focusBlockedTask: null,
      tasks: [
        {
          title: "填写本期入党积极分子名单表",
          status: "ready",
          displayStatus: "ready",
          priorityScore: 95,
          needsHumanReview: false,
        },
      ],
    });

    expect(summary).toContain("今天盘子里当前还有 6 条活跃任务");
    expect(summary).toContain("今天主线先盯「填写本期入党积极分子名单表」");
    expect(summary).toContain("可以先放一放");
  });

  it("switches to a review-focused overview when no executable main task is available", () => {
    const summary = buildFocusSummaryFallback({
      databaseReady: true,
      focusMode: "review",
      totalTaskCount: 4,
      reviewCount: 2,
      dueWaitingCount: 0,
      blockedCount: 1,
      topTaskTitles: ["确认公示名单", "整理签到表"],
      currentBestTask: null,
      focusReviewTask: {
        title: "确认公示名单",
      },
      focusWaitingTask: null,
      focusBlockedTask: null,
      tasks: [
        {
          title: "确认公示名单",
          status: "needs_review",
          displayStatus: "needs_review",
          priorityScore: 72,
          needsHumanReview: true,
        },
      ],
    });

    expect(summary).toContain("2 条待确认");
    expect(summary).toContain("最该先清的是待确认项「确认公示名单」");
  });

  it("does not count completed tasks as active work", () => {
    const summary = buildFocusSummaryFallback({
      databaseReady: true,
      focusMode: "empty",
      totalTaskCount: 2,
      reviewCount: 0,
      dueWaitingCount: 0,
      blockedCount: 0,
      topTaskTitles: [],
      currentBestTask: null,
      focusReviewTask: null,
      focusWaitingTask: null,
      focusBlockedTask: null,
      tasks: [
        {
          title: "填写表格",
          status: "done",
          displayStatus: "done",
          priorityScore: -100,
          needsHumanReview: false,
        },
        {
          title: "加入群聊",
          status: "done",
          displayStatus: "done",
          priorityScore: -100,
          needsHumanReview: false,
        },
      ],
    });

    expect(summary).toContain("没有活跃任务");
    expect(summary).toContain("2 条都处理结束了");
  });
});
