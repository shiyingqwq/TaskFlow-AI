import dayjs from "dayjs";

import { type ActionLog, type Task } from "@/generated/prisma/client";
import { APP_TIMEZONE } from "@/lib/constants";
import { formatDeadline, toTaipei } from "@/lib/time";
import { prisma } from "@/lib/server/db";
import { getBlockingPredecessorTitles, isTaskBlockedByPredecessor } from "@/lib/task-blocking";
import { describeWaitingReason } from "@/lib/waiting";

export type DailyLogMode = "brief" | "full";
type DailyLogSource = "saved" | "generated";

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

type DailyLogSnapshot = {
  dateKey: string;
  mode: DailyLogMode;
  text: string;
  meta: {
    actionCount: number;
    touchedTaskCount: number;
    riskCount: number;
    waitingOrBlockedCount: number;
  };
  updatedAt: string;
};

let dailyLogTableReady = false;

async function ensureDailyLogTable() {
  if (dailyLogTableReady) {
    return;
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS DailyLogSnapshot (
      id TEXT PRIMARY KEY,
      dateKey TEXT NOT NULL,
      mode TEXT NOT NULL,
      text TEXT NOT NULL,
      metaJson TEXT NOT NULL DEFAULT '{}',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS DailyLogSnapshot_date_mode_unique
    ON DailyLogSnapshot (dateKey, mode)
  `);

  dailyLogTableReady = true;
}

function normalizeMetaJson(value: unknown): DailyLogSnapshot["meta"] {
  if (!value || typeof value !== "string") {
    return {
      actionCount: 0,
      touchedTaskCount: 0,
      riskCount: 0,
      waitingOrBlockedCount: 0,
    };
  }

  try {
    const parsed = JSON.parse(value) as Partial<DailyLogSnapshot["meta"]>;
    return {
      actionCount: Number(parsed.actionCount ?? 0),
      touchedTaskCount: Number(parsed.touchedTaskCount ?? 0),
      riskCount: Number(parsed.riskCount ?? 0),
      waitingOrBlockedCount: Number(parsed.waitingOrBlockedCount ?? 0),
    };
  } catch {
    return {
      actionCount: 0,
      touchedTaskCount: 0,
      riskCount: 0,
      waitingOrBlockedCount: 0,
    };
  }
}

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

export async function getDailyLogSnapshot(input: { date: string; mode: DailyLogMode }) {
  await ensureDailyLogTable();
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT dateKey, mode, text, metaJson, updatedAt
      FROM DailyLogSnapshot
      WHERE dateKey = ? AND mode = ?
      LIMIT 1
    `,
    input.date,
    input.mode,
  )) as Array<{
    dateKey: string;
    mode: DailyLogMode;
    text: string;
    metaJson: string;
    updatedAt: string;
  }>;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    dateKey: row.dateKey,
    mode: row.mode,
    text: row.text,
    meta: normalizeMetaJson(row.metaJson),
    updatedAt: row.updatedAt,
  } as DailyLogSnapshot;
}

export async function saveDailyLogSnapshot(input: {
  date: string;
  mode: DailyLogMode;
  text: string;
  meta: DailyLogSnapshot["meta"];
}) {
  await ensureDailyLogTable();
  const nowIso = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO DailyLogSnapshot (id, dateKey, mode, text, metaJson, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dateKey, mode) DO UPDATE SET
        text = excluded.text,
        metaJson = excluded.metaJson,
        updatedAt = excluded.updatedAt
    `,
    `${input.date}:${input.mode}`,
    input.date,
    input.mode,
    input.text,
    JSON.stringify(input.meta),
    nowIso,
    nowIso,
  );

  return getDailyLogSnapshot({ date: input.date, mode: input.mode });
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

export async function getOrGenerateDailyLog(input: { date: string; mode: DailyLogMode; refresh?: boolean }) {
  if (!input.refresh) {
    const saved = await getDailyLogSnapshot({ date: input.date, mode: input.mode });
    if (saved) {
      return {
        text: saved.text,
        meta: saved.meta,
        source: "saved" as DailyLogSource,
      };
    }
  }

  const generated = await generateDailyLog({ date: input.date, mode: input.mode });
  await saveDailyLogSnapshot({
    date: input.date,
    mode: input.mode,
    text: generated.text,
    meta: generated.meta,
  });

  return {
    ...generated,
    source: "generated" as DailyLogSource,
  };
}
