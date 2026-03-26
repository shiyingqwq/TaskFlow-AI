import { z } from "zod";

import type { TaskStatus } from "@/generated/prisma/enums";
import { statusLabels } from "@/lib/constants";
import type { AssistantSkill } from "@/lib/home-assistant-skills";
import { formatDeadline, nowInTaipei } from "@/lib/time";

export type HomeAssistantCatalogToolName =
  | "get_current_time"
  | "get_current_best_task"
  | "get_review_queue_summary"
  | "get_waiting_tasks_summary"
  | "get_tasks_overview"
  | "get_active_tasks"
  | "get_today_courses"
  | "get_today_free_windows"
  | "get_today_schedule_summary"
  | "get_dashboard_tasks"
  | "update_status"
  | "update_task_core"
  | "record_progress"
  | "schedule_follow_up"
  | "create_task"
  | "delete_task"
  | "auto_fix_time_semantics"
  | "resolve_review"
  | "read_daily_log_snapshot"
  | "generate_daily_log"
  | "polish_daily_log";

export type HomeAssistantSummaryToolName =
  | "get_current_time"
  | "get_current_best_task"
  | "get_review_queue_summary"
  | "get_waiting_tasks_summary"
  | "get_tasks_overview"
  | "get_active_tasks"
  | "get_today_courses"
  | "get_today_free_windows"
  | "get_today_schedule_summary";

export type HomeAssistantToolTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priorityReason: string;
  nextActionSuggestion: string;
  deadline: Date | null;
};

export type HomeAssistantCourseContext = {
  todayCourseSummary: string;
  todayFreeWindowSummary: string;
  todayArrangementSummary?: string;
};

export type HomeAssistantSummaryContext = {
  message: string;
  currentBestTask: HomeAssistantToolTask | null;
  topTasksForToday: HomeAssistantToolTask[];
  reviewTasks: HomeAssistantToolTask[];
  waitingTasks: HomeAssistantToolTask[];
  dueWaitingTasks: HomeAssistantToolTask[];
  tasks: HomeAssistantToolTask[];
  courseContext?: HomeAssistantCourseContext;
};

type SummaryToolResult = {
  reply: string;
  result?: string;
};

type SummaryToolDefinition<TInput> = {
  name: HomeAssistantSummaryToolName;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput, context: HomeAssistantSummaryContext) => SummaryToolResult;
};

type CatalogToolDefinition = {
  name: HomeAssistantCatalogToolName;
  description: string;
  inputSchema: z.ZodTypeAny;
};

const getCurrentTimeInputSchema = z.object({}).strict();
const getCurrentBestTaskInputSchema = z.object({}).strict();
const getReviewQueueSummaryInputSchema = z.object({
  limit: z.number().int().min(1).max(10).default(3),
});
const getWaitingTasksSummaryInputSchema = z.object({
  limit: z.number().int().min(1).max(10).default(3),
});
const getTasksOverviewInputSchema = z.object({
  limit: z.number().int().min(1).max(10).default(5),
});
const getActiveTasksInputSchema = z.object({
  limit: z.number().int().min(1).max(10).default(5),
});
const getTodayCoursesInputSchema = z.object({}).strict();
const getTodayFreeWindowsInputSchema = z.object({}).strict();
const getTodayScheduleSummaryInputSchema = z.object({}).strict();

