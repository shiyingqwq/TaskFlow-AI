import dayjs from "dayjs";

import { type ActionLog, type Task } from "@/generated/prisma/client";
import { APP_TIMEZONE } from "@/lib/constants";
import { formatDeadline, toTaipei } from "@/lib/time";
import { prisma } from "@/lib/server/db";
import { getBlockingPredecessorTitles, isTaskBlockedByPredecessor } from "@/lib/task-blocking";
import { describeWaitingReason } from "@/lib/waiting";

export type DailyLogMode = "brief" | "full";

type LogTask = Pick<
  Task,
  | "id"
  | "title"
  | "status"
  | "priorityScore"
  | "deadline"
  | "nextActionSuggestion"
  | "waitingFor"
  | "waitingReasonType"
  | "waitingReasonText"
  | "nextCheckAt"
  | "needsHumanReview"
>;

type DailyAction = ActionLog & {
  task: LogTask | null;
};

type DailyTaskWithBlocking = LogTask & {
  predecessorLinks: Array<{
    predecessorTask?: {
      title: string;
      status: Task["status"];
    } | null;
  }>;
};

function toDateRange(date: string) {
  const base = dayjs.tz(date, "YYYY-MM-DD", APP_TIMEZONE);
  return {
    base,
    start: base.startOf("day").toDate(),
    end: base.endOf("day").toDate(),
  };
}

