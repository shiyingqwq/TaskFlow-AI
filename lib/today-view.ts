import type { TaskStatus } from "@/generated/prisma/enums";
import { nowInTaipei, toTaipei } from "@/lib/time";

type TodayTaskLike = {
  id: string;
  status: TaskStatus;
  deadline?: string | Date | null;
  nextCheckAt?: string | Date | null;
  priorityScore: number;
  needsHumanReview?: boolean;
  isBlockedByPredecessor?: boolean;
};

export function buildTodayBuckets<T extends TodayTaskLike>(tasks: T[], baseInput?: string | Date | null) {
  const base = toTaipei(baseInput) ?? nowInTaipei();
  const endOfToday = base.endOf("day");
  const mustDoIds = new Set<string>();
  const reminderIds = new Set<string>();
  const shouldDoIds = new Set<string>();
  const inactiveStatuses: TaskStatus[] = ["done", "ignored", "submitted"];

  const liveTasks = tasks.filter((task) => !inactiveStatuses.includes(task.status));

  const mustDo = liveTasks
    .filter((task) => {
      if (task.status === "waiting" || task.isBlockedByPredecessor) {
        return false;
      }

      const deadline = toTaipei(task.deadline);
      if (!deadline) {
        return false;
      }

      return !deadline.isAfter(endOfToday);
    })
    .sort((left, right) => {
      const leftDeadline = toTaipei(left.deadline);
      const rightDeadline = toTaipei(right.deadline);
      const leftOverdue = leftDeadline ? leftDeadline.isBefore(base) : false;
      const rightOverdue = rightDeadline ? rightDeadline.isBefore(base) : false;

      if (leftOverdue !== rightOverdue) {
        return Number(rightOverdue) - Number(leftOverdue);
      }

      const leftTimestamp = leftDeadline?.valueOf() ?? Number.MAX_SAFE_INTEGER;
      const rightTimestamp = rightDeadline?.valueOf() ?? Number.MAX_SAFE_INTEGER;
      if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
      }

      return right.priorityScore - left.priorityScore;
    });

  mustDo.forEach((task) => mustDoIds.add(task.id));

  const reminderQueue = liveTasks
    .filter((task) => {
      if (task.status !== "waiting") {
        return false;
      }

      const nextCheckAt = toTaipei(task.nextCheckAt);
      return Boolean(nextCheckAt && !nextCheckAt.isAfter(endOfToday));
    })
    .sort((left, right) => {
      const leftTimestamp = toTaipei(left.nextCheckAt)?.valueOf() ?? Number.MAX_SAFE_INTEGER;
      const rightTimestamp = toTaipei(right.nextCheckAt)?.valueOf() ?? Number.MAX_SAFE_INTEGER;
      if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
      }
      return right.priorityScore - left.priorityScore;
    });

  reminderQueue.forEach((task) => reminderIds.add(task.id));

  const shouldDo = liveTasks
    .filter((task) => {
      if (mustDoIds.has(task.id) || reminderIds.has(task.id)) {
        return false;
      }

      if (task.needsHumanReview || task.isBlockedByPredecessor || task.status === "waiting") {
        return false;
      }

      return task.priorityScore >= 35;
    })
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, 6);

  shouldDo.forEach((task) => shouldDoIds.add(task.id));

  const canWait = liveTasks
    .filter((task) => {
      if (mustDoIds.has(task.id) || reminderIds.has(task.id) || shouldDoIds.has(task.id)) {
        return false;
      }

      return !task.isBlockedByPredecessor && !task.needsHumanReview && task.status !== "waiting";
    })
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, 6);

  return {
    mustDo,
    reminderQueue,
    shouldDo,
    canWait,
  };
}
