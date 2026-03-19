import type { TaskStatus } from "@/generated/prisma/enums";

export type DisplayTaskStatus = TaskStatus | "blocked";

type BlockingTaskLike = {
  status: TaskStatus;
  predecessorLinks?: Array<{
    predecessorTask?: {
      title: string;
      status: TaskStatus;
    } | null;
  }>;
};

const resolvedPredecessorStatuses: TaskStatus[] = ["done", "submitted", "ignored"];
const nonBlockingDisplayStatuses: TaskStatus[] = ["waiting", "submitted", "done", "ignored"];

export function getBlockingPredecessorTitles(task: BlockingTaskLike) {
  return (task.predecessorLinks ?? [])
    .map((item) => item.predecessorTask)
    .filter((predecessorTask): predecessorTask is { title: string; status: TaskStatus } => Boolean(predecessorTask))
    .filter((predecessorTask) => !resolvedPredecessorStatuses.includes(predecessorTask.status))
    .map((predecessorTask) => predecessorTask.title);
}

export function isTaskBlockedByPredecessor(task: BlockingTaskLike) {
  if (nonBlockingDisplayStatuses.includes(task.status)) {
    return false;
  }

  return getBlockingPredecessorTitles(task).length > 0;
}

export function getDisplayTaskStatus(task: BlockingTaskLike): DisplayTaskStatus {
  return isTaskBlockedByPredecessor(task) ? "blocked" : task.status;
}
