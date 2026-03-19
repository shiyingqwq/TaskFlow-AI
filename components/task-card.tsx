import Link from "next/link";
import type { Source, Task } from "@/generated/prisma/client";

import { deliveryTypeLabels, taskTypeLabels } from "@/lib/constants";
import { describeIdentityScope, hasIdentityRestriction } from "@/lib/identity";
import { DeleteTaskAction } from "@/components/delete-task-action";
import { normalizeMaterials } from "@/lib/materials";
import { getRecurrenceSummary, getTaskProgress, shouldShowTaskProgress } from "@/lib/recurrence";
import { buildReviewState } from "@/lib/task-review";
import { TaskProgressActions } from "@/components/task-progress-actions";
import { StatusBadge } from "@/components/status-badge";
import { QuickStatusActions, ReviewQuickActions, TaskStatusShortcutActions, WaitingFollowUpActions } from "@/components/quick-status-actions";
import { formatDeadline } from "@/lib/time";
import type { DisplayTaskStatus } from "@/lib/task-blocking";
import { describeWaitingReason, isWaitingFollowUpDue } from "@/lib/waiting";

type TaskCardProps = {
  task: Task & {
    source?: Source | null;
    progressLogs?: Array<{ id: string; completedAt: Date }>;
    displayStatus?: DisplayTaskStatus;
    isBlockedByPredecessor?: boolean;
    blockingPredecessorTitles?: string[];
    predecessorLinks?: Array<{
      id: string;
      predecessorTaskId: string;
      relationType: string;
      predecessorTask?: { id: string; title: string } | null;
    }>;
    successorLinks?: Array<{
      id: string;
      successorTaskId: string;
      relationType: string;
    }>;
    needsHumanReview?: boolean;
    reviewReasons?: unknown;
    deadlineInferenceReason?: string | null;
    deadlineRolledToNextYear?: boolean;
    applicableIdentities?: unknown;
    identityHint?: string | null;
  };
  emphasis?: boolean;
  compact?: boolean;
};