function splitPriorityReasons(reason: string) {
  return reason
    .split(/[；;。]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildNaturalBestTaskReply(task: HomeAssistantToolTask) {
  const deadlineLabel = formatDeadline(task.deadline);
  const reasonParts = splitPriorityReasons(task.priorityReason)
    .filter((item) => !item.startsWith("存在明确下一步"))
    .slice(0, 2);
  const reasonLine = reasonParts.length > 0 ? `优先原因：${reasonParts.join("；")}。` : "";
  const deadlineLine =
    deadlineLabel === "未明确"
      ? "这条任务还没有明确截止，先推进到一个可交付的小结果最稳妥。"
      : `时间上先盯住 ${deadlineLabel}。`;

  return `先做「${task.title}」。${deadlineLine}${reasonLine}下一步就做：${task.nextActionSuggestion}`;
}

const summaryToolRegistry: Record<HomeAssistantSummaryToolName, SummaryToolDefinition<any>> = {
  get_current_time: {
    name: "get_current_time",
    description: "读取当前时间与日期（Asia/Shanghai）。",
    inputSchema: getCurrentTimeInputSchema,
    execute: () => {
      const now = nowInTaipei();
      return {
        reply: `当前时间是 ${now.format("YYYY-MM-DD HH:mm")}（${now.format("dddd")}，Asia/Shanghai）。`,
        result: now.toISOString(),
      };
    },
  },
  get_current_best_task: {
    name: "get_current_best_task",
    description: "总结当前最该推进的一条任务。",
    inputSchema: getCurrentBestTaskInputSchema,
    execute: (_input, context) => {
      if (!context.currentBestTask) {
        return { reply: "当前没有明确需要立刻推进的任务。" };
      }
      return {
        reply: buildNaturalBestTaskReply(context.currentBestTask),
      };
    },
  },
  get_review_queue_summary: {
    name: "get_review_queue_summary",
    description: "汇总待确认任务队列。",
    inputSchema: getReviewQueueSummaryInputSchema,
    execute: (input, context) => {
      if (context.reviewTasks.length === 0) {
        return { reply: "当前没有待确认任务。" };
      }
      return {
        reply: `当前有 ${context.reviewTasks.length} 条待确认任务，最值得先看的有：${context.reviewTasks
          .slice(0, input.limit)
          .map((task) => `「${task.title}」`)
          .join("、")}。`,
      };
    },
  },
  get_waiting_tasks_summary: {
    name: "get_waiting_tasks_summary",
    description: "汇总等待任务与优先回看项。",
    inputSchema: getWaitingTasksSummaryInputSchema,
    execute: (input, context) => {
      const focus = context.dueWaitingTasks.length > 0 ? context.dueWaitingTasks : context.waitingTasks;
      if (focus.length === 0) {
        return { reply: "当前没有需要回看的等待任务。" };
      }
      return {
        reply: `当前有 ${context.waitingTasks.length} 条等待任务，其中优先回看的有：${focus
          .slice(0, input.limit)
          .map((task) => `「${task.title}」`)
          .join("、")}。`,
      };
    },
  },
  get_tasks_overview: {
    name: "get_tasks_overview",
    description: "给出任务总览和今日推进重点。",
    inputSchema: getTasksOverviewInputSchema,
    execute: (input, context) => {
      const activeTasks = context.tasks.filter((task) => !["done", "submitted", "ignored"].includes(task.status));
      const completedCount = context.tasks.filter((task) => ["done", "submitted"].includes(task.status)).length;
      const urgentCount = context.topTasksForToday.length;
      if (activeTasks.length === 0) {
        return {
          reply: completedCount > 0 ? `当前没有活跃任务了，现有 ${completedCount} 条任务都已经处理完成。` : "当前没有活跃任务。",
        };
      }
      const top = activeTasks.slice(0, input.limit).map((task) => `「${task.title}」(${statusLabels[task.status]})`);
      return {
        reply: `当前共有 ${activeTasks.length} 条活跃任务，其中 ${context.reviewTasks.length} 条待确认、${context.waitingTasks.length} 条等待中、${urgentCount} 条今天建议优先推进。当前排在前面的有：${top.join("、")}。`,
      };
    },
  },
  get_active_tasks: {
    name: "get_active_tasks",
    description: "列出当前活跃任务。",
    inputSchema: getActiveTasksInputSchema,
    execute: (input, context) => {
      const activeTasks = context.tasks.filter((task) => !["done", "submitted", "ignored"].includes(task.status));
      const completedCount = context.tasks.filter((task) => ["done", "submitted"].includes(task.status)).length;
      if (activeTasks.length === 0) {
        return {
          reply: completedCount > 0 ? `当前没有活跃任务了，现有 ${completedCount} 条任务都已经处理完成。` : "当前没有活跃任务。",
        };
      }
      return {
        reply: `当前还有 ${activeTasks.length} 条活跃任务：${activeTasks
          .slice(0, input.limit)
          .map((task) => `「${task.title}」(${statusLabels[task.status]})`)
          .join("、")}。`,
      };
    },
  },
  get_today_courses: {
    name: "get_today_courses",
    description: "读取今日课程与空档摘要。",
    inputSchema: getTodayCoursesInputSchema,
    execute: (_input, context) => {
      if (!context.courseContext) {
        return { reply: "当前没有读到课表配置。你可以先在设置里录入课程表。" };
      }
      return {
        reply: `今天课程：${context.courseContext.todayCourseSummary} 可执行空档：${context.courseContext.todayFreeWindowSummary}。`,
      };
    },
  },
  get_today_free_windows: {
    name: "get_today_free_windows",
    description: "读取今日课表空档。",
    inputSchema: getTodayFreeWindowsInputSchema,
    execute: (_input, context) => {
      if (!context.courseContext) {
        return { reply: "当前没有读到课表配置，暂时无法按课程计算空档。" };
      }
      return {
        reply: `按今日课表，主要空档是：${context.courseContext.todayFreeWindowSummary}。`,
      };
    },
  },
  get_today_schedule_summary: {
    name: "get_today_schedule_summary",
    description: "读取今日日程安排摘要。",
    inputSchema: getTodayScheduleSummaryInputSchema,
    execute: (_input, context) => {
      if (!context.courseContext?.todayArrangementSummary) {
        return { reply: "当前还没有可读的今日日程安排数据。" };
      }
      return {
        reply: `当前今日日程安排：${context.courseContext.todayArrangementSummary}。`,
      };
    },
  },
};

const catalogToolRegistry: Record<HomeAssistantCatalogToolName, CatalogToolDefinition> = {
  ...summaryToolRegistry,
  get_dashboard_tasks: {
    name: "get_dashboard_tasks",
    description: "读取任务看板数据。",
    inputSchema: z.object({
      scope: z.enum(["all", "today"]).default("all"),
    }),
  },
  update_status: {
    name: "update_status",
    description: "更新任务状态。",
    inputSchema: z.object({
      taskId: z.string().min(1),
      status: z.enum(["needs_review", "ready", "waiting", "in_progress", "pending_submit", "submitted", "done", "overdue", "ignored"]),
      note: z.string().optional(),
    }),
  },
  update_task_core: {
    name: "update_task_core",
    description: "更新任务核心字段（时间/状态/说明等）。",
    inputSchema: z.object({
      taskId: z.string().min(1),
      patch: z.record(z.string(), z.any()).refine((value) => Object.keys(value).length > 0, { message: "patch cannot be empty" }),
    }),
  },
  record_progress: {
    name: "record_progress",
    description: "记录任务进度。",
    inputSchema: z.object({
      taskId: z.string().min(1),
      mode: z.enum(["increment", "decrement", "reset"]),
    }),
  },
  schedule_follow_up: {
    name: "schedule_follow_up",
    description: "为等待任务安排回看时间。",
    inputSchema: z.object({
      taskId: z.string().min(1),
      preset: z.enum(["tonight", "tomorrow", "next_week"]),
      note: z.string().optional(),
    }),
  },
  create_task: {
    name: "create_task",
    description: "创建新任务。",
    inputSchema: z.object({
      sourceText: z.string().min(1),
    }),
  },
  delete_task: {
    name: "delete_task",
    description: "删除任务。",
    inputSchema: z.object({
      taskId: z.string().min(1),
    }),
  },
  auto_fix_time_semantics: {
    name: "auto_fix_time_semantics",
    description: "自动修复任务时间语义冲突。",
    inputSchema: z.object({}).strict(),
  },
  resolve_review: {
    name: "resolve_review",
    description: "确认并解除任务的待确认状态。",
    inputSchema: z.object({
      taskId: z.string().min(1),
      note: z.string().optional(),
    }),
  },
  read_daily_log_snapshot: {
    name: "read_daily_log_snapshot",
    description: "读取日报快照。",
    inputSchema: z.object({
      date: z.string().optional(),
    }),
  },
  generate_daily_log: {
    name: "generate_daily_log",
    description: "生成日报内容。",
    inputSchema: z.object({
      mode: z.enum(["brief", "full"]).default("brief"),
    }),
  },
  polish_daily_log: {
    name: "polish_daily_log",
    description: "润色日报内容。",
    inputSchema: z.object({
      text: z.string().min(1),
      style: z.enum(["formal", "casual"]).default("formal"),
    }),
  },
};

const skillToolNameMap: Record<AssistantSkill, HomeAssistantCatalogToolName[]> = {
  course_reader: ["get_today_courses", "get_today_free_windows"],
  schedule_ops: ["get_today_schedule_summary", "update_task_core", "get_today_courses"],
  task_ops: ["get_dashboard_tasks", "update_status", "update_task_core", "record_progress", "schedule_follow_up", "create_task", "delete_task"],
  time_reader: ["get_current_time"],
  daily_log: ["read_daily_log_snapshot", "generate_daily_log", "polish_daily_log"],
  general: ["get_dashboard_tasks", "get_today_schedule_summary", "get_today_courses"],
};

const skillCatalogDisplayMap: Partial<Record<AssistantSkill, Partial<Record<HomeAssistantCatalogToolName, string>>>> = {
  schedule_ops: {
    update_task_core: "update_task_core(startAtISO/estimatedMinutes/snoozeUntilISO/status)",
  },
};

function looksLikeMutation(message: string) {
  return (
    /(?:新增|添加|创建|加|记).*(任务|待办)/.test(message) ||
    /(安排到|排到|标记为|改成|设为|更新|修改|调到|放到|删除|删掉|移除)/.test(message)
  );
}

export function getHomeAssistantToolDefinition(name: HomeAssistantCatalogToolName) {
  return catalogToolRegistry[name];
}

export function getHomeAssistantToolInputSchema(name: HomeAssistantCatalogToolName) {
  return catalogToolRegistry[name].inputSchema;
}

export function getSkillToolCatalog(skill: AssistantSkill) {
  const names = skillToolNameMap[skill] ?? [];
  const displayMap = skillCatalogDisplayMap[skill] ?? {};
  return names.map((name) => displayMap[name] ?? name);
}

export function executeHomeAssistantSummaryTool(args: {
  tool: HomeAssistantSummaryToolName;
  input: unknown;
  context: HomeAssistantSummaryContext;
}) {
  const definition = summaryToolRegistry[args.tool];
  const input = definition.inputSchema.parse(args.input);
  return definition.execute(input, args.context);
}

export function resolveSummaryToolFromMessage(context: HomeAssistantSummaryContext): { tool: HomeAssistantSummaryToolName; reply: string } | null {
  const { message } = context;
  const isMutation = looksLikeMutation(message);

  if (
    !isMutation &&
    (
      /(现在几点|现在几?点钟|当前时间|现在时间|今天几号|今天几月几号|今天星期几|今天周几|今天是几号)/.test(message) ||
      /(?:能|可以|可否).*(?:读取|告诉我|查看).*(?:现在|当前).*(?:时间|几点|日期|星期)/.test(message) ||
      /(?:现在|当前|此刻|目前).*(?:时间|几点|日期|星期|周几)/.test(message)
    )
  ) {
    const result = executeHomeAssistantSummaryTool({ tool: "get_current_time", input: {}, context });
    return { tool: "get_current_time", reply: result.reply };
  }

  if (/现在最该做|最紧急|先做什么|该做什么|今天必须推进/.test(message)) {
    const result = executeHomeAssistantSummaryTool({ tool: "get_current_best_task", input: {}, context });
    return { tool: "get_current_best_task", reply: result.reply };
  }

  if (!isMutation && /待确认|确认队列|需要确认/.test(message)) {
    const result = executeHomeAssistantSummaryTool({ tool: "get_review_queue_summary", input: { limit: 3 }, context });
    return { tool: "get_review_queue_summary", reply: result.reply };
  }

  if (!isMutation && /回看|等待任务|等待中/.test(message)) {
    const result = executeHomeAssistantSummaryTool({ tool: "get_waiting_tasks_summary", input: { limit: 3 }, context });
    return { tool: "get_waiting_tasks_summary", reply: result.reply };
  }

  if (/全部任务|有哪些任务|总结一下任务|任务总览/.test(message)) {
    const result = executeHomeAssistantSummaryTool({ tool: "get_tasks_overview", input: { limit: 5 }, context });
    return { tool: "get_tasks_overview", reply: result.reply };
  }

  if (/现在我有哪些任务|我有哪些任务/.test(message)) {
    const result = executeHomeAssistantSummaryTool({ tool: "get_active_tasks", input: { limit: 5 }, context });
    return { tool: "get_active_tasks", reply: result.reply };
  }

  if (!isMutation && /(今天|今日).*(课表|课程)|课表.*(今天|今日)|今天有什么课/.test(message)) {
    const result = executeHomeAssistantSummaryTool({ tool: "get_today_courses", input: {}, context });
    return { tool: "get_today_courses", reply: result.reply };
  }

  if (!isMutation && /(空档|空闲|什么时候有空|有空时间)/.test(message)) {
    const result = executeHomeAssistantSummaryTool({ tool: "get_today_free_windows", input: {}, context });
    return { tool: "get_today_free_windows", reply: result.reply };
  }

  if (!isMutation && /(今日日程安排|今天安排|读取安排数据|安排数据|排版数据|今天怎么排)/.test(message)) {
    const result = executeHomeAssistantSummaryTool({ tool: "get_today_schedule_summary", input: {}, context });
    return { tool: "get_today_schedule_summary", reply: result.reply };
  }

  return null;
}
