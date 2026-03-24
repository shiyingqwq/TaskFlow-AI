import { describe, expect, it } from "vitest";

import { resolveLocalAssistantPlanForTest } from "@/lib/home-assistant";

function createTask(overrides: Partial<{
  id: string;
  title: string;
  status: "ready" | "waiting" | "needs_review" | "in_progress" | "done";
  deadline: Date | null;
  submitTo: string | null;
  submitChannel: string | null;
  needsHumanReview: boolean;
  waitingReasonType: string | null;
  waitingReasonText: string | null;
  waitingFor: string | null;
  nextCheckAt: Date | null;
  nextActionSuggestion: string;
  priorityReason: string;
  priorityScore: number;
}> = {}) {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "团支书填写入党积极分子名单表",
    status: overrides.status ?? "ready",
    deadline: overrides.deadline ?? new Date("2026-03-20T10:00:00.000Z"),
    submitTo: overrides.submitTo ?? "组织部",
    submitChannel: overrides.submitChannel ?? "邮箱",
    needsHumanReview: overrides.needsHumanReview ?? false,
    waitingReasonType: overrides.waitingReasonType ?? null,
    waitingReasonText: overrides.waitingReasonText ?? null,
    waitingFor: overrides.waitingFor ?? null,
    nextCheckAt: overrides.nextCheckAt ?? null,
    nextActionSuggestion: overrides.nextActionSuggestion ?? "先核对要求，再推进最小可执行的一步。",
    priorityReason: overrides.priorityReason ?? "三天内截止，适合提前处理；当前可直接推进。",
    priorityScore: overrides.priorityScore ?? 88,
  };
}

describe("home assistant local planner", () => {
  it("summarizes the current best task for urgency questions", () => {
    const currentBestTask = createTask();
    const result = resolveLocalAssistantPlanForTest({
      message: "现在最该做什么？",
      tasks: [currentBestTask],
      currentBestTask,
      topTasksForToday: [currentBestTask],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.actions).toEqual([]);
    expect(result?.reply).toContain("现在最该做的是");
    expect(result?.reply).toContain(currentBestTask.title);
  });

  it("maps direct status commands to a safe status update action", () => {
    const task = createTask({
      id: "task-urgent",
      title: "未公示邮件的同学私聊郑学梅老师",
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "把未公示邮件的同学私聊郑学梅老师标记为进行中",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.reply).toContain("高风险改动预览");
    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction).toMatchObject({
      type: "confirm_actions",
      actions: [
        {
          type: "update_status",
          taskId: "task-urgent",
          status: "in_progress",
        },
      ],
    });
  });

  it("asks for clarification when multiple tasks match equally", () => {
    const first = createTask({
      id: "task-a",
      title: "提交名单给老师",
    });
    const second = createTask({
      id: "task-b",
      title: "提交名单给部门",
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "把提交名单标记为进行中",
      tasks: [first, second],
      currentBestTask: first,
      topTasksForToday: [first],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.actions).toEqual([]);
    expect(result?.reply).toContain("不止一条");
  });

  it("reuses the last referenced task for follow-up status updates", () => {
    const task = createTask({
      id: "task-followup",
      title: "填写本期入党积极分子名单表",
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "我已经完成了",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
      context: {
        lastReferencedTaskId: "task-followup",
      },
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction).toMatchObject({
      type: "confirm_actions",
      actions: [
        {
          type: "update_status",
          taskId: "task-followup",
          status: "done",
        },
      ],
    });
    expect(result?.referencedTaskIds).toEqual(["task-followup"]);
  });

  it("executes a pending action after explicit confirmation", () => {
    const task = createTask({
      id: "task-confirm",
      title: "填写本期入党积极分子名单表",
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "确认",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
      context: {
        pendingAction: {
          type: "confirm_actions",
          actions: [
            {
              type: "update_status",
              taskId: "task-confirm",
              status: "done",
            },
          ],
          previewText: "确认后执行",
          impacts: [],
        },
      },
    });

    expect(result?.actions).toEqual([
      {
        type: "update_status",
        taskId: "task-confirm",
        status: "done",
      },
    ]);
    expect(result?.pendingAction).toBeNull();
  });

  it("cancels a pending action without modifying tasks", () => {
    const task = createTask({
      id: "task-cancel",
      title: "填写本期入党积极分子名单表",
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "取消",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
      context: {
        pendingAction: {
          type: "confirm_actions",
          actions: [
            {
              type: "update_status",
              taskId: "task-cancel",
              status: "done",
            },
          ],
          previewText: "确认后执行",
          impacts: [],
        },
      },
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction).toBeNull();
    expect(result?.reply).toContain("已取消");
  });

  it("maps explicit create-task requests to a create_task action", () => {
    const task = createTask();
    const result = resolveLocalAssistantPlanForTest({
      message: "新增任务：明天下午三点去打印材料",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction).toMatchObject({
      type: "confirm_actions",
      actions: [
        {
          type: "create_task",
          sourceText: "明天下午三点去打印材料",
        },
      ],
    });
    expect(result?.reply).toContain("高风险改动预览");
  });

  it("does not present completed tasks as active work in the task overview", () => {
    const first = createTask({
      id: "done-1",
      title: "填写本期入党积极分子名单表",
      status: "done",
    });
    const second = createTask({
      id: "done-2",
      title: "加入本期入党积极分子群",
      status: "done",
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "现在我有哪些任务",
      tasks: [first, second],
      currentBestTask: null,
      topTasksForToday: [],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.reply).toContain("当前没有活跃任务");
    expect(result?.reply).toContain("都已经处理完成");
  });
});
