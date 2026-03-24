import { prisma } from "@/lib/server/db";
import { sendDingtalkText } from "@/lib/server/dingtalk";
import { getDashboardData } from "@/lib/server/tasks";
import { formatDeadline, nowInTaipei, toTaipei } from "@/lib/time";
import { describeWaitingReason } from "@/lib/waiting";

type ReminderRunOptions = {
  dryRun?: boolean;
  atAll?: boolean;
};

type ReminderRunResult = {
  now: string;
  dryRun: boolean;
  sent: Array<{
    type: "daily_summary" | "deadline_alert" | "waiting_follow_up";
    count: number;
  }>;
  skipped: Array<{
    type: "daily_summary" | "deadline_alert" | "waiting_follow_up";
    reason: string;
  }>;
};

type ReminderTask = {
  id: string;
  title: string;
  status: string;
  deadline: Date | null;
  nextCheckAt: Date | null;
  nextActionSuggestion: string;
  waitingFor: string | null;
  waitingReasonType: string | null;
  waitingReasonText: string | null;
  priorityScore: number;
};

type ReminderDispatchRow = {
  reminderKey: string;
};

function parseDailyTime(value: string | undefined) {
  const normalized = (value ?? "08:30").trim();
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return { hour: 8, minute: 30 };
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 8, minute: 30 };
  }
  return { hour, minute };
}

