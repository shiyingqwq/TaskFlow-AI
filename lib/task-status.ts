import type { TaskStatus } from "@/generated/prisma/enums";
import { hasWaitingReason } from "@/lib/waiting";

type StatusInferenceInput = {
  confidence: number;
  deadline: string | Date | null;
  deadlineText: string | null;
  taskType: string;
  deliveryType: string;
  dependsOnExternal: boolean;
  waitingFor: string | null;
  waitingReasonType?: string | null;
  waitingReasonText?: string | null;
  nextCheckAt?: string | Date | null;
};

type RecalculatedStatusInput = StatusInferenceInput & {
  status: TaskStatus;
};

const lockedStatuses: TaskStatus[] = ["done", "ignored", "waiting"];
const ambiguousDeadlinePattern = /(尽快|另行通知|待定|之后)/;

export function normalizeSubmittedStatus(task: StatusInferenceInput): TaskStatus {
  return hasWaitingReason(task) ? "waiting" : "done";
}

export function inferConfirmedTaskStatus(task: StatusInferenceInput): TaskStatus {
  if (hasWaitingReason(task)) {
    return "waiting";
  }

  if (task.taskType === "submission" && task.deliveryType !== "unknown") {
    return "pending_submit";
  }

  return "in_progress";
}

export function inferTaskStatus(task: StatusInferenceInput): TaskStatus {
  if (task.confidence < 0.65 || (!task.deadline && task.deadlineText && ambiguousDeadlinePattern.test(task.deadlineText))) {
    return "needs_review";
  }

  return inferConfirmedTaskStatus(task);
}

export function resolveRecalculatedStatus(task: RecalculatedStatusInput, suggestedStatus?: TaskStatus): TaskStatus {
  if (suggestedStatus === "overdue") {
    return lockedStatuses.includes(task.status) ? task.status : "overdue";
  }

  if (task.status === "submitted") {
    return normalizeSubmittedStatus(task);
  }

  if (task.status === "ready") {
    return suggestedStatus ?? inferConfirmedTaskStatus(task);
  }

  if (task.status !== "overdue") {
    return task.status;
  }

  return inferConfirmedTaskStatus(task);
}
