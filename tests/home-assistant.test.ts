import { describe, expect, it } from "vitest";

import { resolveLocalAssistantPlanForTest } from "@/lib/home-assistant";

function createTask(overrides: Partial<{
  id: string;
  title: string;
  status: "ready" | "waiting" | "needs_review" | "in_progress" | "done";
  deadline: Date | null;
  estimatedMinutes: number | null;
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
    estimatedMinutes: overrides.estimatedMinutes ?? 45,
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
    expect(result?.reply).toContain("先做");
    expect(result?.reply).toContain(currentBestTask.title);
    expect(result?.reply).not.toContain("原因是：");
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

  it("shows before and after values in high-risk update previews", () => {
    const task = createTask({
      id: "task-update-preview",
      title: "复习卫生学",
      deadline: new Date("2026-03-25T12:00:00.000Z"),
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "把复习卫生学安排到20:00",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.actions).toEqual([]);
    expect(result?.reply).toContain("startAtISO:");
    expect(result?.reply).toContain("->");
  });

  it("supports batch deadline updates with full-width colon time", () => {
    const first = createTask({ id: "task-a", title: "复习医学心理学", status: "in_progress", deadline: null });
    const second = createTask({ id: "task-b", title: "复习卫生学", status: "in_progress", deadline: null });
    const third = createTask({ id: "task-c", title: "复习核医学", status: "in_progress", deadline: null });
    const result = resolveLocalAssistantPlanForTest({
      message: "现在的三个任务全部改成今天23：59截止吧",
      tasks: [first, second, third],
      currentBestTask: first,
      topTasksForToday: [first, second, third],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction?.actions).toHaveLength(3);
    expect(result?.reply).toContain("23:59");
    expect(result?.reply).not.toContain("20:20");
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

  it("answers course-schedule questions with course and free-window context", () => {
    const task = createTask();
    const result = resolveLocalAssistantPlanForTest({
      message: "今天课表和空档是什么？",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
      courseContext: {
        todayCourseSummary: "08:00-09:40 核医学@A101；14:00-15:40 内科学@B201",
        todayFreeWindowSummary: "09:40-14:00，15:40-21:30",
      },
    });

    expect(result?.actions).toEqual([]);
    expect(result?.reply).toContain("今天课程");
    expect(result?.reply).toContain("可执行空档");
    expect(result?.reply).toContain("核医学");
  });

  it("returns current system time for time queries", () => {
    const task = createTask();
    const result = resolveLocalAssistantPlanForTest({
      message: "现在几点了？",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.actions).toEqual([]);
    expect(result?.reply).toContain("当前时间是");
    expect(result?.reply).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it("returns current system time for polite read-time questions", () => {
    const task = createTask();
    const result = resolveLocalAssistantPlanForTest({
      message: "您能读取现在的时间吗",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.actions).toEqual([]);
    expect(result?.reply).toContain("当前时间是");
    expect(result?.reply).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it("maps schedule-arrangement commands to update_task_core action", () => {
    const task = createTask({
      id: "task-arrange",
      title: "复习当天核医学课程",
      deadline: new Date("2026-03-25T10:00:00.000Z"),
      estimatedMinutes: 60,
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "把复习当天核医学课程安排到今天20:00",
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
          type: "update_task_core",
          taskId: "task-arrange",
          patch: {
            startAtISO: expect.any(String),
          },
        },
      ],
    });
    expect(result?.reply).toContain("开始时间晚于截止时间");
  });

  it("asks a follow-up when arrangement lacks task or time, then keeps clarify context", () => {
    const task = createTask({
      id: "task-arrange-followup",
      title: "复习当天核医学课程",
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "帮我安排一下",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.actions).toEqual([]);
    expect(result?.reply).toContain("请先补充");
    expect(result?.clarifyState).toMatchObject({
      type: "arrange_task_time",
      taskId: "task-arrange-followup",
      hour: null,
      minute: null,
    });
  });

  it("auto-selects current best task for arrangement when task title is omitted", () => {
    const task = createTask({
      id: "task-auto-arrange",
      title: "复习当天核医学课程",
      deadline: new Date("2026-03-25T10:00:00.000Z"),
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "安排到20:00",
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
          type: "update_task_core",
          taskId: "task-auto-arrange",
          patch: {
            startAtISO: expect.any(String),
          },
        },
      ],
    });
    expect(result?.reply).toContain("开始时间晚于截止时间");
    expect(result?.clarifyState).toBeNull();
  });

  it("builds chained actions in one turn for arrange-plus-status commands", () => {
    const task = createTask({
      id: "task-chain",
      title: "复习当天核医学课程",
      deadline: new Date("2026-03-25T10:00:00.000Z"),
      estimatedMinutes: 30,
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "把复习当天核医学课程安排到20:00并标记为进行中",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction?.actions).toHaveLength(2);
    expect(result?.pendingAction?.actions[0]).toMatchObject({
      type: "update_task_core",
      taskId: "task-chain",
      patch: {
        startAtISO: expect.any(String),
      },
    });
    expect(result?.pendingAction?.actions[1]).toMatchObject({
      type: "update_status",
      taskId: "task-chain",
      status: "in_progress",
    });
  });

  it("completes arrangement after follow-up clarification", () => {
    const task = createTask({
      id: "task-clarify-complete",
      title: "复习当天核医学课程",
      deadline: new Date("2026-03-25T10:00:00.000Z"),
    });
    const result = resolveLocalAssistantPlanForTest({
      message: "复习当天核医学课程",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
      context: {
        clarifyState: {
          type: "arrange_task_time",
          taskId: null,
          hour: 19,
          minute: 0,
        },
      },
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction).toMatchObject({
      type: "confirm_actions",
      actions: [
        {
          type: "update_task_core",
          taskId: "task-clarify-complete",
          patch: {
            startAtISO: expect.any(String),
          },
        },
      ],
    });
    expect(result?.reply).toContain("开始时间晚于截止时间");
    expect(result?.clarifyState).toBeNull();
  });

  it("asks for deadline time when creating a task with relative day but no explicit clock", () => {
    const task = createTask();
    const result = resolveLocalAssistantPlanForTest({
      message: "新增任务：复习今日心理学课程",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction).toBeNull();
    expect(result?.reply).toContain("没写具体截止时刻");
    expect(result?.clarifyState).toMatchObject({
      type: "create_task_deadline_time",
      sourceText: "复习今日心理学课程",
      dayHint: "today",
    });
  });

  it("creates task after deadline-time clarification for create flow", () => {
    const task = createTask();
    const result = resolveLocalAssistantPlanForTest({
      message: "20:00",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
      context: {
        clarifyState: {
          type: "create_task_deadline_time",
          sourceText: "复习今日心理学课程",
          dayHint: "today",
          turns: 1,
        },
      },
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction).toMatchObject({
      type: "confirm_actions",
      actions: [
        {
          type: "create_task",
          sourceText: "复习今日心理学课程（截止今天20:00）",
        },
      ],
    });
    expect(result?.clarifyState).toBeNull();
  });

  it("creates multiple weekly course-review tasks from today's courses by one command", () => {
    const task = createTask();
    const result = resolveLocalAssistantPlanForTest({
      message: "帮我添加3个任务，复习今日三个课程，每周三执行",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
      courseContext: {
        todayCourseSummary: "08:00-09:30 核医学@1阶；09:40-11:10 医学心理学@1阶；14:30-16:50 卫生学@1阶",
        todayFreeWindowSummary: "11:10-14:30，16:50-21:30",
      },
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction).toBeNull();
    expect(result?.reply).toContain("先补一个执行时刻");
    expect(result?.clarifyState).toMatchObject({
      type: "create_task_batch_execution_time",
      courseTitles: ["核医学", "医学心理学", "卫生学"],
    });
  });

  it("creates weekly course-review tasks after batch-time clarification", () => {
    const task = createTask();
    const result = resolveLocalAssistantPlanForTest({
      message: "20:00",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
      context: {
        clarifyState: {
          type: "create_task_batch_execution_time",
          courseTitles: ["核医学", "医学心理学", "卫生学"],
          turns: 1,
        },
      },
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction).toMatchObject({
      type: "confirm_actions",
      actions: [
        {
          type: "create_task",
          sourceText: "每周三20:00复习核医学；每周三20:00复习医学心理学；每周三20:00复习卫生学",
        },
      ],
    });
  });

  it("answers recommendation question during batch-time clarification without creating pending action", () => {
    const task = createTask();
    const result = resolveLocalAssistantPlanForTest({
      message: "我习惯晚上复习，你推荐什么时候",
      tasks: [task],
      currentBestTask: task,
      topTasksForToday: [task],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
      context: {
        clarifyState: {
          type: "create_task_batch_execution_time",
          courseTitles: ["核医学", "医学心理学", "卫生学"],
          turns: 1,
        },
      },
    });

    expect(result?.actions).toEqual([]);
    expect(result?.pendingAction).toBeNull();
    expect(result?.reply).toContain("建议设在每周三");
    expect(result?.clarifyState).toMatchObject({
      type: "create_task_batch_execution_time",
      turns: 2,
    });
  });
});
