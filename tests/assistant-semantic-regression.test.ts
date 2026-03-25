import { describe, expect, it } from "vitest";

import { resolveLocalAssistantPlanForTest } from "@/lib/home-assistant";
import { assistantSemanticModules, type AssistantSemanticCase } from "./fixtures/assistant-semantic-cases";

type LiteTask = ReturnType<typeof createTask>;

function createTask(overrides: Partial<{
  id: string;
  title: string;
  status: "ready" | "waiting" | "needs_review" | "in_progress" | "done";
  deadline: Date | null;
  nextActionSuggestion: string;
  priorityReason: string;
  priorityScore: number;
}> = {}) {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "复习当天核医学课程",
    status: overrides.status ?? "ready",
    deadline: overrides.deadline ?? new Date("2026-03-25T10:00:00.000Z"),
    submitTo: "老师",
    submitChannel: "线上",
    needsHumanReview: false,
    waitingReasonType: null,
    waitingReasonText: null,
    waitingFor: null,
    nextCheckAt: null,
    nextActionSuggestion: overrides.nextActionSuggestion ?? "先核对要求，再推进最小可执行的一步。",
    priorityReason: overrides.priorityReason ?? "今天优先处理。",
    priorityScore: overrides.priorityScore ?? 88,
  };
}

function run(message: string, tasks: LiteTask[]) {
  return resolveLocalAssistantPlanForTest({
    message,
    tasks,
    currentBestTask: tasks[0] ?? null,
    topTasksForToday: tasks.slice(0, 3),
    reviewTasks: tasks.filter((t) => t.status === "needs_review"),
    waitingTasks: tasks.filter((t) => t.status === "waiting"),
    dueWaitingTasks: [],
    courseContext: {
      todayCourseSummary: "08:00-09:30 核医学@1阶；09:40-11:10 医学心理学@1阶；14:30-16:50 卫生学@1阶",
      todayFreeWindowSummary: "11:10-14:30，16:50-21:30",
    },
  });
}

describe("assistant semantic regression set", () => {
  const tasks = [
    createTask({ id: "t-a", title: "复习当天核医学课程", status: "in_progress" }),
    createTask({ id: "t-b", title: "复习当天医学心理学课程", status: "ready" }),
    createTask({ id: "t-c", title: "复习当天卫生学课程", status: "ready" }),
    createTask({ id: "t-d", title: "待确认任务", status: "needs_review" }),
    createTask({ id: "t-e", title: "等待材料任务", status: "waiting" }),
  ];
  const allCases = assistantSemanticModules.flatMap((group) => group.cases);

  const assertCase = (item: AssistantSemanticCase) => {
    const result = run(item.message, tasks);
    expect(result).toBeTruthy();
    expect(result?.actions).toEqual([]);

    if (item.expectState === "summary") {
      expect(result?.pendingAction ?? null, item.message).toBeNull();
      expect(result?.clarifyState ?? null, item.message).toBeNull();
      return;
    }

    if (item.expectState === "pending") {
      expect(result?.pendingAction, item.message).not.toBeNull();
      return;
    }

    if (item.expectState === "clarify") {
      expect(result?.pendingAction ?? null, item.message).toBeNull();
      expect(result?.clarifyState ?? null, item.message).not.toBeNull();
      return;
    }

    const hasPending = Boolean(result?.pendingAction);
    const hasClarify = Boolean(result?.clarifyState);
    expect(hasPending || hasClarify, item.message).toBe(true);
  };

  it("keeps at least 100 semantic cases in the baseline set", () => {
    expect(allCases.length).toBeGreaterThanOrEqual(100);
  });

  for (const group of assistantSemanticModules) {
    it(`keeps semantic intent routing stable for module: ${group.module}`, () => {
      for (const item of group.cases) {
        assertCase(item);
      }
    });
  }
});