export function TaskCard({ task, emphasis = false, compact = false }: TaskCardProps) {
  const materials = normalizeMaterials(task.materials);
  const progress = getTaskProgress(task);
  const review = buildReviewState({
    taskType: task.taskType,
    deliveryType: task.deliveryType,
    deadline: task.deadline,
    deadlineText: task.deadlineText,
    submitTo: task.submitTo,
    submitChannel: task.submitChannel,
    requiresSignature: task.requiresSignature,
    requiresStamp: task.requiresStamp,
    materials: task.materials,
    dependsOnExternal: task.dependsOnExternal,
    waitingFor: task.waitingFor,
    waitingReasonType: task.waitingReasonType,
    waitingReasonText: task.waitingReasonText,
    nextCheckAt: task.nextCheckAt,
    confidence: task.confidence,
    description: task.description,
  });
  const deadlineTone =
    task.status === "overdue"
      ? "text-rose-700"
      : task.priorityScore >= 60
        ? "text-orange-700"
        : "text-[var(--muted)]";
  const waitingFollowUpDue = task.status === "waiting" && isWaitingFollowUpDue(task);
  const waitingReason = describeWaitingReason(task);
  const predecessorTitles =
    task.blockingPredecessorTitles ??
    (task.predecessorLinks ?? []).map((item) => item.predecessorTask?.title).filter((title): title is string => Boolean(title));
  const predecessorSummary = predecessorTitles.length > 0 ? `先完成 ${predecessorTitles.join("、")}` : "无";
  const successorSummary = (task.successorLinks?.length ?? 0) > 0 ? `完成后会解锁 ${task.successorLinks!.length} 条后续任务` : "无";
  const externalWaitingSummary = waitingReason ? waitingReason : task.dependsOnExternal ? "有，等待外部配合" : "无";

  return (
    <article
      className={`border border-[var(--line)] bg-[var(--panel)] ${
        compact ? "rounded-[20px] p-3 shadow-[0_6px_18px_rgba(90,67,35,0.04)]" : "rounded-[24px] p-4 shadow-[0_10px_30px_rgba(90,67,35,0.06)]"
      } ${
        emphasis ? "border-[rgba(178,75,42,0.35)]" : ""
      }`}
    >
      <div className={`flex ${compact ? "flex-col gap-2" : "flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"}`}>
        <div className={compact ? "space-y-1.5" : "space-y-2"}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.displayStatus ?? task.status} />
            <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs text-[var(--accent)]">
              {taskTypeLabels[task.taskType]}
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs text-[var(--muted)] ring-1 ring-[var(--line)]">
              {deliveryTypeLabels[task.deliveryType]}
            </span>
          </div>
          <Link className="block text-lg font-semibold hover:text-[var(--accent)]" href={`/tasks/${task.id}`}>
            {task.title}
          </Link>
          <p className={`text-[var(--muted)] ${compact ? "text-sm leading-6" : "text-sm leading-6"}`}>{task.description || task.nextActionSuggestion}</p>
        </div>
        <div className={`${compact ? "flex items-center gap-3 text-sm" : "min-w-44 rounded-2xl bg-white/75 p-3 ring-1 ring-[var(--line)]"}`}>
          {compact ? (
            <>
              <span className="font-semibold text-[var(--teal)]">{task.priorityScore}</span>
              <span className={deadlineTone}>截止：{formatDeadline(task.deadline)}</span>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--muted)]">决策分数</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--teal)]">{task.priorityScore}</p>
              <p className={`mt-2 text-sm ${deadlineTone}`}>截止：{formatDeadline(task.deadline)}</p>
            </>
          )}
          {task.deadlineRolledToNextYear && task.deadlineInferenceReason ? (
            <p className={`${compact ? "" : "mt-1"} text-xs text-amber-700`}>{task.deadlineInferenceReason}</p>
          ) : null}
        </div>
      </div>

      <div className={`grid text-sm text-[var(--muted)] ${compact ? "mt-3 gap-2" : "mt-4 gap-3 sm:grid-cols-2"}`}>
        <div>
          <p>提交对象：{task.submitTo || "未明确"}</p>
          <p className="mt-1">提交方式：{task.submitChannel || "未明确"}</p>
          <p className={`mt-1 ${hasIdentityRestriction(task) ? "text-amber-700" : ""}`}>{describeIdentityScope(task)}</p>
          <p className="mt-1">任务节奏：{getRecurrenceSummary(task)}</p>
        </div>
        <div>
          <p>下一步：{task.nextActionSuggestion}</p>
          <p className="mt-1">前置任务：{predecessorSummary}</p>
          <p className="mt-1">后续任务：{successorSummary}</p>
          <p className="mt-1">外部等待：{externalWaitingSummary}</p>
          {waitingFollowUpDue ? <p className="mt-1 text-amber-700">现在该回看这条等待任务了。</p> : null}
        </div>
      </div>

      {shouldShowTaskProgress(task) ? (
        <div className={`text-sm leading-6 text-[var(--muted)] ${compact ? "mt-3 rounded-[18px] bg-white/60 px-3 py-2.5" : "mt-4 rounded-2xl bg-white/70 p-3 ring-1 ring-[var(--line)]"}`}>
          <p className="font-medium text-[var(--text)]">当前进度</p>
          <p className="mt-1">{progress.helperText}</p>
        </div>
      ) : null}

      {materials.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {materials.map((material) => (
            <span className="rounded-full bg-white px-2.5 py-1 text-xs text-[var(--muted)] ring-1 ring-[var(--line)]" key={material}>
              {material}
            </span>
          ))}
        </div>
      ) : null}

      {compact ? (
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{task.priorityReason}</p>
      ) : (
        <div className="mt-4 rounded-2xl bg-white/70 p-3 text-sm leading-6 text-[var(--muted)] ring-1 ring-[var(--line)]">
          <p className="font-medium text-[var(--text)]">优先级解释</p>
          <p className="mt-1">{task.priorityReason}</p>
        </div>
      )}

      {task.needsHumanReview && review.highRiskItems.length > 0 ? (
        <div className={`border border-amber-200 bg-amber-50 text-sm text-amber-900 ${compact ? "mt-3 rounded-[18px] px-3 py-2.5" : "mt-4 rounded-2xl px-4 py-3"}`}>
          <p className="font-medium">高风险确认</p>
          <div className="mt-2 space-y-1">
            {review.highRiskItems.map((item) => (
              <p key={item.code}>- {item.label}</p>
            ))}
          </div>
          {review.lowRiskItems.length > 0 ? (
            <p className="mt-2 text-xs text-amber-800">另有 {review.lowRiskItems.length} 条低风险补充，不会挡住流转。</p>
          ) : null}
        </div>
      ) : null}

      <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${compact ? "mt-3" : "mt-4"}`}>
        <div className="text-xs text-[var(--muted)]">
          {task.source ? (
            <Link className="hover:text-[var(--accent)]" href={`/sources/${task.source.id}`}>
              来源：{task.source.title || task.source.originalFilename || "未命名来源"}
            </Link>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {task.needsHumanReview ? (
            <ReviewQuickActions compact taskId={task.id} />
          ) : task.status === "waiting" ? (
            <WaitingFollowUpActions compact taskId={task.id} />
          ) : compact ? (
            <TaskStatusShortcutActions compact status={task.status} taskId={task.id} />
          ) : (
            <QuickStatusActions compact taskId={task.id} />
          )}
          {shouldShowTaskProgress(task) ? <TaskProgressActions compact taskId={task.id} /> : null}
          <DeleteTaskAction compact redirectTo={task.source ? `/sources/${task.source.id}` : "/"} taskId={task.id} />
        </div>
      </div>
    </article>
  );
}
