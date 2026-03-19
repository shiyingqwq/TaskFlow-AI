import OpenAI from "openai";
import { z } from "zod";

import type { TaskStatus } from "@/generated/prisma/enums";
import { statusLabels } from "@/lib/constants";
import { getAiRuntimeConfig } from "@/lib/server/app-settings";
import {
  createAssistantTask,
  getDashboardData,
  recordTaskProgress,
  resetTaskProgressCycle,
  resolveTaskReview,
  scheduleTaskFollowUp,
  undoTaskProgress,
  updateTaskStatus,
} from "@/lib/server/tasks";
import { formatDeadline } from "@/lib/time";
import { describeWaitingReason, type WaitingFollowUpPreset } from "@/lib/waiting";

export type AssistantHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantConversationContext = {
  lastReferencedTaskId?: string | null;
  pendingAction?: AssistantPendingAction | null;
};

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

const assistantResponseSchema = z.object({
  reply: z.string().min(1),
  actions: z.array(z.union([statusActionSchema, reviewActionSchema, followUpActionSchema, progressActionSchema, createTaskActionSchema])).default([]),
});

type AssistantPlannedAction = z.infer<typeof assistantResponseSchema>["actions"][number];
export type AssistantPendingAction = AssistantPlannedAction;

type AssistantResult = {
  reply: string;
  actionResults: Array<{
    taskId: string;
    taskTitle: string;
    summary: string;
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
};

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
) {
  if (/现在最该做|最紧急|先做什么|该做什么|今天必须推进/.test(message)) {
    if (!currentBestTask) {
      return "当前没有明确需要立刻推进的任务。";
    }

    return `现在最该做的是「${currentBestTask.title}」。截止 ${formatDeadline(currentBestTask.deadline)}，原因是：${currentBestTask.priorityReason}。下一步建议：${currentBestTask.nextActionSuggestion}`;
  }

  if (/待确认|确认队列|需要确认/.test(message)) {
    if (reviewTasks.length === 0) {
      return "当前没有待确认任务。";
    }

    return `当前有 ${reviewTasks.length} 条待确认任务，最值得先看的有：${reviewTasks
      .slice(0, 3)
      .map((task) => `「${task.title}」`)
      .join("、")}。`;
  }

  if (/回看|等待任务|等待中/.test(message)) {
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

function getPendingActionTaskId(action: AssistantPendingAction | null | undefined) {
  if (!action || !("taskId" in action)) {
    return null;
  }

  return action.taskId;
}

function describePendingAction(action: AssistantPendingAction, taskMap: Map<string, DashboardTask>) {
  if (action.type === "create_task") {
    return `是否新增这条任务：${action.sourceText}？`;
  }

  const task = taskMap.get(action.taskId);
  if (!task) {
    return "这条待执行动作对应的任务已经找不到了。";
  }

  if (action.type === "update_status") {
    return `是否将「${task.title}」标记为${statusLabels[action.status]}？`;
  }

  if (action.type === "resolve_review") {
    return `是否确认「${task.title}」的解析结果无误？`;
  }

  if (action.type === "schedule_follow_up") {
    const label = action.preset === "tonight" ? "今晚" : action.preset === "tomorrow" ? "明天" : "下周";
    return `是否将「${task.title}」设为${label}再回看？`;
  }

  if (action.mode === "increment") {
    return `是否给「${task.title}」记录 1 次进度？`;
  }

  if (action.mode === "decrement") {
    return `是否给「${task.title}」撤回 1 次进度？`;
  }

  return `是否重置「${task.title}」当前这一轮进度？`;
}

function buildLocalPlan(input: {
  message: string;
  tasks: DashboardTask[];
  currentBestTask: DashboardTask | null;
  topTasksForToday: DashboardTask[];
  reviewTasks: DashboardTask[];
  waitingTasks: DashboardTask[];
  dueWaitingTasks: DashboardTask[];
  context?: AssistantConversationContext;
}): { reply: string; actions: AssistantPlannedAction[]; referencedTaskIds: string[]; pendingAction?: AssistantPendingAction | null } | null {
  const { message, tasks, currentBestTask, topTasksForToday, reviewTasks, waitingTasks, dueWaitingTasks, context } = input;
  const taskMap = new Map(tasks.map((task) => [task.id, task]));

  if (context?.pendingAction) {
    if (/^(确认|确认执行|是的|是|好的|好|行|可以|就这样|执行)$/u.test(message)) {
      return {
        reply: "已确认，我现在执行这条动作。",
        actions: [context.pendingAction],
        referencedTaskIds: getPendingActionTaskId(context.pendingAction) ? [getPendingActionTaskId(context.pendingAction)!] : [],
        pendingAction: null,
      };
    }

    if (/^(取消|不用了|先不了|算了|撤销这次操作)$/u.test(message)) {
      return {
        reply: "这条待执行动作已取消，没有改动任务。",
        actions: [],
        referencedTaskIds: getPendingActionTaskId(context.pendingAction) ? [getPendingActionTaskId(context.pendingAction)!] : [],
        pendingAction: null,
      };
    }
  }

  const summaryReply = buildLocalSummary(message, currentBestTask, topTasksForToday, reviewTasks, waitingTasks, dueWaitingTasks, tasks);
  if (summaryReply) {
    return {
      reply: summaryReply,
      actions: [] as AssistantPlannedAction[],
      referencedTaskIds: collectReferencedTaskIds(summaryReply, [], currentBestTask),
      pendingAction: context?.pendingAction ?? null,
    };
  }

  const picked = pickTaskFromMessage(tasks, message, currentBestTask, reviewTasks, waitingTasks, context?.lastReferencedTaskId);
  if (picked.ambiguous) {
    return {
      reply: "我能看出你要改某条任务，但当前匹配到不止一条。你可以再带上更完整的任务标题，或直接贴任务 id。",
      actions: [] as AssistantPlannedAction[],
      referencedTaskIds: [],
      pendingAction: context?.pendingAction ?? null,
    };
  }

  const task = picked.task;
  const createMatch = message.match(/^(?:帮我)?(?:加一个|新增|添加|创建|记一个)(?:任务|待办)?[：:\s]+(.+)$/);

  if (createMatch?.[1]) {
    const sourceText = createMatch[1].trim();
    return {
      reply: `我会新增一条任务：${sourceText}`,
      actions: [{ type: "create_task", sourceText }],
      referencedTaskIds: [],
      pendingAction: null,
    };
  }

  if (/解析没问题|确认解析|确认无误|退出待确认/.test(message)) {
    if (!task) {
      return {
        reply: "我知道你想确认解析结果，但还没定位到具体任务。请补一句任务标题。",
        actions: [] as AssistantPlannedAction[],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    const pendingAction: AssistantPendingAction = { type: "resolve_review", taskId: task.id };
    return {
      reply: describePendingAction(pendingAction, taskMap),
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

    const pendingAction: AssistantPendingAction = { type: "schedule_follow_up", taskId: task.id, preset: "tonight" };
    return {
      reply: describePendingAction(pendingAction, taskMap),
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

    const pendingAction: AssistantPendingAction = { type: "schedule_follow_up", taskId: task.id, preset: "tomorrow" };
    return {
      reply: describePendingAction(pendingAction, taskMap),
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

    const pendingAction: AssistantPendingAction = { type: "schedule_follow_up", taskId: task.id, preset: "next_week" };
    return {
      reply: describePendingAction(pendingAction, taskMap),
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

    const pendingAction: AssistantPendingAction = { type: "record_progress", taskId: task.id, mode: "reset" };
    return {
      reply: describePendingAction(pendingAction, taskMap),
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

    const pendingAction: AssistantPendingAction = { type: "record_progress", taskId: task.id, mode: "decrement" };
    return {
      reply: describePendingAction(pendingAction, taskMap),
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

    const pendingAction: AssistantPendingAction = { type: "record_progress", taskId: task.id, mode: "increment" };
    return {
      reply: describePendingAction(pendingAction, taskMap),
      actions: [],
      referencedTaskIds: [task.id],
      pendingAction,
    };
  }

  const statusMatch = statusKeywordMap.find((item) => item.pattern.test(message));
  if (statusMatch) {
    if (!task) {
      return {
        reply: "我知道你想改状态，但还没定位到具体任务。请补一句任务标题。",
        actions: [] as AssistantPlannedAction[],
        referencedTaskIds: [],
        pendingAction: null,
      };
    }

    const pendingAction: AssistantPendingAction = { type: "update_status", taskId: task.id, status: statusMatch.status, note: statusMatch.note };
    return {
      reply: describePendingAction(pendingAction, taskMap),
      actions: [],
      referencedTaskIds: [task.id],
      pendingAction,
    };
  }

  return null;
}

function buildAiSystemPrompt() {
  return `你是首页里的中文任务管理助手。你可以阅读全部任务，并帮助用户做两类事：
1. 回答任务问题，例如“现在最该做什么”“待确认里有什么”“哪些任务快到期了”。
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

规则：
1. 只有当用户明确要求修改任务时，才能填写 actions。
1.1 如果用户明确说“新增任务/加一个任务/记一个任务”，可以使用 create_task。
1.2 如果用户只是口头确认上一轮挂起动作，例如“是的/确认/可以”，请直接执行当前 pendingAction。
2. 如果任务不明确、可能有歧义、或你拿不准 taskId，就不要执行动作，只在 reply 里要求用户澄清。
3. 永远不要编造 taskId。
4. 不要输出任何 JSON 之外的说明。
5. 语气直接、简洁、会做事。`;
}

function buildAiUserPrompt(args: {
  message: string;
  history: AssistantHistoryMessage[];
  tasks: DashboardTask[];
  currentBestTask: DashboardTask | null;
  reviewTasks: DashboardTask[];
  waitingTasks: DashboardTask[];
  dueWaitingTasks: DashboardTask[];
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

全部任务列表：
${buildTaskContext(args.tasks)}

最近对话：
${historyText}

用户本轮输入：
${args.message}`;
}

async function planWithAi(args: {
  message: string;
  history: AssistantHistoryMessage[];
  tasks: DashboardTask[];
  currentBestTask: DashboardTask | null;
  reviewTasks: DashboardTask[];
  waitingTasks: DashboardTask[];
  dueWaitingTasks: DashboardTask[];
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
          content: buildAiSystemPrompt(),
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
    };
  }

  const task = taskMap.get(action.taskId);
  if (!task) {
    return null;
  }

  if (action.type === "update_status") {
    await updateTaskStatus(action.taskId, action.status, action.note);
    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已将「${task.title}」标记为${statusLabels[action.status]}`,
      createdTaskCards: [],
    };
  }

  if (action.type === "resolve_review") {
    await resolveTaskReview(action.taskId, action.note);
    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已确认「${task.title}」的解析结果`,
      createdTaskCards: [],
    };
  }

  if (action.type === "schedule_follow_up") {
    await scheduleTaskFollowUp(action.taskId, action.preset as WaitingFollowUpPreset, action.note);
    const label = action.preset === "tonight" ? "今晚" : action.preset === "tomorrow" ? "明天" : "下周";
    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已将「${task.title}」设为${label}再回看`,
      createdTaskCards: [],
    };
  }

  if (action.mode === "increment") {
    await recordTaskProgress(action.taskId);
    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已给「${task.title}」记录 1 次进度`,
      createdTaskCards: [],
    };
  }

  if (action.mode === "decrement") {
    await undoTaskProgress(action.taskId);
    return {
      taskIds: [task.id],
      taskTitle: task.title,
      summary: `已给「${task.title}」撤回 1 次进度`,
      createdTaskCards: [],
    };
  }

  await resetTaskProgressCycle(action.taskId);
  return {
    taskIds: [task.id],
    taskTitle: task.title,
    summary: `已重置「${task.title}」当前这一轮进度`,
    createdTaskCards: [],
  };
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
    context: input.context,
  });

  const planned =
    localPlan ??
    (aiPlan
      ? {
          ...aiPlan,
          referencedTaskIds: aiPlan.actions.flatMap((action) => ("taskId" in action ? [action.taskId] : [])),
        }
      : {
          reply: "我能读任务并帮你做常见管理动作。你可以试试：现在最该做什么、帮我看待确认队列、把某条任务标记为进行中。",
          actions: [] as AssistantPlannedAction[],
          referencedTaskIds: [] as string[],
          pendingAction: null,
        });

  const taskMap = new Map(dashboard.tasks.map((task) => [task.id, task]));
  const actionResults: AssistantResult["actionResults"] = [];

  for (const action of planned.actions) {
    const result = await executeAction(action, taskMap);
    if (result) {
      actionResults.push({
        taskId: result.taskIds[0] ?? "",
        taskTitle: result.taskTitle,
        summary: result.summary,
        createdTaskCards: result.createdTaskCards,
      });
    }
  }

  const changedTaskIds = [
    ...new Set(
      planned.actions.flatMap((action) => ("taskId" in action ? [action.taskId] : [] as string[])).concat(actionResults.map((item) => item.taskId).filter(Boolean)),
    ),
  ];

  return {
    reply: planned.reply,
    actionResults,
    mode: localPlan ? "local" : "ai",
    changedTaskIds,
    referencedTaskIds: [...new Set([...(planned.referencedTaskIds ?? []), ...actionResults.map((item) => item.taskId).filter(Boolean)])],
    pendingAction: planned.pendingAction ?? null,
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
  context?: AssistantConversationContext;
}) {
  return buildLocalPlan({
    message: input.message,
    tasks: input.tasks as DashboardTask[],
    currentBestTask: input.currentBestTask as DashboardTask | null,
    topTasksForToday: input.topTasksForToday as DashboardTask[],
    reviewTasks: input.reviewTasks as DashboardTask[],
    waitingTasks: input.waitingTasks as DashboardTask[],
    dueWaitingTasks: input.dueWaitingTasks as DashboardTask[],
    context: input.context,
  });
}
