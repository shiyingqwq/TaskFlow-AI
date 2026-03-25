import OpenAI from "openai";
import { z } from "zod";

import type { TaskStatus } from "@/generated/prisma/enums";
import { statusLabels } from "@/lib/constants";
import { getCoursesForDay, normalizeCourseSchedule, type CourseScheduleItem } from "@/lib/course-schedule";
import { getAiRuntimeConfig, getAppSettings } from "@/lib/server/app-settings";
import {
  createAssistantTask,
  deleteTask,
  deleteSource,
  fixAllTaskTimeSemanticConflicts,
  getDashboardData,
  recordTaskProgress,
  restoreTaskAssistantSnapshot,
  restoreTaskProgressLogs,
  resetTaskProgressCycle,
  resolveTaskReview,
  scheduleTaskFollowUp,
  undoTaskProgress,
  updateTaskCore,
  updateTaskStatus,
} from "@/lib/server/tasks";
import { formatDeadline, nowInTaipei, toTaipei } from "@/lib/time";
import { describeWaitingReason, type WaitingFollowUpPreset } from "@/lib/waiting";
import { normalizeMaterials } from "@/lib/materials";
import { detectAssistantSkill, getSkillInstruction, getSkillToolCatalog, type AssistantSkill } from "@/lib/home-assistant-skills";

export type AssistantHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantConversationContext = {
  lastReferencedTaskId?: string | null;
  pendingAction?: AssistantPendingAction | null;
  undoAction?: AssistantUndoAction | null;
  clarifyState?: AssistantClarifyState | null;
};

export type AssistantClarifyState = {
  type: "arrange_task_time";
  taskId?: string | null;
  hour?: number | null;
  minute?: number | null;
  turns?: number;
} | {
  type: "create_task_deadline_time";
  sourceText: string;
  dayHint: "today" | "tomorrow";
  turns?: number;
} | {
  type: "create_task_batch_execution_time";
  courseTitles: string[];
  turns?: number;
};

type AssistantStrategyPolicy = {
  autoSelectCurrentBestTaskOnArrange: boolean;
  autoSelectCurrentBestTaskOnStatus: boolean;
  maxClarifyTurns: number;
};

const AI_AUTONOMOUS_MAX_STEPS = 3;

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
type DashboardTask = Awaited<ReturnType<typeof getDashboardData>>["tasks"][number];

const statusActionSchema = z.object({
  type: z.literal("update_status"),
  taskId: z.string().min(1),
  status: z.enum(["needs_review", "ready", "waiting", "in_progress", "pending_submit", "submitted", "done", "overdue", "ignored"]),
  note: z.string().optional(),
});

const reviewActionSchema = z.object({
  type: z.literal("resolve_review"),
  taskId: z.string().min(1),
  note: z.string().optional(),
});

const followUpActionSchema = z.object({
  type: z.literal("schedule_follow_up"),
  taskId: z.string().min(1),
  preset: z.enum(["tonight", "tomorrow", "next_week"]),
  note: z.string().optional(),
});

const progressActionSchema = z.object({
  type: z.literal("record_progress"),
  taskId: z.string().min(1),
  mode: z.enum(["increment", "decrement", "reset"]),
});

const createTaskActionSchema = z.object({
  type: z.literal("create_task"),
  sourceText: z.string().min(1),
});

const deleteTaskActionSchema = z.object({
  type: z.literal("delete_task"),
  taskId: z.string().min(1),
});

const autoFixTimeActionSchema = z.object({
  type: z.literal("auto_fix_time_semantics"),
});

const updateTaskCoreActionSchema = z.object({
  type: z.literal("update_task_core"),
  taskId: z.string().min(1),
  patch: z
    .object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      startAtISO: z.string().datetime().nullable().optional(),
      submitTo: z.string().nullable().optional(),
      submitChannel: z.string().nullable().optional(),
      applicableIdentities: z.array(z.string()).optional(),
      identityHint: z.string().nullable().optional(),
      recurrenceType: z.enum(["single", "daily", "weekly", "limited"]).optional(),
      recurrenceDays: z.array(z.number().int().min(0).max(6)).optional(),
      recurrenceTargetCount: z.number().int().min(1).optional(),
      recurrenceLimit: z.number().int().min(1).nullable().optional(),
      recurrenceStartISO: z.string().datetime().nullable().optional(),
      recurrenceUntilISO: z.string().datetime().nullable().optional(),
      recurrenceMaxOccurrences: z.number().int().min(1).nullable().optional(),
      deadlineText: z.string().nullable().optional(),
      deadlineISO: z.string().datetime().nullable().optional(),
      timezone: z.string().min(1).max(64).optional(),
      snoozeUntilISO: z.string().datetime().nullable().optional(),
      deliveryType: z.enum(["electronic", "paper", "both", "unknown"]).optional(),
      requiresSignature: z.boolean().optional(),
      requiresStamp: z.boolean().optional(),
      dependsOnExternal: z.boolean().optional(),
      waitingReasonType: z.string().nullable().optional(),
      waitingReasonText: z.string().nullable().optional(),
      nextCheckAtISO: z.string().datetime().nullable().optional(),
      nextActionSuggestion: z.string().min(1).optional(),
      estimatedMinutes: z.number().int().min(10).max(480).nullable().optional(),
      status: z.enum(["needs_review", "ready", "waiting", "in_progress", "pending_submit", "submitted", "done", "overdue", "ignored"]).optional(),
      materials: z.array(z.string()).optional(),
      taskType: z.enum(["submission", "collection", "communication", "offline", "production", "followup"]).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, { message: "patch cannot be empty" }),
});

const assistantResponseSchema = z.object({
  reply: z.string().min(1),
  actions: z.array(z.union([statusActionSchema, reviewActionSchema, followUpActionSchema, progressActionSchema, createTaskActionSchema, deleteTaskActionSchema, autoFixTimeActionSchema, updateTaskCoreActionSchema])).default([]),
});

type AssistantPlannedAction = z.infer<typeof assistantResponseSchema>["actions"][number];
export type AssistantImpactItem = {
  taskId: string;
  taskTitle: string;
  changedFields: string[];
};

type AssistantPendingActionBundle = {
  type: "confirm_actions";
  actions: AssistantPlannedAction[];
  previewText: string;
  impacts: AssistantImpactItem[];
};

export type AssistantPendingAction = AssistantPendingActionBundle;

type AssistantUndoOperation =
  | {
      type: "restore_task_snapshot";
      snapshot: {
        taskId: string;
        taskTitle: string;
        status: TaskStatus;
        needsHumanReview: boolean;
        reviewResolved: boolean;
        reviewReasons: string[];
        waitingFor: string | null;
        waitingReasonType: string | null;
        waitingReasonText: string | null;
        nextCheckAt: string | null;
      };
    }
  | {
      type: "restore_progress_logs";
      taskId: string;
      taskTitle: string;
      completedAts: string[];
    }
  | {
      type: "delete_source";
      sourceId: string;
      sourceLabel: string;
    };

export type AssistantUndoAction = {
  type: "undo_actions";
  actions: AssistantUndoOperation[];
  summary?: string;
};

type AssistantResult = {
  reply: string;
  actionResults: Array<{
    taskId: string;
    taskTitle: string;
    summary: string;
    impact?: AssistantImpactItem;
    createdTaskCards?: Array<{
      taskId: string;
      title: string;
      deadlineLabel: string;
      statusLabel: string;
      needsHumanReview: boolean;
    }>;
  }>;
  mode: "local" | "ai";
  changedTaskIds: string[];
  referencedTaskIds: string[];
  pendingAction?: AssistantPendingAction | null;
  undoAction?: AssistantUndoAction | null;
  clarifyState?: AssistantClarifyState | null;
  trace?: Array<{
    step: number;
    planner: "local" | "ai";
    actions: string[];
    results: string[];
    stopReason?: "requires_confirmation" | "no_actions" | "duplicate_actions" | "max_steps_reached" | "local_plan_completed" | "no_followup_plan";
  }>;
};

function shouldPreferLocalPlan(plan: {
  actions: AssistantPlannedAction[];
  pendingAction?: AssistantPendingAction | null;
  clarifyState?: AssistantClarifyState | null;
  confirmedFromPending?: boolean;
} | null) {
  if (!plan) {
    return false;
  }
  if (plan.confirmedFromPending) {
    return true;
  }
  if (plan.pendingAction) {
    return true;
  }
  if (plan.clarifyState) {
    return true;
  }
  return plan.actions.length > 0;
}

async function getClient() {
  const config = await getAiRuntimeConfig();
  if (!config) {
    return { client: null, config: null };
  }
  return {
    client: new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    }),
    config,
  };
}

function normalizeFreeText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[“”"'`·,，。！？!?:：;；()（）【】\[\]<>《》、\-_/]/g, "");
}

function buildTaskContext(tasks: DashboardTask[]) {
  return tasks
    .map((task, index) => {
      const waitingReason = describeWaitingReason(task);

      return [
        `${index + 1}. id=${task.id}`,
        `标题=${task.title}`,
        `状态=${statusLabels[task.status]}`,
        `截止=${formatDeadline(task.deadline)}`,
        `提交对象=${task.submitTo || "未明确"}`,
        `提交方式=${task.submitChannel || "未明确"}`,
        `待确认=${task.needsHumanReview ? "是" : "否"}`,
        `等待原因=${waitingReason || "无"}`,
        `下一步=${task.nextActionSuggestion}`,
      ].join(" | ");
    })
    .join("\n");
}

type CourseAssistantContext = {
  todayCourses: CourseScheduleItem[];
  todayCourseSummary: string;
  todayFreeWindowSummary: string;
  todayArrangementSummary?: string;
};

function toMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function formatMinuteLabel(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function buildTodayFreeWindowSummary(todayCourses: CourseScheduleItem[]) {
  const dayStart = toMinutes("09:00");
  const dayEnd = toMinutes("21:30");
  const blocked = todayCourses
    .map((course) => ({ start: toMinutes(course.startTime), end: toMinutes(course.endTime) }))
    .sort((left, right) => left.start - right.start);
  const windows: Array<{ start: number; end: number }> = [];
  let cursor = dayStart;

  for (const range of blocked) {
    const start = Math.max(dayStart, range.start);
    const end = Math.min(dayEnd, range.end);
    if (end <= start) {
      continue;
    }
    if (start > cursor) {
      windows.push({ start: cursor, end: start });
    }
    cursor = Math.max(cursor, end);
  }

  if (cursor < dayEnd) {
    windows.push({ start: cursor, end: dayEnd });
  }

  if (windows.length === 0) {
    return "09:00-21:30 基本被课程占满";
  }

  return windows
    .slice(0, 4)
    .map((window) => `${formatMinuteLabel(window.start)}-${formatMinuteLabel(window.end)}`)
    .join("，");
}

function buildCourseAssistantContext(rawCourseSchedule: unknown): CourseAssistantContext {
  const todayCourses = getCoursesForDay(normalizeCourseSchedule(rawCourseSchedule));
  const todayCourseSummary =
    todayCourses.length === 0
      ? "今天没有课程。"
      : todayCourses
          .map((course) => `${course.startTime}-${course.endTime} ${course.title}${course.location ? `@${course.location}` : ""}`)
          .join("；");

  return {
    todayCourses,
    todayCourseSummary,
    todayFreeWindowSummary: buildTodayFreeWindowSummary(todayCourses),
    todayArrangementSummary: "",
  };
}

function buildTodayArrangementSummary(input: {
  courseContext: CourseAssistantContext;
  mustDoTasks: DashboardTask[];
  shouldDoTasks: DashboardTask[];
  reminderTasks: DashboardTask[];
  canWaitTasks: DashboardTask[];
}) {
  const windows = input.courseContext.todayFreeWindowSummary;
  const topMust = input.mustDoTasks.slice(0, 2).map((task) => task.title);
  const topReminder = input.reminderTasks.slice(0, 2).map((task) => task.title);
  const fallback = input.shouldDoTasks.slice(0, 2).map((task) => task.title);
  const canWait = input.canWaitTasks.slice(0, 2).map((task) => task.title);

  return [
    `可执行空档：${windows}`,
    `建议优先：${topMust.length > 0 ? topMust.join("、") : "暂无必须任务"}`,
    `提醒回看：${topReminder.length > 0 ? topReminder.join("、") : "暂无到点回看"}`,
    `可顺手推进：${fallback.length > 0 ? fallback.join("、") : "暂无"}`,
    `可后置：${canWait.length > 0 ? canWait.join("、") : "暂无"}`,
  ].join("；");
}

function extractCourseTitlesFromSummary(summary: string) {
  if (!summary || summary.includes("今天没有课程")) {
    return [] as string[];
  }
  return summary
    .split(/[；;]+/)
    .map((item) => item.trim())
    .map((item) => {
      const match = item.match(/\d{2}:\d{2}-\d{2}:\d{2}\s+([^@]+)/);
      return match?.[1]?.trim() ?? "";
    })
    .filter(Boolean);
}

function parseTaskCountHint(message: string) {
  const arabic = message.match(/(\d+)\s*(?:个|项|条|门)?(?:任务|课程)/);
  if (arabic) {
    return Math.max(1, Number(arabic[1]));
  }
  if (/(三|3)\s*(?:个|项|条|门)?(?:任务|课程)/.test(message)) {
    return 3;
  }
  if (/(两|二|2)\s*(?:个|项|条|门)?(?:任务|课程)/.test(message)) {
    return 2;
  }
  if (/(一|1)\s*(?:个|项|条|门)?(?:任务|课程)/.test(message)) {
    return 1;
  }
  return null;
}

function formatClock(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseClockTimeFromText(text: string) {
  const direct = text.match(/(?:安排到|放到|改到|调到|从)\s*(?:今天|今日|今晚|今夜|明天|明日)?\s*(\d{1,2})(?::|点)(\d{0,2})/);
  if (!direct) {
    if (/(安排到|放到|改到|调到).*(今晚|今夜|晚上)/.test(text)) {
      return { hour: 19, minute: 0 };
    }
    if (/(安排到|放到|改到|调到).*(下午)/.test(text)) {
      return { hour: 15, minute: 0 };
    }
    if (/(安排到|放到|改到|调到).*(早上|上午)/.test(text)) {
      return { hour: 9, minute: 0 };
    }
    return null;
  }
  const hour = Number(direct[1]);
  const minute = direct[2] ? Number(direct[2]) : 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

function parseAnyClockTime(text: string) {
  const direct = text.match(/(\d{1,2})(?::|点)(\d{0,2})/);
  if (direct) {
    const hour = Number(direct[1]);
    const minute = direct[2] ? Number(direct[2]) : 0;
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }
  if (/今晚|今夜|晚上/.test(text)) {
    return { hour: 19, minute: 0 };
  }
  if (/明早|明天早上|明天上午|明日上午/.test(text)) {
    return { hour: 9, minute: 0 };
  }
  if (/明晚|明天晚上/.test(text)) {
    return { hour: 20, minute: 0 };
  }
  if (/下午/.test(text)) {
    return { hour: 15, minute: 0 };
  }
  if (/上午|早上/.test(text)) {
    return { hour: 9, minute: 0 };
  }
  const chineseHour = text.match(/([一二三四五六七八九十两]{1,3})点(半)?/);
  if (chineseHour) {
    const map: Record<string, number> = {
      一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2,
      十: 10, 十一: 11, 十二: 12,
    };
    const raw = chineseHour[1];
    const hour = map[raw] ?? null;
    if (hour !== null) {
      return { hour, minute: chineseHour[2] ? 30 : 0 };
    }
  }
  return null;
}

function hasExplicitClock(text: string) {
  return /(\d{1,2}:\d{1,2})|(\d{1,2}点(?:半|[0-5]?\d分?)?)|(\d{1,2}时(?:[0-5]?\d分?)?)|([一二三四五六七八九十两]{1,3}点(?:半)?)/.test(text);
}

function isArrangementIntent(text: string) {
  return /(今日日程|今天安排|安排|排到|时段|放到|改到|调到)/.test(text);
}

function resolveAssistantStrategyPolicy(rawCourseTableConfig: unknown): AssistantStrategyPolicy {
  const fromConfig = (rawCourseTableConfig && typeof rawCourseTableConfig === "object" ? (rawCourseTableConfig as Record<string, unknown>).assistantPolicy : null) as Record<string, unknown> | null;
  const maxClarifyTurns = Number(fromConfig?.maxClarifyTurns);

  return {
    autoSelectCurrentBestTaskOnArrange: fromConfig?.autoSelectCurrentBestTaskOnArrange !== false,
    autoSelectCurrentBestTaskOnStatus: fromConfig?.autoSelectCurrentBestTaskOnStatus !== false,
    maxClarifyTurns: Number.isInteger(maxClarifyTurns) && maxClarifyTurns >= 1 && maxClarifyTurns <= 3 ? maxClarifyTurns : 1,
  };
}

function normalizeAssistantStartAtIso(value: string | null) {
  if (value === null) {
    return null;
  }

  const parsed = toTaipei(value);
  if (!parsed) {
    return null;
  }

  const now = nowInTaipei();
  let fixed = parsed;

  // 模型偶发会给出过去年份（例如去年同月同日），这里自动拉回当前年度。
  if (fixed.year() < now.year()) {
    fixed = fixed.year(now.year());
    if (fixed.isBefore(now.subtract(6, "hour"))) {
      fixed = fixed.add(1, "day");
    }
  }

  return fixed.toDate();
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function findMatchingTasks(tasks: DashboardTask[], message: string) {
  const normalizedMessage = normalizeFreeText(message);

  return tasks
    .map((task) => {
      const normalizedTitle = normalizeFreeText(task.title);
      if (!normalizedTitle) {
        return null;
      }

      const fullMatch =
        normalizedMessage.includes(task.id.toLowerCase()) ||
        normalizedMessage.includes(normalizedTitle) ||
        normalizedTitle.includes(normalizedMessage);

      if (fullMatch) {
        return { task, score: normalizedTitle.length + 1000 };
      }

      let overlap = 0;
      for (let index = 0; index < normalizedTitle.length - 1; index += 1) {
        const chunk = normalizedTitle.slice(index, index + 2);
        if (chunk.length === 2 && normalizedMessage.includes(chunk)) {
          overlap += 1;
        }
      }

      if (overlap === 0) {
        return null;
      }

      return { task, score: overlap };
    })
    .filter((item): item is { task: DashboardTask; score: number } => Boolean(item))
    .sort((left, right) => right.score - left.score);
}

function pickTaskFromMessage(
  tasks: DashboardTask[],
  message: string,
  currentBestTask: DashboardTask | null,
  reviewTasks: DashboardTask[],
  waitingTasks: DashboardTask[],
  lastReferencedTaskId?: string | null,
) {
  if (/最紧急|现在最该做|当前最该做|第一优先/.test(message) && currentBestTask) {
    return { task: currentBestTask, ambiguous: false };
  }

  if (/第一条待确认|最上面那条待确认/.test(message) && reviewTasks[0]) {
    return { task: reviewTasks[0], ambiguous: false };
  }

  if (/第一条等待|最上面那条等待/.test(message) && waitingTasks[0]) {
    return { task: waitingTasks[0], ambiguous: false };
  }

  const matches = findMatchingTasks(tasks, message);
  if (matches.length > 1 && matches[0].score === matches[1].score) {
    return { task: null, ambiguous: true };
  }

  if (matches.length === 0 && lastReferencedTaskId && /^(我已经|已经|那就|就这条|这条|它|这个|那条|帮我|改成|标记为|设为|先|继续)/.test(message)) {
    const referencedTask = tasks.find((task) => task.id === lastReferencedTaskId) ?? null;
    if (referencedTask) {
      return { task: referencedTask, ambiguous: false };
    }
  }

  if (matches.length === 0) {
    return { task: null, ambiguous: false };
  }

  return { task: matches[0].task, ambiguous: false };
}

const statusKeywordMap: Array<{ pattern: RegExp; status: TaskStatus; note?: string }> = [
  { pattern: /不是任务|忽略/, status: "ignored", note: "通过首页 AI 助手标记为非任务" },
  { pattern: /已完成|完成了|做完了/, status: "done" },
  { pattern: /已提交|提交好了/, status: "done" },
  { pattern: /待提交/, status: "pending_submit" },
  { pattern: /等待中|先等待|卡住了/, status: "waiting" },
  { pattern: /进行中|开始做|在做了/, status: "in_progress" },
  { pattern: /恢复可执行|可执行|重新开始/, status: "ready" },
];

function buildLocalSummary(
  message: string,
  currentBestTask: DashboardTask | null,
  topTasksForToday: DashboardTask[],
  reviewTasks: DashboardTask[],
  waitingTasks: DashboardTask[],
  dueWaitingTasks: DashboardTask[],
  tasks: DashboardTask[],
  courseContext?: CourseAssistantContext,
) {
  const looksLikeMutation =
    /(?:新增|添加|创建|加|记).*(任务|待办)/.test(message) ||
    /(安排到|排到|标记为|改成|设为|更新|修改|调到|放到|删除|删掉|移除)/.test(message);

  if (/现在最该做|最紧急|先做什么|该做什么|今天必须推进/.test(message)) {
    if (!currentBestTask) {
      return "当前没有明确需要立刻推进的任务。";
    }

    return `现在最该做的是「${currentBestTask.title}」。截止 ${formatDeadline(currentBestTask.deadline)}，原因是：${currentBestTask.priorityReason}。下一步建议：${currentBestTask.nextActionSuggestion}`;
  }

  if (!looksLikeMutation && /待确认|确认队列|需要确认/.test(message)) {
    if (reviewTasks.length === 0) {
      return "当前没有待确认任务。";
    }

    return `当前有 ${reviewTasks.length} 条待确认任务，最值得先看的有：${reviewTasks
      .slice(0, 3)
      .map((task) => `「${task.title}」`)
      .join("、")}。`;
  }

  if (!looksLikeMutation && /回看|等待任务|等待中/.test(message)) {
    const focus = dueWaitingTasks.length > 0 ? dueWaitingTasks : waitingTasks;
    if (focus.length === 0) {
      return "当前没有需要回看的等待任务。";
    }

    return `当前有 ${waitingTasks.length} 条等待任务，其中优先回看的有：${focus
      .slice(0, 3)
      .map((task) => `「${task.title}」`)
      .join("、")}。`;
  }

  if (/全部任务|有哪些任务|总结一下任务|任务总览/.test(message)) {
    const activeTasks = tasks.filter((task) => !["done", "submitted", "ignored"].includes(task.status));
    const completedCount = tasks.filter((task) => ["done", "submitted"].includes(task.status)).length;
    const top = activeTasks.slice(0, 5).map((task) => `「${task.title}」(${statusLabels[task.status]})`);
    const urgentCount = topTasksForToday.length;
    if (activeTasks.length === 0) {
      return completedCount > 0 ? `当前没有活跃任务了，现有 ${completedCount} 条任务都已经处理完成。` : "当前没有活跃任务。";
    }

    return `当前共有 ${activeTasks.length} 条活跃任务，其中 ${reviewTasks.length} 条待确认、${waitingTasks.length} 条等待中、${urgentCount} 条今天建议优先推进。当前排在前面的有：${top.join("、")}。`;
  }

  if (/现在我有哪些任务|我有哪些任务/.test(message)) {
    const activeTasks = tasks.filter((task) => !["done", "submitted", "ignored"].includes(task.status));
    const completedCount = tasks.filter((task) => ["done", "submitted"].includes(task.status)).length;

    if (activeTasks.length === 0) {
      return completedCount > 0 ? `当前没有活跃任务了，现有 ${completedCount} 条任务都已经处理完成。` : "当前没有活跃任务。";
    }

    return `当前还有 ${activeTasks.length} 条活跃任务：${activeTasks
      .slice(0, 5)
      .map((task) => `「${task.title}」(${statusLabels[task.status]})`)
      .join("、")}。`;
  }

  if (!looksLikeMutation && /(今天|今日).*(课表|课程)|课表.*(今天|今日)|今天有什么课/.test(message)) {
    if (!courseContext) {
      return "当前没有读到课表配置。你可以先在设置里录入课程表。";
    }

    return `今天课程：${courseContext.todayCourseSummary} 可执行空档：${courseContext.todayFreeWindowSummary}。`;
  }

  if (!looksLikeMutation && /(空档|空闲|什么时候有空|有空时间)/.test(message)) {
    if (!courseContext) {
      return "当前没有读到课表配置，暂时无法按课程计算空档。";
    }
    return `按今日课表，主要空档是：${courseContext.todayFreeWindowSummary}。`;
  }

  if (!looksLikeMutation && /(今日日程安排|今天安排|读取安排数据|安排数据|排版数据|今天怎么排)/.test(message)) {
    if (!courseContext?.todayArrangementSummary) {
      return "当前还没有可读的今日日程安排数据。";
    }
    return `当前今日日程安排：${courseContext.todayArrangementSummary}。`;
  }

  return null;
}

function collectReferencedTaskIds(reply: string, actions: AssistantPlannedAction[], fallbackTask: DashboardTask | null) {
  if (actions.length > 0) {
    return [
      ...new Set(
        actions
          .map((action) => ("taskId" in action ? action.taskId : null))
          .filter((taskId): taskId is string => Boolean(taskId)),
      ),
    ];
  }

  if (fallbackTask && reply.includes(fallbackTask.title)) {
    return [fallbackTask.id];
  }

  return [];
}

function getPendingActionTaskIds(action: AssistantPendingAction | null | undefined) {
  if (!action) {
    return [] as string[];
  }

  return [
    ...new Set(
      action.actions
        .map((item) => ("taskId" in item ? item.taskId : null))
        .filter((taskId): taskId is string => Boolean(taskId)),
    ),
  ];
}

function isHighRiskAction(action: AssistantPlannedAction) {
  return action.type === "update_status" || action.type === "create_task" || action.type === "delete_task" || action.type === "update_task_core" || action.type === "auto_fix_time_semantics";
}

function buildActionImpact(action: AssistantPlannedAction, taskMap: Map<string, DashboardTask>): AssistantImpactItem {
  if (action.type === "create_task") {
    return {
      taskId: "new",
      taskTitle: "新建任务（从对话内容解析）",
      changedFields: ["source", "tasks", "status", "needsHumanReview"],
    };
  }

  if (action.type === "delete_task") {
    const task = taskMap.get(action.taskId);
    return {
      taskId: action.taskId,
      taskTitle: task?.title ?? action.taskId,
      changedFields: ["deleted"],
    };
  }

  if (action.type === "auto_fix_time_semantics") {
    return {
      taskId: "batch",
      taskTitle: "批量时间语义修复",
      changedFields: ["deadline", "deadlineText", "priorityScore"],
    };
  }

  const task = taskMap.get(action.taskId);
  const taskTitle = task?.title ?? action.taskId;

  if (action.type === "update_status") {
    return {
      taskId: action.taskId,
      taskTitle,
      changedFields: ["status", "needsHumanReview", "reviewResolved", "reviewReasons"],
    };
  }

  if (action.type === "resolve_review") {
    return {
      taskId: action.taskId,
      taskTitle,
      changedFields: ["needsHumanReview", "reviewResolved", "reviewReasons", "status"],
    };
  }

  if (action.type === "schedule_follow_up") {
    return {
      taskId: action.taskId,
      taskTitle,
      changedFields: ["status", "nextCheckAt"],
    };
  }

  if (action.type === "update_task_core") {
    return {
      taskId: action.taskId,
      taskTitle,
      changedFields: Object.keys(action.patch),
    };
  }

  return {
    taskId: action.taskId,
    taskTitle,
    changedFields: ["progressLogs"],
  };
}

function describeAction(action: AssistantPlannedAction, taskMap: Map<string, DashboardTask>) {
  if (action.type === "create_task") {
    return `新增任务：${action.sourceText}`;
  }

  if (action.type === "delete_task") {
    const task = taskMap.get(action.taskId);
    const title = task?.title ?? action.taskId;
    return `删除任务「${title}」`;
  }

  if (action.type === "auto_fix_time_semantics") {
    return "一键修复时间语义冲突（开始时间晚于截止）";
  }

  const task = taskMap.get(action.taskId);
  const title = task?.title ?? action.taskId;

  if (action.type === "update_status") {
    return `将「${title}」标记为${statusLabels[action.status]}`;
  }

  if (action.type === "resolve_review") {
    return `确认「${title}」解析结果`;
  }

  if (action.type === "schedule_follow_up") {
    const label = action.preset === "tonight" ? "今晚" : action.preset === "tomorrow" ? "明天" : "下周";
    return `将「${title}」设为${label}回看`;
  }

  if (action.type === "update_task_core") {
    const changed = Object.keys(action.patch);
    return `更新「${title}」字段：${changed.join("、")}`;
  }

  if (action.mode === "increment") {
    return `给「${title}」记录 1 次进度`;
  }

  if (action.mode === "decrement") {
    return `给「${title}」撤回 1 次进度`;
  }

  return `重置「${title}」本轮进度`;
}

function findExplicitlyMentionedTasks(tasks: DashboardTask[], message: string) {
  const normalizedMessage = normalizeFreeText(message);
  return tasks.filter((task) => {
    const normalizedTitle = normalizeFreeText(task.title);
    if (normalizedTitle.length < 2) {
      return false;
    }
    return normalizedMessage.includes(normalizedTitle);
  });
}

function reconcileTaskCoreSchedulePatch(
  action: Extract<AssistantPlannedAction, { type: "update_task_core" }>,
  taskMap: Map<string, DashboardTask>,
) {
  const task = taskMap.get(action.taskId);
  if (!task) {
    return { action, note: "" };
  }
  const resolvedStartAt =
    action.patch.startAtISO !== undefined
      ? (action.patch.startAtISO ? toTaipei(action.patch.startAtISO) : null)
      : toTaipei(task.startAt);
  const resolvedDeadline =
    action.patch.deadlineISO !== undefined
      ? (action.patch.deadlineISO ? toTaipei(action.patch.deadlineISO) : null)
      : toTaipei(task.deadline);

  if (!resolvedStartAt || !resolvedDeadline || !resolvedStartAt.isAfter(resolvedDeadline)) {
    return { action, note: "" };
  }

  const estimateMinutes = (() => {
    if (typeof action.patch.estimatedMinutes === "number") {
      return action.patch.estimatedMinutes;
    }
    if (typeof task.estimatedMinutes === "number" && task.estimatedMinutes >= 10 && task.estimatedMinutes <= 480) {
      return task.estimatedMinutes;
    }
    return 60;
  })();
  const adjustedDeadline = resolvedStartAt.add(Math.max(20, estimateMinutes), "minute");
  const deadlineSource = action.patch.deadlineISO !== undefined ? "本次设置的截止时间" : "原截止时间";

  return {
    action: {
      ...action,
      patch: {
        ...action.patch,
        deadlineISO: adjustedDeadline.toISOString(),
      },
    },
    note: `「${task.title}」开始时间晚于${deadlineSource}，已联动将截止顺延至 ${adjustedDeadline.format("M月D日 HH:mm")}。`,
  };
}

function normalizePlannedActions(actions: AssistantPlannedAction[], taskMap: Map<string, DashboardTask>) {
  const normalized: AssistantPlannedAction[] = [];
  const notes: string[] = [];
  for (const action of actions) {
    if (action.type !== "update_task_core") {
      normalized.push(action);
      continue;
    }
    const reconciled = reconcileTaskCoreSchedulePatch(action, taskMap);
    normalized.push(reconciled.action);
    if (reconciled.note) {
      notes.push(reconciled.note);
    }
  }
  return { actions: normalized, notes };
}

function buildPendingActionBundle(actions: AssistantPlannedAction[], taskMap: Map<string, DashboardTask>, notes: string[] = []): AssistantPendingAction {
  const impacts = actions.map((action) => buildActionImpact(action, taskMap));
  const previewLines = actions.map((action, index) => `${index + 1}. ${describeAction(action, taskMap)}`);
  const risky = actions.some((action) => isHighRiskAction(action));
  const noteLines = notes.map((note) => `- ${note}`).join("\n");
  const previewText = `${risky ? "以下是高风险改动预览，确认后才会执行：" : "以下动作待确认，确认后执行："}${noteLines ? `\n${noteLines}` : ""}\n${previewLines.join("\n")}`;

  return {
    type: "confirm_actions",
    actions,
    previewText,
    impacts,
  };
}

function buildLocalPlan(input: {
  message: string;
  tasks: DashboardTask[];
  currentBestTask: DashboardTask | null;
  topTasksForToday: DashboardTask[];
  reviewTasks: DashboardTask[];
  waitingTasks: DashboardTask[];
  dueWaitingTasks: DashboardTask[];
  courseContext?: CourseAssistantContext;
  policy: AssistantStrategyPolicy;
  context?: AssistantConversationContext;
}): {
  reply: string;
  actions: AssistantPlannedAction[];
  referencedTaskIds: string[];
  pendingAction?: AssistantPendingAction | null;
  clarifyState?: AssistantClarifyState | null;
  confirmedFromPending?: boolean;
} | null {
  const { message, tasks, currentBestTask, topTasksForToday, reviewTasks, waitingTasks, dueWaitingTasks, courseContext, context, policy } = input;
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const resolveReviewIntent = /解析没问题|确认解析|确认无误|退出待确认/.test(message);

  if (context?.pendingAction) {
    if (/^(确认|确认执行|是的|是|好的|好|行|可以|就这样|执行)$/u.test(message)) {
      return {
        reply: "已确认，我现在执行这条动作。",
        actions: context.pendingAction.actions,
        referencedTaskIds: getPendingActionTaskIds(context.pendingAction),
        pendingAction: null,
        confirmedFromPending: true,
      };
    }

    if (/^(取消|不用了|先不了|算了|撤销这次操作)$/u.test(message)) {
      return {
        reply: "这条待执行动作已取消，没有改动任务。",
        actions: [],
        referencedTaskIds: getPendingActionTaskIds(context.pendingAction),
        pendingAction: null,
      };
    }
  }

  if (context?.undoAction && /^(撤销|撤销上一步|回滚|撤回刚才的操作)$/u.test(message)) {
    return {
      reply: "已收到，我会撤销上一步改动。",
      actions: [],
      referencedTaskIds: [],
      pendingAction: null,
    };
  }

  if (
    /(新增|添加|创建|加).*(任务|待办)/.test(message) &&
    (
      /(今天|今日|当天|当日).*(课程|门课)/.test(message) ||
      /课程.*(今天|今日|当天|当日)/.test(message) ||
      /(三|3)\s*(?:个|门)?课程/.test(message)
    ) &&
    /(每周三|周三|星期三)/.test(message)
  ) {
    const courseTitles = extractCourseTitlesFromSummary(courseContext?.todayCourseSummary ?? "");
    if (courseTitles.length === 0) {
      return {
        reply: "我知道你想按今日课程批量建任务，但当前没读到今天课程。请先确认课表配置。",
        actions: [],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }
    const countHint = parseTaskCountHint(message);
    const pickedTitles = (countHint ? courseTitles.slice(0, countHint) : courseTitles).slice(0, 6);
    const parsedClock = parseAnyClockTime(message);
    if (!parsedClock) {
      return {
        reply: "可以，我会按今日课程创建每周三复习任务。先补一个执行时刻（如 20:00）？",
        actions: [],
        referencedTaskIds: [],
        pendingAction: null,
        clarifyState: {
          type: "create_task_batch_execution_time",
          courseTitles: pickedTitles,
          turns: 1,
        },
      };
    }
    const sourceText = pickedTitles.map((title) => `每周三${formatClock(parsedClock.hour, parsedClock.minute)}复习${title}`).join("；");
    const pendingAction = buildPendingActionBundle([{ type: "create_task", sourceText }], taskMap);
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [],
      pendingAction,
      clarifyState: null,
    };
  }

  const createMatch = message.match(/^(?:帮我)?(?:加一个|新增|添加|创建|记一个)(?:任务|待办)?[：:\s]+(.+)$/);
  if (createMatch?.[1]) {
    const sourceText = createMatch[1].trim();
    const hasRelativeDay = /(今天|今日|明天|明日)/.test(sourceText);
    if (hasRelativeDay && !hasExplicitClock(sourceText)) {
      const dayHint: "today" | "tomorrow" = /(明天|明日)/.test(sourceText) ? "tomorrow" : "today";
      return {
        reply: `这条任务提到了${dayHint === "tomorrow" ? "明天" : "今天"}，但没写具体截止时刻。要不要补一个时间（如 ${dayHint === "tomorrow" ? "明天20:00" : "今天20:00"}）？`,
        actions: [],
        referencedTaskIds: [],
        pendingAction: null,
        clarifyState: {
          type: "create_task_deadline_time",
          sourceText,
          dayHint,
          turns: 1,
        },
      };
    }
    const pendingAction = buildPendingActionBundle([{ type: "create_task", sourceText }], taskMap);
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [],
      pendingAction,
      clarifyState: null,
    };
  }

  const summaryReply = resolveReviewIntent
    ? null
    : buildLocalSummary(message, currentBestTask, topTasksForToday, reviewTasks, waitingTasks, dueWaitingTasks, tasks, courseContext);
  if (summaryReply) {
    return {
      reply: summaryReply,
      actions: [] as AssistantPlannedAction[],
      referencedTaskIds: collectReferencedTaskIds(summaryReply, [], currentBestTask),
      pendingAction: context?.pendingAction ?? null,
    };
  }

  const deleteIntent = /(删除|删掉|删了|移除).*(任务|待办)?/.test(message) && !/(来源|source|文件|文档)/i.test(message);
  const picked = pickTaskFromMessage(tasks, message, currentBestTask, reviewTasks, waitingTasks, context?.lastReferencedTaskId);
  if (picked.ambiguous && !deleteIntent) {
    return {
      reply: "我能看出你要改某条任务，但当前匹配到不止一条。你可以再带上更完整的任务标题，或直接贴任务 id。",
      actions: [] as AssistantPlannedAction[],
      referencedTaskIds: [],
      pendingAction: context?.pendingAction ?? null,
    };
  }

  const inferredTask =
    picked.task ??
    (isArrangementIntent(message) && policy.autoSelectCurrentBestTaskOnArrange ? currentBestTask : null) ??
    ((statusKeywordMap.find((item) => item.pattern.test(message)) && policy.autoSelectCurrentBestTaskOnStatus) ? currentBestTask : null);
  const task = inferredTask;
  const parsedTime = parseClockTimeFromText(message);

  if (deleteIntent) {
    const explicitTargets = findExplicitlyMentionedTasks(tasks, message);
    const deleteAllKeyword = /(全部|所有|全删|清空|统统|全部都)/.test(message);
    const batchKeyword = /(批量|多个|几条|几项|这些|这几条|全部|所有|一起|统统)/.test(message);
    let targets: DashboardTask[] = [];

    if (explicitTargets.length > 0) {
      targets = explicitTargets;
    } else if (deleteAllKeyword) {
      targets = tasks;
    } else if (/待确认|确认队列|需要确认/.test(message) && reviewTasks.length > 0) {
      targets = reviewTasks;
    } else if (/等待任务|等待中|回看/.test(message) && waitingTasks.length > 0) {
      targets = waitingTasks;
    } else if (/今天任务|今日任务|今天要做|今天优先/.test(message) && topTasksForToday.length > 0) {
      targets = topTasksForToday;
    } else if (task) {
      targets = [task];
    }

    if (targets.length === 0) {
      return {
        reply: deleteAllKeyword ? "当前没有可删除任务。" : "可以删，但我还没定位到具体任务。请补任务标题，或直接说“删除待确认任务”。",
        actions: [],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    if (!batchKeyword && explicitTargets.length === 0 && targets.length > 1) {
      return {
        reply: "你这句可能会删多条任务。为避免误删，请补一句“批量删除”或明确列出任务标题。",
        actions: [],
        referencedTaskIds: targets.map((item) => item.id),
        pendingAction: null,
      };
    }

    const uniqueTargets = [...new Map(targets.map((item) => [item.id, item])).values()];
    if (uniqueTargets.length > 200) {
      return {
        reply: `这次会删除 ${uniqueTargets.length} 条任务，超出安全上限（200）。请先按范围分批删除。`,
        actions: [],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }
    const pendingAction = buildPendingActionBundle(
      uniqueTargets.map((item) => ({ type: "delete_task", taskId: item.id })),
      taskMap,
    );
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: uniqueTargets.map((item) => item.id),
      pendingAction,
      clarifyState: null,
    };
  }

  if (/(一键修复|自动修复).*(时间|截止|排程).*(冲突|问题)?/.test(message)) {
    const pendingAction = buildPendingActionBundle([{ type: "auto_fix_time_semantics" }], taskMap);
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [],
      pendingAction,
      clarifyState: null,
    };
  }

  if (context?.clarifyState?.type === "create_task_deadline_time") {
    if (/^(取消|不用了|先不了|算了)$/u.test(message)) {
      return {
        reply: "好的，这次新增任务已取消。",
        actions: [],
        referencedTaskIds: [],
        pendingAction: null,
        clarifyState: null,
      };
    }

    const currentTurns = context.clarifyState.turns ?? 0;
    if (/(推荐|建议|什么时候|几点|哪个时间)/.test(message) && !parseAnyClockTime(message)) {
      const dayLabel = context.clarifyState.dayHint === "tomorrow" ? "明天" : "今天";
      return {
        reply: `建议先用${dayLabel} 20:00，通常不压白天执行窗口。你也可以直接回复具体时刻（如“19:30”）。`,
        actions: [],
        referencedTaskIds: [],
        pendingAction: null,
        clarifyState: {
          ...context.clarifyState,
          turns: currentTurns + 1,
        },
      };
    }
    const parsedClock = parseAnyClockTime(message);
    if (parsedClock) {
      const dayLabel = context.clarifyState.dayHint === "tomorrow" ? "明天" : "今天";
      const clockLabel = `${String(parsedClock.hour).padStart(2, "0")}:${String(parsedClock.minute).padStart(2, "0")}`;
      const sourceText = `${context.clarifyState.sourceText}（截止${dayLabel}${clockLabel}）`;
      const pendingAction = buildPendingActionBundle([{ type: "create_task", sourceText }], taskMap);
      return {
        reply: pendingAction.previewText,
        actions: [],
        referencedTaskIds: [],
        pendingAction,
        clarifyState: null,
      };
    }

    if (/默认|按默认|就这样|不用补|不设置/.test(message) || currentTurns >= policy.maxClarifyTurns) {
      const pendingAction = buildPendingActionBundle([{ type: "create_task", sourceText: context.clarifyState.sourceText }], taskMap);
      return {
        reply: pendingAction.previewText,
        actions: [],
        referencedTaskIds: [],
        pendingAction,
        clarifyState: null,
      };
    }

    return {
      reply: "这条新增任务还缺具体截止时刻。你可以回复如“20:30”，或回复“默认”跳过。",
      actions: [],
      referencedTaskIds: [],
      pendingAction: null,
      clarifyState: {
        ...context.clarifyState,
        turns: currentTurns + 1,
      },
    };
  }

  if (context?.clarifyState?.type === "create_task_batch_execution_time") {
    if (/^(取消|不用了|先不了|算了)$/u.test(message)) {
      return {
        reply: "好的，这次批量新增已取消。",
        actions: [],
        referencedTaskIds: [],
        pendingAction: null,
        clarifyState: null,
      };
    }

    const currentTurns = context.clarifyState.turns ?? 0;
    if (/(推荐|建议|什么时候|几点|哪个时间)/.test(message)) {
      return {
        reply: "建议设在每周三 19:00 或 20:00。若你晚课后状态更好，优先 20:00。你定一个我再生成确认预览。",
        actions: [],
        referencedTaskIds: [],
        pendingAction: null,
        clarifyState: {
          ...context.clarifyState,
          turns: currentTurns + 1,
        },
      };
    }
    const parsedClock = parseAnyClockTime(message);
    if (parsedClock) {
      const clock = formatClock(parsedClock.hour, parsedClock.minute);
      const sourceText = context.clarifyState.courseTitles.map((title) => `每周三${clock}复习${title}`).join("；");
      const pendingAction = buildPendingActionBundle([{ type: "create_task", sourceText }], taskMap);
      return {
        reply: pendingAction.previewText,
        actions: [],
        referencedTaskIds: [],
        pendingAction,
        clarifyState: null,
      };
    }

    if (/默认|按默认|就这样|不用补/.test(message) || currentTurns >= policy.maxClarifyTurns) {
      const sourceText = context.clarifyState.courseTitles.map((title) => `每周三复习${title}`).join("；");
      const pendingAction = buildPendingActionBundle([{ type: "create_task", sourceText }], taskMap);
      return {
        reply: pendingAction.previewText,
        actions: [],
        referencedTaskIds: [],
        pendingAction,
        clarifyState: null,
      };
    }

    return {
      reply: "请补一个每周三执行时刻（如 20:00），或回复“默认”。",
      actions: [],
      referencedTaskIds: [],
      pendingAction: null,
      clarifyState: {
        ...context.clarifyState,
        turns: currentTurns + 1,
      },
    };
  }

  if (context?.clarifyState?.type === "arrange_task_time") {
    if (/^(取消|不用了|先不了|算了)$/u.test(message)) {
      return {
        reply: "好的，这次排程调整已取消。",
        actions: [],
        referencedTaskIds: context.clarifyState.taskId ? [context.clarifyState.taskId] : [],
        pendingAction: null,
        clarifyState: null,
      };
    }

    const clarifiedTask =
      (context.clarifyState.taskId ? tasks.find((item) => item.id === context.clarifyState.taskId) ?? null : null) ??
      task;
    const clarifiedHour = parsedTime?.hour ?? context.clarifyState.hour ?? null;
    const clarifiedMinute = parsedTime?.minute ?? context.clarifyState.minute ?? null;

    if (clarifiedTask && clarifiedHour !== null && clarifiedMinute !== null) {
      const startAtISO = nowInTaipei().hour(clarifiedHour).minute(clarifiedMinute).second(0).millisecond(0).toISOString();
      const normalized = normalizePlannedActions([{ type: "update_task_core", taskId: clarifiedTask.id, patch: { startAtISO } }], taskMap);
      const pendingAction = buildPendingActionBundle(normalized.actions, taskMap, normalized.notes);
      return {
        reply: pendingAction.previewText,
        actions: [],
        referencedTaskIds: [clarifiedTask.id],
        pendingAction,
        clarifyState: null,
      };
    }

    const currentTurns = context.clarifyState.turns ?? 0;
    if (currentTurns >= policy.maxClarifyTurns) {
      const fallbackTask = clarifiedTask ?? (policy.autoSelectCurrentBestTaskOnArrange ? currentBestTask : null);
      const fallbackHour = clarifiedHour ?? 19;
      const fallbackMinute = clarifiedMinute ?? 0;
      if (fallbackTask) {
        const startAtISO = nowInTaipei().hour(fallbackHour).minute(fallbackMinute).second(0).millisecond(0).toISOString();
        const normalized = normalizePlannedActions([{ type: "update_task_core", taskId: fallbackTask.id, patch: { startAtISO } }], taskMap);
        const pendingAction = buildPendingActionBundle(
          normalized.actions,
          taskMap,
          [...normalized.notes, `未收到完整补充信息，已按默认策略使用「${fallbackTask.title}」${String(fallbackHour).padStart(2, "0")}:${String(fallbackMinute).padStart(2, "0")}。`],
        );
        return {
          reply: pendingAction.previewText,
          actions: [],
          referencedTaskIds: [fallbackTask.id],
          pendingAction,
          clarifyState: null,
        };
      }
    }

    const ask = [
      clarifiedTask ? "" : "任务名称",
      clarifiedHour !== null && clarifiedMinute !== null ? "" : "具体时间（如 20:00）",
    ].filter(Boolean);
    return {
      reply: `我继续处理这条排程，但还缺：${ask.join("、")}。请直接补一句。`,
      actions: [],
      referencedTaskIds: clarifiedTask ? [clarifiedTask.id] : [],
      pendingAction: null,
      clarifyState: {
        type: "arrange_task_time",
        taskId: clarifiedTask?.id ?? null,
        hour: clarifiedHour,
        minute: clarifiedMinute,
        turns: currentTurns + 1,
      },
    };
  }

  if (isArrangementIntent(message) && (!task || !parsedTime)) {
    const ask = [
      task ? "" : "任务名称",
      parsedTime ? "" : "具体时间（如 20:00）",
    ].filter(Boolean);
    return {
      reply: `可以，我来安排。为了避免误改，请先补充：${ask.join("、")}。`,
      actions: [],
      referencedTaskIds: task ? [task.id] : [],
      pendingAction: null,
      clarifyState: {
        type: "arrange_task_time",
        taskId: task?.id ?? null,
        hour: parsedTime?.hour ?? null,
        minute: parsedTime?.minute ?? null,
        turns: 1,
      },
    };
  }

  if (resolveReviewIntent) {
    if (!task) {
      return {
        reply: "我知道你想确认解析结果，但还没定位到具体任务。请补一句任务标题。",
        actions: [] as AssistantPlannedAction[],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    const pendingAction = buildPendingActionBundle([{ type: "resolve_review", taskId: task.id }], taskMap);
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [task.id],
      pendingAction,
    };
  }

  if (/今晚再看|今天晚上再看/.test(message)) {
    if (!task) {
      return {
        reply: "我知道你想延后回看，但还没定位到具体任务。请补一句任务标题。",
        actions: [] as AssistantPlannedAction[],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    const pendingAction = buildPendingActionBundle([{ type: "schedule_follow_up", taskId: task.id, preset: "tonight" }], taskMap);
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [task.id],
      pendingAction,
    };
  }

  if (/明天再看/.test(message)) {
    if (!task) {
      return {
        reply: "我知道你想延后回看，但还没定位到具体任务。请补一句任务标题。",
        actions: [] as AssistantPlannedAction[],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    const pendingAction = buildPendingActionBundle([{ type: "schedule_follow_up", taskId: task.id, preset: "tomorrow" }], taskMap);
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [task.id],
      pendingAction,
    };
  }

  if (/下周再看|下星期再看/.test(message)) {
    if (!task) {
      return {
        reply: "我知道你想延后回看，但还没定位到具体任务。请补一句任务标题。",
        actions: [] as AssistantPlannedAction[],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    const pendingAction = buildPendingActionBundle([{ type: "schedule_follow_up", taskId: task.id, preset: "next_week" }], taskMap);
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [task.id],
      pendingAction,
    };
  }

  if (/重置本轮|重置进度|清空本轮/.test(message)) {
    if (!task) {
      return {
        reply: "我知道你想重置进度，但还没定位到具体任务。请补一句任务标题。",
        actions: [] as AssistantPlannedAction[],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    const pendingAction = buildPendingActionBundle([{ type: "record_progress", taskId: task.id, mode: "reset" }], taskMap);
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [task.id],
      pendingAction,
    };
  }

  if (/撤回.?1次|撤回一次|减.?1|回退一次/.test(message)) {
    if (!task) {
      return {
        reply: "我知道你想撤回一次进度，但还没定位到具体任务。请补一句任务标题。",
        actions: [] as AssistantPlannedAction[],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    const pendingAction = buildPendingActionBundle([{ type: "record_progress", taskId: task.id, mode: "decrement" }], taskMap);
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [task.id],
      pendingAction,
    };
  }

  if (/(\+1|加.?1|记一次|记录一次|完成一次|打卡)/.test(message)) {
    if (!task) {
      return {
        reply: "我知道你想记录一次进度，但还没定位到具体任务。请补一句任务标题。",
        actions: [] as AssistantPlannedAction[],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    const pendingAction = buildPendingActionBundle([{ type: "record_progress", taskId: task.id, mode: "increment" }], taskMap);
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [task.id],
      pendingAction,
    };
  }

  const estimatedMatch = message.match(/(?:预估|预计|时长|耗时)\s*(\d{2,3})\s*分钟/);
  const statusMatch = statusKeywordMap.find((item) => item.pattern.test(message));
  if (task && (isArrangementIntent(message) || estimatedMatch || statusMatch)) {
    const patch: Record<string, unknown> = {};
    if (isArrangementIntent(message) && parsedTime) {
      patch.startAtISO = nowInTaipei().hour(parsedTime.hour).minute(parsedTime.minute).second(0).millisecond(0).toISOString();
    }
    if (estimatedMatch) {
      const estimatedMinutes = Number(estimatedMatch[1]);
      if (estimatedMinutes >= 10 && estimatedMinutes <= 480) {
        patch.estimatedMinutes = estimatedMinutes;
      }
    }

    const actions: AssistantPlannedAction[] = [];
    if (Object.keys(patch).length > 0) {
      actions.push({ type: "update_task_core", taskId: task.id, patch } as AssistantPlannedAction);
    }
    if (statusMatch) {
      actions.push({ type: "update_status", taskId: task.id, status: statusMatch.status, note: statusMatch.note });
    }

    if (actions.length > 0) {
      const normalized = normalizePlannedActions(actions, taskMap);
      const pendingAction = buildPendingActionBundle(normalized.actions, taskMap, normalized.notes);
      return {
        reply: pendingAction.previewText,
        actions: [],
        referencedTaskIds: [task.id],
        pendingAction,
        clarifyState: null,
      };
    }
  }

  if (statusMatch) {
    if (!task) {
      return {
        reply: "我知道你想改状态，但还没定位到具体任务。请补一句任务标题。",
        actions: [] as AssistantPlannedAction[],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    const pendingAction = buildPendingActionBundle(
      [{ type: "update_status", taskId: task.id, status: statusMatch.status, note: statusMatch.note }],
      taskMap,
    );
    return {
      reply: pendingAction.previewText,
      actions: [],
      referencedTaskIds: [task.id],
      pendingAction,
    };
  }

  return null;
}

function buildAiSystemPrompt(skill: AssistantSkill, toolCatalog: string[]) {
  return `你是首页里的中文任务管理助手。你可以阅读全部任务，并帮助用户做两类事：
1. 回答任务问题，例如“现在最该做什么”“待确认里有什么”“哪些任务快到期了”“今天课表和空档是什么”。
2. 在用户明确要求时执行安全管理动作。

你必须输出严格 JSON，格式为：
{
  "reply": "给用户的中文回复",
  "actions": []
}

actions 仅允许以下类型：
1. {"type":"update_status","taskId":"...","status":"ready|waiting|in_progress|pending_submit|done|ignored|needs_review|overdue","note":"可选"}
2. {"type":"resolve_review","taskId":"...","note":"可选"}
3. {"type":"schedule_follow_up","taskId":"...","preset":"tonight|tomorrow|next_week","note":"可选"}
4. {"type":"record_progress","taskId":"...","mode":"increment|decrement|reset"}
5. {"type":"create_task","sourceText":"用户要新增的任务原文"}
6. {"type":"delete_task","taskId":"..."}
7. {"type":"auto_fix_time_semantics"}
8. {"type":"update_task_core","taskId":"...","patch":{"可编辑字段": "值"}}

规则：
1. 只有当用户明确要求修改任务时，才能填写 actions。
1.1 如果用户明确说“新增任务/加一个任务/记一个任务”，可以使用 create_task。
1.2 如果用户只是口头确认上一轮挂起动作，例如“是的/确认/可以”，请直接执行当前 pendingAction。
2. 如果任务不明确、可能有歧义、或你拿不准 taskId，就不要执行动作，只在 reply 里要求用户澄清。
2.0 支持批量删除任务：当用户明确说“批量删除/删除这些/删除待确认任务”等，允许返回多个 delete_task 动作。
2.4 允许在一次回复里组合多条 actions（连续工具调用），例如先 update_task_core 再 update_status。
2.1 你可以参考今日课表与空档给出建议，但课表问题本身不应触发 actions。
2.2 若用户要求“调整今日日程安排”，优先使用 update_task_core 修改 startAtISO、estimatedMinutes、snoozeUntilISO、status 等字段。
2.3 任何涉及 startAtISO/deadlineISO 的调整，都要确保开始时间不晚于截止时间；若用户明确要改到更晚时间，应一并给出截止顺延方案。
3. 永远不要编造 taskId。
4. 不要输出任何 JSON 之外的说明。
5. 语气直接、简洁、会做事。

当前技能：${skill}
技能指令：${getSkillInstruction(skill)}
可用工具：${toolCatalog.join(" | ")}`;
}

function buildAiUserPrompt(args: {
  message: string;
  history: AssistantHistoryMessage[];
  tasks: DashboardTask[];
  currentBestTask: DashboardTask | null;
  reviewTasks: DashboardTask[];
  waitingTasks: DashboardTask[];
  dueWaitingTasks: DashboardTask[];
  courseContext?: CourseAssistantContext;
  loadedDataSummary: string;
  context?: AssistantConversationContext;
}) {
  const historyText =
    args.history.length === 0
      ? "无"
      : args.history
          .slice(-6)
          .map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.content}`)
          .join("\n");

  return `当前首页任务上下文：
当前最该做：${args.currentBestTask ? `${args.currentBestTask.id} / ${args.currentBestTask.title}` : "无"}
最近一轮锁定任务：${args.context?.lastReferencedTaskId || "无"}
待确认数量：${args.reviewTasks.length}
等待中数量：${args.waitingTasks.length}
到点回看数量：${args.dueWaitingTasks.length}
今日课程：${args.courseContext?.todayCourseSummary ?? "未提供课表"}
今日课程空档：${args.courseContext?.todayFreeWindowSummary ?? "未提供课表"}
今日日程安排摘要：${args.courseContext?.todayArrangementSummary ?? "未提供"}
按需读取数据：${args.loadedDataSummary}

全部任务列表：
${buildTaskContext(args.tasks)}

最近对话：
${historyText}

用户本轮输入：
${args.message}`;
}

function buildLoadedDataSummary(
  skill: AssistantSkill,
  dashboard: DashboardData,
  courseContext: CourseAssistantContext,
) {
  if (skill === "course_reader") {
    return `已读取：今日课程 ${courseContext.todayCourses.length} 节；空档 ${courseContext.todayFreeWindowSummary}`;
  }
  if (skill === "schedule_ops") {
    return `已读取：今日日程摘要；必须任务 ${dashboard.todayMustDoTasks.length} 条；提醒 ${dashboard.todayReminderTasks.length} 条`;
  }
  return `已读取：任务总数 ${dashboard.tasks.length}；待确认 ${dashboard.reviewTasks.length}；等待 ${dashboard.waitingTasks.length}`;
}

async function planWithAi(args: {
  message: string;
  history: AssistantHistoryMessage[];
  tasks: DashboardTask[];
  currentBestTask: DashboardTask | null;
  reviewTasks: DashboardTask[];
  waitingTasks: DashboardTask[];
  dueWaitingTasks: DashboardTask[];
  courseContext?: CourseAssistantContext;
  skill: AssistantSkill;
  toolCatalog: string[];
  loadedDataSummary: string;
  context?: AssistantConversationContext;
}) {
  const { client, config } = await getClient();

  if (!client || !config) {
    return null;
  }

  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: buildAiSystemPrompt(args.skill, args.toolCatalog),
        },
        {
          role: "user",
          content: buildAiUserPrompt(args),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      return null;
    }

    const parsed = extractJsonObject(raw);
    if (!parsed) {
      return null;
    }

    return assistantResponseSchema.parse(parsed);
  } catch {
    return null;
  }
}

async function executeAction(action: AssistantPlannedAction, taskMap: Map<string, DashboardTask>) {
  if (action.type === "create_task") {
    const created = await createAssistantTask(action.sourceText);
    return {
      taskIds: created.tasks.map((task) => task.id),
      taskTitle: created.tasks[0]?.title ?? action.sourceText,
      summary:
        created.tasks.length > 1
          ? `已新增 ${created.tasks.length} 条任务，来源已记录为“首页 AI 助手”`
          : `已新增任务「${created.tasks[0]?.title ?? action.sourceText}」`,
      createdTaskCards: created.tasks.map((task) => ({
        taskId: task.id,
        title: task.title,
        deadlineLabel: formatDeadline(task.deadline),
        statusLabel: statusLabels[task.status],
        needsHumanReview: task.needsHumanReview,
      })),
      impact: {
        taskId: "new",
        taskTitle: created.source.title || "首页 AI 助手",
        changedFields: ["source", "tasks", "status", "needsHumanReview"],
      },
      undoOperation: {
        type: "delete_source" as const,
        sourceId: created.source.id,
        sourceLabel: created.source.title || "首页 AI 助手",
      },
    };
  }

  if (action.type === "delete_task") {
    const task = taskMap.get(action.taskId);
    await deleteTask(action.taskId);
    return {
      taskIds: [action.taskId],
      taskTitle: task?.title ?? action.taskId,
      summary: `已删除「${task?.title ?? action.taskId}」`,
      createdTaskCards: [],
      impact: buildActionImpact(action, taskMap),
    };
  }

  if (action.type === "auto_fix_time_semantics") {
    const fixed = await fixAllTaskTimeSemanticConflicts({ minimumBufferMinutes: 20, limit: 200 });
    return {
      taskIds: fixed.results.map((item) => item.taskId),
      taskTitle: "批量时间语义修复",
      summary: fixed.fixedCount > 0 ? `已自动修复 ${fixed.fixedCount} 条时间冲突任务` : "未发现可自动修复的时间冲突任务",
      createdTaskCards: [],
      impact: buildActionImpact(action, taskMap),
    };
  }

  const task = taskMap.get(action.taskId);
  if (!task) {
    return null;
  }

  if (action.type === "update_status") {
    const snapshot = {
      taskId: task.id,
      taskTitle: task.title,
      status: task.status,
      needsHumanReview: task.needsHumanReview,
      reviewResolved: task.reviewResolved,
      reviewReasons: Array.isArray(task.reviewReasons) ? task.reviewReasons.map((item) => String(item)) : [],
      waitingFor: task.waitingFor,
      waitingReasonType: task.waitingReasonType,
      waitingReasonText: task.waitingReasonText,
      nextCheckAt: task.nextCheckAt ? new Date(task.nextCheckAt).toISOString() : null,
    };
    await updateTaskStatus(action.taskId, action.status, action.note);
    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已将「${task.title}」标记为${statusLabels[action.status]}`,
      createdTaskCards: [],
      impact: buildActionImpact(action, taskMap),
      undoOperation: { type: "restore_task_snapshot" as const, snapshot },
    };
  }

  if (action.type === "resolve_review") {
    const snapshot = {
      taskId: task.id,
      taskTitle: task.title,
      status: task.status,
      needsHumanReview: task.needsHumanReview,
      reviewResolved: task.reviewResolved,
      reviewReasons: Array.isArray(task.reviewReasons) ? task.reviewReasons.map((item) => String(item)) : [],
      waitingFor: task.waitingFor,
      waitingReasonType: task.waitingReasonType,
      waitingReasonText: task.waitingReasonText,
      nextCheckAt: task.nextCheckAt ? new Date(task.nextCheckAt).toISOString() : null,
    };
    await resolveTaskReview(action.taskId, action.note);
    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已确认「${task.title}」的解析结果`,
      createdTaskCards: [],
      impact: buildActionImpact(action, taskMap),
      undoOperation: { type: "restore_task_snapshot" as const, snapshot },
    };
  }

  if (action.type === "schedule_follow_up") {
    const snapshot = {
      taskId: task.id,
      taskTitle: task.title,
      status: task.status,
      needsHumanReview: task.needsHumanReview,
      reviewResolved: task.reviewResolved,
      reviewReasons: Array.isArray(task.reviewReasons) ? task.reviewReasons.map((item) => String(item)) : [],
      waitingFor: task.waitingFor,
      waitingReasonType: task.waitingReasonType,
      waitingReasonText: task.waitingReasonText,
      nextCheckAt: task.nextCheckAt ? new Date(task.nextCheckAt).toISOString() : null,
    };
    await scheduleTaskFollowUp(action.taskId, action.preset as WaitingFollowUpPreset, action.note);
    const label = action.preset === "tonight" ? "今晚" : action.preset === "tomorrow" ? "明天" : "下周";
    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已将「${task.title}」设为${label}再回看`,
      createdTaskCards: [],
      impact: buildActionImpact(action, taskMap),
      undoOperation: { type: "restore_task_snapshot" as const, snapshot },
    };
  }

  if (action.type === "update_task_core") {
    const recurrenceDays = Array.isArray(task.recurrenceDays)
      ? task.recurrenceDays.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
      : [];
    const applicableIdentities = Array.isArray(task.applicableIdentities)
      ? task.applicableIdentities.map((item) => String(item)).filter(Boolean)
      : [];
    const materials = normalizeMaterials(task.materials);

    await updateTaskCore(action.taskId, {
      title: action.patch.title ?? task.title,
      description: action.patch.description ?? task.description,
      startAt:
        action.patch.startAtISO !== undefined
          ? normalizeAssistantStartAtIso(action.patch.startAtISO ?? null)
          : task.startAt,
      submitTo: action.patch.submitTo !== undefined ? action.patch.submitTo : task.submitTo,
      submitChannel: action.patch.submitChannel !== undefined ? action.patch.submitChannel : task.submitChannel,
      applicableIdentities: action.patch.applicableIdentities ?? applicableIdentities,
      identityHint: action.patch.identityHint !== undefined ? action.patch.identityHint : task.identityHint,
      recurrenceType: action.patch.recurrenceType ?? task.recurrenceType,
      recurrenceDays: action.patch.recurrenceDays ?? recurrenceDays,
      recurrenceTargetCount: action.patch.recurrenceTargetCount ?? task.recurrenceTargetCount,
      recurrenceLimit: action.patch.recurrenceLimit !== undefined ? action.patch.recurrenceLimit : task.recurrenceLimit,
      recurrenceStartAt:
        action.patch.recurrenceStartISO !== undefined
          ? (action.patch.recurrenceStartISO ? new Date(action.patch.recurrenceStartISO) : null)
          : task.recurrenceStartAt,
      recurrenceUntil:
        action.patch.recurrenceUntilISO !== undefined
          ? (action.patch.recurrenceUntilISO ? new Date(action.patch.recurrenceUntilISO) : null)
          : task.recurrenceUntil,
      recurrenceMaxOccurrences:
        action.patch.recurrenceMaxOccurrences !== undefined ? action.patch.recurrenceMaxOccurrences : task.recurrenceMaxOccurrences,
      deadlineText: action.patch.deadlineText !== undefined ? action.patch.deadlineText : task.deadlineText,
      deadline: action.patch.deadlineISO !== undefined ? (action.patch.deadlineISO ? new Date(action.patch.deadlineISO) : null) : task.deadline,
      timezone: action.patch.timezone ?? task.timezone ?? "Asia/Shanghai",
      snoozeUntil:
        action.patch.snoozeUntilISO !== undefined
          ? (action.patch.snoozeUntilISO ? new Date(action.patch.snoozeUntilISO) : null)
          : task.snoozeUntil,
      deliveryType: action.patch.deliveryType ?? task.deliveryType,
      requiresSignature: action.patch.requiresSignature ?? task.requiresSignature,
      requiresStamp: action.patch.requiresStamp ?? task.requiresStamp,
      dependsOnExternal: action.patch.dependsOnExternal ?? task.dependsOnExternal,
      waitingFor:
        action.patch.waitingReasonText !== undefined
          ? action.patch.waitingReasonText
          : task.waitingFor,
      waitingReasonType:
        action.patch.waitingReasonType !== undefined ? action.patch.waitingReasonType : task.waitingReasonType,
      waitingReasonText:
        action.patch.waitingReasonText !== undefined ? action.patch.waitingReasonText : task.waitingReasonText,
      nextCheckAt:
        action.patch.nextCheckAtISO !== undefined
          ? (action.patch.nextCheckAtISO ? new Date(action.patch.nextCheckAtISO) : null)
          : task.nextCheckAt,
      nextActionSuggestion: action.patch.nextActionSuggestion ?? task.nextActionSuggestion,
      estimatedMinutes: action.patch.estimatedMinutes !== undefined ? action.patch.estimatedMinutes : task.estimatedMinutes,
      status: action.patch.status ?? task.status,
      materials: action.patch.materials ?? materials,
      taskType: action.patch.taskType ?? task.taskType,
    });

    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已更新「${task.title}」的 ${Object.keys(action.patch).join("、")}`,
      createdTaskCards: [],
      impact: buildActionImpact(action, taskMap),
    };
  }

  if (action.mode === "increment") {
    const completedAts = (task.progressLogs ?? []).map((log) => new Date(log.completedAt).toISOString());
    await recordTaskProgress(action.taskId);
    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已给「${task.title}」记录 1 次进度`,
      createdTaskCards: [],
      impact: buildActionImpact(action, taskMap),
      undoOperation: { type: "restore_progress_logs" as const, taskId: task.id, taskTitle: task.title, completedAts },
    };
  }

  if (action.mode === "decrement") {
    const completedAts = (task.progressLogs ?? []).map((log) => new Date(log.completedAt).toISOString());
    await undoTaskProgress(action.taskId);
    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已给「${task.title}」撤回 1 次进度`,
      createdTaskCards: [],
      impact: buildActionImpact(action, taskMap),
      undoOperation: { type: "restore_progress_logs" as const, taskId: task.id, taskTitle: task.title, completedAts },
    };
  }

  const completedAts = (task.progressLogs ?? []).map((log) => new Date(log.completedAt).toISOString());
  await resetTaskProgressCycle(action.taskId);
  return {
    taskIds: [task.id],
    taskTitle: task.title,
    summary: `已重置「${task.title}」当前这一轮进度`,
    createdTaskCards: [],
    impact: buildActionImpact(action, taskMap),
    undoOperation: { type: "restore_progress_logs" as const, taskId: task.id, taskTitle: task.title, completedAts },
  };
}

function buildCourseContextWithArrangement(settings: Awaited<ReturnType<typeof getAppSettings>>, dashboard: DashboardData) {
  const nextCourseContext = buildCourseAssistantContext(settings.courseSchedule);
  nextCourseContext.todayArrangementSummary = buildTodayArrangementSummary({
    courseContext: nextCourseContext,
    mustDoTasks: dashboard.todayMustDoTasks,
    shouldDoTasks: dashboard.todayShouldDoTasks,
    reminderTasks: dashboard.todayReminderTasks,
    canWaitTasks: dashboard.todayCanWaitTasks,
  });
  return nextCourseContext;
}

export async function handleHomeAssistantMessage(input: {
  message: string;
  history?: AssistantHistoryMessage[];
  context?: AssistantConversationContext;
}): Promise<AssistantResult> {
  const message = input.message.trim();
  if (!message) {
    return {
      reply: "你可以直接问我“现在最该做什么”，或者说“把某条任务标记为进行中”。",
      actionResults: [],
      mode: "local",
      changedTaskIds: [],
      referencedTaskIds: [],
      pendingAction: null,
      undoAction: null,
      clarifyState: null,
    };
  }

  const dashboard = await getDashboardData("all");
  if (!dashboard.databaseReady) {
    return {
      reply: "数据库还没准备好。先执行 `npm run setup` 或 `npm run db:push`，之后我才能读取和管理任务。",
      actionResults: [],
      mode: "local",
      changedTaskIds: [],
      referencedTaskIds: [],
      pendingAction: null,
      undoAction: null,
      clarifyState: null,
    };
  }

  const settings = await getAppSettings();
  const policy = resolveAssistantStrategyPolicy(settings.courseTableConfig);
  const courseContext = buildCourseContextWithArrangement(settings, dashboard);
  const skill = detectAssistantSkill(message);
  const toolCatalog = getSkillToolCatalog(skill);
  const loadedDataSummary = buildLoadedDataSummary(skill, dashboard, courseContext);

  if (input.context?.undoAction && /^(撤销|撤销上一步|回滚|撤回刚才的操作)$/u.test(message)) {
    const summaries: string[] = [];
    const changedTaskIds: string[] = [];

    for (const operation of input.context.undoAction.actions) {
      if (operation.type === "restore_task_snapshot") {
        await restoreTaskAssistantSnapshot({
          taskId: operation.snapshot.taskId,
          status: operation.snapshot.status,
          needsHumanReview: operation.snapshot.needsHumanReview,
          reviewResolved: operation.snapshot.reviewResolved,
          reviewReasons: operation.snapshot.reviewReasons,
          waitingFor: operation.snapshot.waitingFor,
          waitingReasonType: operation.snapshot.waitingReasonType,
          waitingReasonText: operation.snapshot.waitingReasonText,
          nextCheckAt: operation.snapshot.nextCheckAt,
        });
        changedTaskIds.push(operation.snapshot.taskId);
        summaries.push(`已恢复「${operation.snapshot.taskTitle}」`);
        continue;
      }

      if (operation.type === "restore_progress_logs") {
        await restoreTaskProgressLogs(operation.taskId, operation.completedAts);
        changedTaskIds.push(operation.taskId);
        summaries.push(`已恢复「${operation.taskTitle}」进度`);
        continue;
      }

      await deleteSource(operation.sourceId);
      summaries.push(`已删除来源「${operation.sourceLabel}」及其新增任务`);
    }

    return {
      reply: `已撤销上一步操作。${summaries.join("；")}`,
      actionResults: [],
      mode: "local",
      changedTaskIds: [...new Set(changedTaskIds)],
      referencedTaskIds: [...new Set(changedTaskIds)],
      pendingAction: null,
      undoAction: null,
      clarifyState: null,
    };
  }

  const localPlan = buildLocalPlan({
    message,
    tasks: dashboard.tasks,
    currentBestTask: dashboard.currentBestTask,
    topTasksForToday: dashboard.topTasksForToday,
    reviewTasks: dashboard.reviewTasks,
    waitingTasks: dashboard.waitingTasks,
    dueWaitingTasks: dashboard.dueWaitingTasks,
    courseContext,
    policy,
    context: input.context,
  });

  const aiPlan = await planWithAi({
    message,
    history: input.history ?? [],
    tasks: dashboard.tasks,
    currentBestTask: dashboard.currentBestTask,
    reviewTasks: dashboard.reviewTasks,
    waitingTasks: dashboard.waitingTasks,
    dueWaitingTasks: dashboard.dueWaitingTasks,
    courseContext,
    skill,
    toolCatalog,
    loadedDataSummary,
    context: input.context,
  });

  const aiPlanned = aiPlan
    ? {
        ...aiPlan,
        referencedTaskIds: aiPlan.actions.flatMap((action) => ("taskId" in action ? [action.taskId] : [])),
      }
    : null;

  const planned =
    (shouldPreferLocalPlan(localPlan) ? localPlan : null) ??
    aiPlanned ??
    localPlan ??
    {
      reply: "我能读任务并帮你做常见管理动作。你可以试试：现在最该做什么、帮我看待确认队列、把某条任务标记为进行中。",
      actions: [] as AssistantPlannedAction[],
      referencedTaskIds: [] as string[],
      pendingAction: null,
    };

  const taskMap = new Map(dashboard.tasks.map((task) => [task.id, task]));
  const normalizedPlanned = normalizePlannedActions(planned.actions, taskMap);
  const finalPlanned = {
    ...planned,
    actions: normalizedPlanned.actions,
  };

  if (!finalPlanned.confirmedFromPending && (finalPlanned.pendingAction?.actions.length ?? 0) === 0 && finalPlanned.actions.length > 0) {
    const containsHighRisk = finalPlanned.actions.some((action) => isHighRiskAction(action));
    if (containsHighRisk) {
      const pendingAction = buildPendingActionBundle(finalPlanned.actions, taskMap, normalizedPlanned.notes);
      const previewTrace: NonNullable<AssistantResult["trace"]> = [
        {
          step: 1,
          planner: planned === localPlan ? "local" : "ai",
          actions: finalPlanned.actions.map((action) => describeAction(action, taskMap)),
          results: [],
          stopReason: "requires_confirmation",
        },
      ];
      return {
        reply: pendingAction.previewText,
        actionResults: [],
        mode: planned === localPlan ? "local" : "ai",
        changedTaskIds: [],
        referencedTaskIds: [...new Set([...(finalPlanned.referencedTaskIds ?? []), ...getPendingActionTaskIds(pendingAction)])],
        pendingAction,
        undoAction: input.context?.undoAction ?? null,
        clarifyState: finalPlanned.clarifyState ?? null,
        trace: previewTrace,
      };
    }
  }
  const actionResults: AssistantResult["actionResults"] = [];
  const undoOperations: AssistantUndoOperation[] = [];
  const actionSignatureSet = new Set<string>();
  const trace: NonNullable<AssistantResult["trace"]> = [];
  let referencedTaskIds = [...new Set([...(finalPlanned.referencedTaskIds ?? [])])];
  let latestPlanned = finalPlanned;
  let loopDashboard = dashboard;
  let loopCourseContext = courseContext;
  let loopReply = finalPlanned.reply;

  for (let step = 0; step < AI_AUTONOMOUS_MAX_STEPS; step += 1) {
    const stepNumber = step + 1;
    const stepPlanner: "local" | "ai" = step === 0 && planned === localPlan ? "local" : "ai";
    const loopTaskMap = new Map(loopDashboard.tasks.map((task) => [task.id, task]));
    const normalizedLoop = normalizePlannedActions(latestPlanned.actions, loopTaskMap);
    const currentActions = normalizedLoop.actions;
    const actionDescriptions = currentActions.map((action) => describeAction(action, loopTaskMap));

    if (currentActions.length === 0) {
      trace.push({
        step: stepNumber,
        planner: stepPlanner,
        actions: [],
        results: [],
        stopReason: "no_actions",
      });
      break;
    }

    const signature = JSON.stringify(currentActions);
    if (actionSignatureSet.has(signature)) {
      trace.push({
        step: stepNumber,
        planner: stepPlanner,
        actions: actionDescriptions,
        results: [],
        stopReason: "duplicate_actions",
      });
      loopReply = `${loopReply}\n已停止自动连锁执行：检测到重复动作。`;
      break;
    }
    actionSignatureSet.add(signature);

    const containsHighRisk = currentActions.some((action) => isHighRiskAction(action));
    if (step > 0 && containsHighRisk) {
      trace.push({
        step: stepNumber,
        planner: stepPlanner,
        actions: actionDescriptions,
        results: [],
        stopReason: "requires_confirmation",
      });
      const pendingAction = buildPendingActionBundle(currentActions, loopTaskMap, normalizedLoop.notes);
      return {
        reply: pendingAction.previewText,
        actionResults,
        mode: "ai",
        changedTaskIds: [...new Set(actionResults.map((item) => item.taskId).filter(Boolean))],
        referencedTaskIds: [...new Set([...referencedTaskIds, ...getPendingActionTaskIds(pendingAction), ...actionResults.map((item) => item.taskId).filter(Boolean)])],
        pendingAction,
        undoAction:
          undoOperations.length > 0
            ? {
                type: "undo_actions",
                actions: undoOperations,
                summary: `可撤销 ${undoOperations.length} 项变更`,
              }
            : null,
        clarifyState: null,
        trace,
      };
    }

    const batchSummaries: string[] = [];
    for (const action of currentActions) {
      const result = await executeAction(action, loopTaskMap);
      if (result) {
        if (result.undoOperation) {
          undoOperations.unshift(result.undoOperation);
        }
        actionResults.push({
          taskId: result.taskIds[0] ?? "",
          taskTitle: result.taskTitle,
          summary: result.summary,
          impact: result.impact,
          createdTaskCards: result.createdTaskCards,
        });
        batchSummaries.push(result.summary);
      }
    }

    trace.push({
      step: stepNumber,
      planner: stepPlanner,
      actions: actionDescriptions,
      results: batchSummaries,
    });

    referencedTaskIds = [...new Set([
      ...referencedTaskIds,
      ...currentActions.flatMap((action) => ("taskId" in action ? [action.taskId] : [] as string[])),
      ...actionResults.map((item) => item.taskId).filter(Boolean),
    ])];

    if (planned === localPlan || step + 1 >= AI_AUTONOMOUS_MAX_STEPS) {
      if (trace.length > 0) {
        trace[trace.length - 1] = {
          ...trace[trace.length - 1],
          stopReason: planned === localPlan ? "local_plan_completed" : "max_steps_reached",
        };
      }
      break;
    }

    loopDashboard = await getDashboardData("all");
    if (!loopDashboard.databaseReady) {
      break;
    }
    loopCourseContext = buildCourseContextWithArrangement(settings, loopDashboard);

    const stepPrompt = `请基于“上一批动作已执行后的最新状态”判断是否需要下一步；若不需要请返回 actions=[]。上一批执行结果：${batchSummaries.join("；")}。原始用户请求：${message}`;
    const nextAiPlan = await planWithAi({
      message: stepPrompt,
      history: [
        ...(input.history ?? []),
        { role: "user", content: message },
        { role: "assistant", content: loopReply },
      ],
      tasks: loopDashboard.tasks,
      currentBestTask: loopDashboard.currentBestTask,
      reviewTasks: loopDashboard.reviewTasks,
      waitingTasks: loopDashboard.waitingTasks,
      dueWaitingTasks: loopDashboard.dueWaitingTasks,
      courseContext: loopCourseContext,
      skill,
      toolCatalog,
      loadedDataSummary: buildLoadedDataSummary(skill, loopDashboard, loopCourseContext),
      context: input.context,
    });

    if (!nextAiPlan) {
      if (trace.length > 0) {
        trace[trace.length - 1] = {
          ...trace[trace.length - 1],
          stopReason: "no_followup_plan",
        };
      }
      break;
    }

    latestPlanned = {
      ...nextAiPlan,
      referencedTaskIds: nextAiPlan.actions.flatMap((action) => ("taskId" in action ? [action.taskId] : [])),
      pendingAction: null,
      clarifyState: null,
    };
    loopReply = nextAiPlan.reply;
  }

  const changedTaskIds = [
    ...new Set(
      latestPlanned.actions.flatMap((action) => ("taskId" in action ? [action.taskId] : [] as string[])).concat(actionResults.map((item) => item.taskId).filter(Boolean)),
    ),
  ];

  return {
    reply: loopReply,
    actionResults,
    mode: planned === localPlan ? "local" : "ai",
    changedTaskIds,
    referencedTaskIds,
    pendingAction: latestPlanned.pendingAction ?? null,
    clarifyState: latestPlanned.clarifyState ?? null,
    trace,
    undoAction:
      undoOperations.length > 0
        ? {
            type: "undo_actions",
            actions: undoOperations,
            summary: `可撤销 ${undoOperations.length} 项变更`,
          }
        : null,
  };
}

export function resolveLocalAssistantPlanForTest(input: {
  message: string;
  tasks: Array<Pick<DashboardTask, "id" | "title" | "status" | "deadline" | "submitTo" | "submitChannel" | "needsHumanReview" | "waitingReasonType" | "waitingReasonText" | "waitingFor" | "nextCheckAt" | "nextActionSuggestion" | "priorityReason" | "priorityScore">>;
  currentBestTask: Pick<DashboardTask, "id" | "title" | "status" | "deadline" | "submitTo" | "submitChannel" | "needsHumanReview" | "waitingReasonType" | "waitingReasonText" | "waitingFor" | "nextCheckAt" | "nextActionSuggestion" | "priorityReason" | "priorityScore"> | null;
  topTasksForToday: Array<Pick<DashboardTask, "id" | "title" | "status" | "deadline" | "submitTo" | "submitChannel" | "needsHumanReview" | "waitingReasonType" | "waitingReasonText" | "waitingFor" | "nextCheckAt" | "nextActionSuggestion" | "priorityReason" | "priorityScore">>;
  reviewTasks: Array<Pick<DashboardTask, "id" | "title" | "status" | "deadline" | "submitTo" | "submitChannel" | "needsHumanReview" | "waitingReasonType" | "waitingReasonText" | "waitingFor" | "nextCheckAt" | "nextActionSuggestion" | "priorityReason" | "priorityScore">>;
  waitingTasks: Array<Pick<DashboardTask, "id" | "title" | "status" | "deadline" | "submitTo" | "submitChannel" | "needsHumanReview" | "waitingReasonType" | "waitingReasonText" | "waitingFor" | "nextCheckAt" | "nextActionSuggestion" | "priorityReason" | "priorityScore">>;
  dueWaitingTasks: Array<Pick<DashboardTask, "id" | "title" | "status" | "deadline" | "submitTo" | "submitChannel" | "needsHumanReview" | "waitingReasonType" | "waitingReasonText" | "waitingFor" | "nextCheckAt" | "nextActionSuggestion" | "priorityReason" | "priorityScore">>;
  courseContext?: {
    todayCourseSummary: string;
    todayFreeWindowSummary: string;
  };
  policy?: Partial<AssistantStrategyPolicy>;
  context?: AssistantConversationContext;
}) {
  const policy: AssistantStrategyPolicy = {
    autoSelectCurrentBestTaskOnArrange: input.policy?.autoSelectCurrentBestTaskOnArrange ?? true,
    autoSelectCurrentBestTaskOnStatus: input.policy?.autoSelectCurrentBestTaskOnStatus ?? true,
    maxClarifyTurns: input.policy?.maxClarifyTurns ?? 1,
  };
  return buildLocalPlan({
    message: input.message,
    tasks: input.tasks as DashboardTask[],
    currentBestTask: input.currentBestTask as DashboardTask | null,
    topTasksForToday: input.topTasksForToday as DashboardTask[],
    reviewTasks: input.reviewTasks as DashboardTask[],
    waitingTasks: input.waitingTasks as DashboardTask[],
    dueWaitingTasks: input.dueWaitingTasks as DashboardTask[],
    courseContext: input.courseContext
      ? {
          todayCourses: [],
          todayCourseSummary: input.courseContext.todayCourseSummary,
          todayFreeWindowSummary: input.courseContext.todayFreeWindowSummary,
        }
      : undefined,
    policy,
    context: input.context,
  });
}