function truncate(text: string, max = 48) {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function resolveDeadlineTier(hoursLeft: number) {
  if (hoursLeft <= 0) {
    return null;
  }
  if (hoursLeft <= 1) {
    return 1;
  }
  if (hoursLeft <= 3) {
    return 3;
  }
  if (hoursLeft <= 24) {
    return 24;
  }
  return null;
}

async function ensureReminderDispatchTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ReminderDispatch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reminderKey TEXT NOT NULL UNIQUE,
      reminderType TEXT NOT NULL,
      taskId TEXT,
      payload TEXT,
      sentAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function wasReminderSent(reminderKey: string) {
  const rows = await prisma.$queryRawUnsafe<ReminderDispatchRow[]>(
    `
      SELECT reminderKey
      FROM ReminderDispatch
      WHERE reminderKey = ?
      LIMIT 1
    `,
    reminderKey,
  );
  return rows.length > 0;
}

async function recordReminderSent(input: {
  reminderKey: string;
  reminderType: "daily_summary" | "deadline_alert" | "waiting_follow_up";
  taskId?: string | null;
  payload?: string;
}) {
  await prisma.$executeRawUnsafe(
    `
      INSERT OR IGNORE INTO ReminderDispatch (reminderKey, reminderType, taskId, payload)
      VALUES (?, ?, ?, ?)
    `,
    input.reminderKey,
    input.reminderType,
    input.taskId ?? null,
    input.payload ?? null,
  );
}

function buildDailySummaryText(dashboard: Awaited<ReturnType<typeof getDashboardData>>, nowLabel: string) {
  const mustDo = dashboard.todayMustDoTasks.slice(0, 3);
  const review = dashboard.reviewTasks.slice(0, 3);
  const dueWaiting = dashboard.dueWaitingTasks.slice(0, 3);

  const lines = [`【TaskFlow】今日执行摘要 ${nowLabel}`];
  lines.push("");
  lines.push("1) 今天先做");
  if (mustDo.length === 0) {
    lines.push("- 当前没有硬性今天截止任务");
  } else {
    mustDo.forEach((task, index) => {
      lines.push(`- ${index + 1}. ${truncate(task.title)}（${formatDeadline(task.deadline)}）`);
    });
  }

  lines.push("");
  lines.push("2) 待确认");
  if (review.length === 0) {
    lines.push("- 当前没有高风险待确认项");
  } else {
    review.forEach((task, index) => {
      lines.push(`- ${index + 1}. ${truncate(task.title)}`);
    });
  }

  lines.push("");
  lines.push("3) 到点回看");
  if (dueWaiting.length === 0) {
    lines.push("- 当前没有到点回看任务");
  } else {
    dueWaiting.forEach((task, index) => {
      lines.push(`- ${index + 1}. ${truncate(task.title)}（${formatDeadline(task.nextCheckAt)}）`);
    });
  }

  return lines.join("\n");
}

export async function runReminderCycle(options: ReminderRunOptions = {}): Promise<ReminderRunResult> {
  const dryRun = options.dryRun ?? false;
  const atAll = options.atAll ?? false;
  const now = nowInTaipei();
  const nowIso = now.toISOString();
  const result: ReminderRunResult = {
    now: nowIso,
    dryRun,
    sent: [],
    skipped: [],
  };

  await ensureReminderDispatchTable();

  if (!process.env.DINGTALK_WEBHOOK_URL?.trim()) {
    result.skipped.push({
      type: "daily_summary",
      reason: "未配置 DINGTALK_WEBHOOK_URL",
    });
    result.skipped.push({
      type: "deadline_alert",
      reason: "未配置 DINGTALK_WEBHOOK_URL",
    });
    result.skipped.push({
      type: "waiting_follow_up",
      reason: "未配置 DINGTALK_WEBHOOK_URL",
    });
    return result;
  }

  const tasks = await prisma.task.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      deadline: true,
      nextCheckAt: true,
      nextActionSuggestion: true,
      waitingFor: true,
      waitingReasonType: true,
      waitingReasonText: true,
      priorityScore: true,
    },
    orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
  });

  const taskList = tasks as ReminderTask[];
  const dailyTime = parseDailyTime(process.env.REMINDER_DAILY_TIME);
  const dailyGate = now.hour(dailyTime.hour).minute(dailyTime.minute).second(0).millisecond(0);
  const dailyKey = `daily-summary:${now.format("YYYY-MM-DD")}`;

  if (now.isBefore(dailyGate)) {
    result.skipped.push({
      type: "daily_summary",
      reason: `未到每日推送时间（${String(dailyTime.hour).padStart(2, "0")}:${String(dailyTime.minute).padStart(2, "0")}）`,
    });
  } else if (await wasReminderSent(dailyKey)) {
    result.skipped.push({
      type: "daily_summary",
      reason: "今日摘要已发送",
    });
  } else {
    const dashboard = await getDashboardData("all");
    const text = buildDailySummaryText(dashboard, now.format("M月D日 HH:mm"));
    if (!dryRun) {
      await sendDingtalkText(text, { atAll });
      await recordReminderSent({
        reminderKey: dailyKey,
        reminderType: "daily_summary",
        payload: JSON.stringify({
          sentAt: nowIso,
          mustDo: dashboard.todayMustDoTasks.length,
          review: dashboard.reviewTasks.length,
          dueWaiting: dashboard.dueWaitingTasks.length,
        }),
      });
    }
    result.sent.push({
      type: "daily_summary",
      count: 1,
    });
  }

  const deadlineEntries = [];
  const liveTaskStatuses = new Set(["needs_review", "ready", "waiting", "in_progress", "pending_submit", "overdue"]);
  for (const task of taskList) {
    if (!liveTaskStatuses.has(task.status)) {
      continue;
    }
    const deadline = toTaipei(task.deadline);
    if (!deadline) {
      continue;
    }
    const hoursLeft = deadline.diff(now, "hour", true);
    const tier = resolveDeadlineTier(hoursLeft);
    if (!tier) {
      continue;
    }

    const reminderKey = `deadline-alert:${task.id}:${deadline.toISOString()}:${tier}`;
    if (await wasReminderSent(reminderKey)) {
      continue;
    }
    deadlineEntries.push({
      key: reminderKey,
      taskId: task.id,
      tier,
      task,
      deadline,
      hoursLeft,
    });
  }

  const sortedDeadlineEntries = deadlineEntries.sort((left, right) => left.deadline.valueOf() - right.deadline.valueOf()).slice(0, 8);
  if (sortedDeadlineEntries.length > 0) {
    const lines = [`【TaskFlow】截止提醒 ${now.format("M月D日 HH:mm")}`, ""];
    sortedDeadlineEntries.forEach((entry, index) => {
      lines.push(
        `${index + 1}. [${entry.tier}h] ${truncate(entry.task.title)}（${formatDeadline(entry.task.deadline)}，约剩 ${Math.max(
          1,
          Math.floor(entry.hoursLeft),
        )}h）`,
      );
      lines.push(`   下一步：${truncate(entry.task.nextActionSuggestion, 60)}`);
    });
    if (!dryRun) {
      await sendDingtalkText(lines.join("\n"), { atAll: false });
      for (const entry of sortedDeadlineEntries) {
        await recordReminderSent({
          reminderKey: entry.key,
          reminderType: "deadline_alert",
          taskId: entry.taskId,
          payload: JSON.stringify({
            tier: entry.tier,
            deadline: entry.deadline.toISOString(),
            sentAt: nowIso,
          }),
        });
      }
    }
    result.sent.push({
      type: "deadline_alert",
      count: sortedDeadlineEntries.length,
    });
  } else {
    result.skipped.push({
      type: "deadline_alert",
      reason: "当前没有新的截止前提醒",
    });
  }

  const waitingEntries = [];
  for (const task of taskList) {
    if (task.status !== "waiting") {
      continue;
    }
    const nextCheckAt = toTaipei(task.nextCheckAt);
    if (!nextCheckAt || nextCheckAt.isAfter(now)) {
      continue;
    }
    const reminderKey = `waiting-followup:${task.id}:${nextCheckAt.toISOString()}`;
    if (await wasReminderSent(reminderKey)) {
      continue;
    }
    waitingEntries.push({
      key: reminderKey,
      taskId: task.id,
      nextCheckAt,
      task,
    });
  }

  const sortedWaitingEntries = waitingEntries.sort((left, right) => left.nextCheckAt.valueOf() - right.nextCheckAt.valueOf()).slice(0, 8);
  if (sortedWaitingEntries.length > 0) {
    const lines = [`【TaskFlow】等待任务到点回看 ${now.format("M月D日 HH:mm")}`, ""];
    sortedWaitingEntries.forEach((entry, index) => {
      lines.push(`${index + 1}. ${truncate(entry.task.title)}（回看时间：${formatDeadline(entry.task.nextCheckAt)}）`);
      const reason = describeWaitingReason(entry.task);
      lines.push(`   原因：${truncate(reason || entry.task.waitingFor || "等待外部事项", 60)}`);
    });
    if (!dryRun) {
      await sendDingtalkText(lines.join("\n"), { atAll: false });
      for (const entry of sortedWaitingEntries) {
        await recordReminderSent({
          reminderKey: entry.key,
          reminderType: "waiting_follow_up",
          taskId: entry.taskId,
          payload: JSON.stringify({
            nextCheckAt: entry.nextCheckAt.toISOString(),
            sentAt: nowIso,
          }),
        });
      }
    }
    result.sent.push({
      type: "waiting_follow_up",
      count: sortedWaitingEntries.length,
    });
  } else {
    result.skipped.push({
      type: "waiting_follow_up",
      reason: "当前没有新的回看提醒",
    });
  }

  return result;
}