function dedupeActions(actions: DailyAction[]) {
  const latestByKey = new Map<string, DailyAction>();
  for (const action of actions) {
    const key = `${action.taskId}:${action.actionType}`;
    const prev = latestByKey.get(key);
    if (!prev || new Date(prev.createdAt).getTime() < new Date(action.createdAt).getTime()) {
      latestByKey.set(key, action);
    }
  }
  return [...latestByKey.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function actionLabel(actionType: ActionLog["actionType"]) {
  if (actionType === "created") {
    return "新增";
  }
  if (actionType === "status_changed") {
    return "状态更新";
  }
  if (actionType === "edited") {
    return "推进";
  }
  if (actionType === "ignored") {
    return "已忽略";
  }
  if (actionType === "seeded") {
    return "导入";
  }
  return "解析";
}

function buildMainline(actions: DailyAction[]) {
  const withTask = actions.filter((item) => item.task);
  const topTitles = withTask.slice(0, 2).map((item) => item.task!.title);
  if (topTitles.length === 0) {
    return "今天以任务巡检与维护为主，未记录到明确推进动作。";
  }
  return `今天主线围绕 ${topTitles.join("、")} 推进，核心目标是减少临期与阻塞项。`;
}

function formatActionLine(action: DailyAction) {
  const task = action.task;
  if (!task) {
    return `- ${actionLabel(action.actionType)}：任务记录已不存在`;
  }
  return `- ${actionLabel(action.actionType)}｜${task.title}｜状态 ${task.status}｜下一步 ${task.nextActionSuggestion}`;
}

function formatWaitingOrBlockedLine(task: DailyTaskWithBlocking) {
  const blockingTitles = getBlockingPredecessorTitles(task);
  if (blockingTitles.length > 0 && isTaskBlockedByPredecessor(task)) {
    return `- ${task.title}｜被阻塞：先完成 ${blockingTitles.join("、")}`;
  }
  if (task.status === "waiting") {
    return `- ${task.title}｜等待中：${describeWaitingReason(task) || "等待外部反馈"}`;
  }
  return `- ${task.title}｜待确认关键字段后再推进`;
}

function formatRiskLine(task: LogTask) {
  return `- ${task.title}｜截止 ${formatDeadline(task.deadline)}｜当前 ${task.status}`;
}

function formatPlanLine(task: DailyTaskWithBlocking) {
  return `- ${task.title}（分数 ${task.priorityScore}）｜下一步：${task.nextActionSuggestion}`;
}

function buildEmptyLog(base: dayjs.Dayjs) {
  const dateLabel = base.format("YYYY年M月D日 dddd");
  const text = [
    `【工作日志】${dateLabel}`,
    "",
    "1. 今日主线",
    "- 今日无关键执行项，已完成例行巡检。",
    "",
    "2. 今日已推进",
    "- 暂无记录。",
    "",
    "3. 等待与阻塞",
    "- 暂无需要特别说明的等待/阻塞项。",
    "",
    "4. 明日计划",
    "- 按优先级复核任务列表，确认明日必须推进项。",
  ].join("\n");

  return {
    text,
    meta: {
      actionCount: 0,
      touchedTaskCount: 0,
      riskCount: 0,
      waitingOrBlockedCount: 0,
    },
  };
}

export async function generateDailyLog(input: { date: string; mode: DailyLogMode }) {
  const { base, start, end } = toDateRange(input.date);
  const actions = await prisma.actionLog.findMany({
    where: {
      createdAt: {
        gte: start,
        lte: end,
      },
    },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          priorityScore: true,
          deadline: true,
          nextActionSuggestion: true,
          waitingFor: true,
          waitingReasonType: true,
          waitingReasonText: true,
          nextCheckAt: true,
          needsHumanReview: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const dedupedActions = dedupeActions(actions as DailyAction[]);

  const allTasks = (await prisma.task.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      priorityScore: true,
      deadline: true,
      nextActionSuggestion: true,
      waitingFor: true,
      waitingReasonType: true,
      waitingReasonText: true,
      nextCheckAt: true,
      needsHumanReview: true,
      predecessorLinks: {
        include: {
          predecessorTask: {
            select: {
              title: true,
              status: true,
            },
          },
        },
      },
    },
    orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
  })) as DailyTaskWithBlocking[];

  const waitingOrBlocked = allTasks
    .filter((task) => task.needsHumanReview || task.status === "waiting" || isTaskBlockedByPredecessor(task))
    .slice(0, input.mode === "brief" ? 3 : 5);

  const riskDeadlineEnd = base.add(1, "day").endOf("day");
  const riskTasks = allTasks
    .filter((task) => !["done", "submitted", "ignored"].includes(task.status))
    .filter((task) => {
      const deadline = toTaipei(task.deadline);
      return Boolean(deadline && !deadline.isAfter(riskDeadlineEnd));
    })
    .slice(0, input.mode === "brief" ? 2 : 3);

  const tomorrowPlans = allTasks
    .filter((task) => !["done", "submitted", "ignored", "waiting"].includes(task.status))
    .filter((task) => !task.needsHumanReview && !isTaskBlockedByPredecessor(task))
    .slice(0, input.mode === "brief" ? 2 : 3);

  if (dedupedActions.length === 0 && waitingOrBlocked.length === 0 && riskTasks.length === 0) {
    return buildEmptyLog(base);
  }

  const dateLabel = base.format("YYYY年M月D日 dddd");
  const actionLines = dedupedActions
    .slice(0, input.mode === "brief" ? 4 : 6)
    .map(formatActionLine);
  const waitingLines = waitingOrBlocked.map(formatWaitingOrBlockedLine);
  const riskLines = riskTasks.map(formatRiskLine);
  const planLines = tomorrowPlans.map(formatPlanLine);

  const lines = [
    `【工作日志】${dateLabel}`,
    "",
    "1. 今日主线",
    `- ${buildMainline(dedupedActions)}`,
    "",
    "2. 今日已推进",
    ...(actionLines.length > 0 ? actionLines : ["- 今日暂无可归档推进动作。"]),
    "",
    "3. 等待与阻塞",
    ...(waitingLines.length > 0 ? waitingLines : ["- 暂无需要特别说明的等待/阻塞项。"]),
    "",
    "4. 风险提醒",
    ...(riskLines.length > 0 ? riskLines : ["- 近 48 小时暂无硬截止风险。"]),
    "",
    "5. 明日计划",
    ...(planLines.length > 0 ? planLines : ["- 先清理待确认字段，再推进最高优先级任务。"]),
    "",
    "（由系统记录自动生成，可按实际情况微调后发送）",
  ];

  const touchedTaskCount = new Set(dedupedActions.map((item) => item.taskId)).size;
  return {
    text: lines.join("\n"),
    meta: {
      actionCount: dedupedActions.length,
      touchedTaskCount,
      riskCount: riskTasks.length,
      waitingOrBlockedCount: waitingOrBlocked.length,
    },
  };
}

