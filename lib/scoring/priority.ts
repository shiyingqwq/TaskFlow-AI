import type { TaskStatus } from "@/generated/prisma/enums";

import { getTaskProgress } from "@/lib/recurrence";
import { diffHoursFromNow, formatDeadline } from "@/lib/time";
import { describeWaitingReason, hasWaitingReason } from "@/lib/waiting";

export type PriorityTask = {
  id: string;
  title: string;
  status: TaskStatus;
  startAt?: string | Date | null;
  deadline: string | Date | null;
  taskType: string;
  recurrenceType?: string | null;
  recurrenceDays?: unknown;
  recurrenceTargetCount?: number | null;
  recurrenceLimit?: number | null;
  progressLogs?: Array<{ completedAt: string | Date }>;
  deliveryType: string;
  requiresSignature: boolean;
  requiresStamp: boolean;
  dependsOnExternal: boolean;
  waitingFor: string | null;
  waitingReasonType?: string | null;
  waitingReasonText?: string | null;
  nextCheckAt?: string | Date | null;
  snoozeUntil?: string | Date | null;
  nextActionSuggestion: string;
  successorCount: number;
  blockingPredecessorTitles?: string[];
};

export type PriorityResult = {
  priorityScore: number;
  priorityReason: string;
  suggestedStatus?: TaskStatus;
};

const terminalStatuses: TaskStatus[] = ["submitted", "done", "ignored"];

export function calculatePriority(task: PriorityTask): PriorityResult {
  const reasons: string[] = [];
  let score = 0;
  let suggestedStatus: TaskStatus | undefined;
  let deadlineIsOverdue = false;
  const progress = getTaskProgress(task);
  const blockingPredecessorTitles = task.blockingPredecessorTitles ?? [];
  const isBlockedByPredecessor = blockingPredecessorTitles.length > 0;

  if (terminalStatuses.includes(task.status)) {
    return {
      priorityScore: -100,
      priorityReason: "该任务已处理完成或被忽略，不再参与当前决策排序。",
    };
  }

  const diffHours = diffHoursFromNow(task.deadline);
  const startDiffHours = diffHoursFromNow(task.startAt ?? null);
  const snoozeDiffHours = diffHoursFromNow(task.snoozeUntil ?? null);

  if (startDiffHours !== null && startDiffHours > 0) {
    score -= 32;
    reasons.push(`尚未到开始时间（${formatDeadline(task.startAt ?? null)}）`);
  }

  if (snoozeDiffHours !== null && snoozeDiffHours > 0) {
    score -= 54;
    reasons.push(`已设置稍后提醒至 ${formatDeadline(task.snoozeUntil ?? null)}`);
  }

  if (diffHours !== null) {
    if (diffHours < 0) {
      deadlineIsOverdue = true;
      const overdueBoost = 120 + Math.min(36, Math.round(Math.abs(diffHours)));
      score += overdueBoost;
      reasons.push(`已逾期，截止时间是 ${formatDeadline(task.deadline)}`);
      suggestedStatus = "overdue";
    } else if (diffHours <= 12) {
      score += 72;
      reasons.push(`12 小时内截止，必须优先推进`);
    } else if (diffHours <= 24) {
      score += 60;
      reasons.push(`今天到明天内截止，临近风险高`);
    } else if (diffHours <= 48) {
      score += 42;
      reasons.push(`两天内截止，需要今天推进`);
    } else if (diffHours <= 72) {
      score += 25;
      reasons.push(`三天内截止，适合提前处理`);
    }
  } else {
    score += 8;
    reasons.push("截止时间不明确，存在漏做风险");
  }

  if (task.successorCount > 0) {
    const blockingScore = task.successorCount * 18;
    score += blockingScore;
    reasons.push(`完成后可解锁 ${task.successorCount} 个后续步骤`);
  }

  if (isBlockedByPredecessor) {
    score -= 36;
    reasons.push(`被前置任务阻塞，先完成 ${blockingPredecessorTitles.join("、")}`);
  }

  if (task.dependsOnExternal || hasWaitingReason(task)) {
    score += 20;
    reasons.push(describeWaitingReason(task) ? `当前等待原因：${describeWaitingReason(task)}` : "依赖外部配合，需要提前发起");
  }

  const offlineRisk =
    (task.deliveryType === "paper" ? 16 : 0) +
    (task.deliveryType === "both" ? 18 : 0) +
    (task.requiresSignature ? 16 : 0) +
    (task.requiresStamp ? 18 : 0) +
    (task.taskType === "offline" ? 10 : 0);
  if (offlineRisk > 0) {
    score += offlineRisk;
    reasons.push("涉及打印、签字、盖章或线下送交，受办公时间影响");
  }

  if (task.status === "ready" && !isBlockedByPredecessor) {
    score += 16;
    reasons.push("当前可直接推进");
  }

  if (task.status === "pending_submit" && !isBlockedByPredecessor) {
    score += 18;
    reasons.push("材料接近可提交状态，推进收益高");
  }

  if (task.status === "in_progress" && !isBlockedByPredecessor) {
    score += 12;
    reasons.push("已经开始处理，继续推进最省切换成本");
  }

  if (task.status === "needs_review") {
    score += 4;
    reasons.push("信息仍需确认，但不宜长期搁置");
  }

  if (task.status === "waiting") {
    score -= 22;
    reasons.push("当前处于等待中，不应压过可立即执行任务");
  }

  if (progress.completed) {
    if (progress.recurrenceType === "daily" || progress.recurrenceType === "weekly") {
      score -= 70;
      reasons.push(`${progress.helperText}，本轮已完成，不必继续顶在最前`);
    } else {
      score -= 90;
      reasons.push(`${progress.helperText}，当前已做完`);
    }
  } else if (progress.recurrenceType !== "single" || progress.targetCount > 1) {
    reasons.push(progress.helperText);
  }

  if (task.status === "overdue" && (deadlineIsOverdue || diffHours === null)) {
    score += 40;
    reasons.push("任务已被标记为逾期，需要尽快止损");
  }

  if (task.nextActionSuggestion) {
    score += 8;
    reasons.push("存在明确下一步，可快速推进");
  }

  return {
    priorityScore: Math.round(score),
    priorityReason: reasons.join("；"),
    suggestedStatus,
  };
}
