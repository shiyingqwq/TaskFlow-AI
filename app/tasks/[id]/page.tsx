import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { deliveryTypeLabels, taskTypeLabels } from "@/lib/constants";
import { describeIdentityScope } from "@/lib/identity";
import { normalizeMaterials } from "@/lib/materials";
import { getRecurrenceSummary, getTaskProgress, shouldShowTaskProgress } from "@/lib/recurrence";
import { getTaskById } from "@/lib/server/tasks";
import { buildReviewState } from "@/lib/task-review";
import { describeDeadlineAudit, formatDeadline, parseDeadlineWithAudit, readDeadlineAuditRecord } from "@/lib/time";
import { describeWaitingReason, isWaitingFollowUpDue, waitingReasonTypeLabels } from "@/lib/waiting";
import { DeleteTaskAction } from "@/components/delete-task-action";
import { DetailPageNav } from "@/components/detail-page-nav";
import { TaskProgressActions } from "@/components/task-progress-actions";
import { StatusBadge } from "@/components/status-badge";
import { QuickStatusActions, ReviewQuickActions, WaitingFollowUpActions } from "@/components/quick-status-actions";
import { TaskBanterPanel } from "@/components/task-banter-panel";
import { TaskEditForm } from "@/components/task-edit-form";
import { buildTaskBanterFallback } from "@/lib/task-banter";
import { getDisplayTaskStatus } from "@/lib/task-blocking";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTaskById(id);
  if (!task) {
    notFound();
  }

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
  const deadlineAudit =
    readDeadlineAuditRecord({
      deadlineInferenceType: task.deadlineInferenceType,
      deadlineInferenceRule: task.deadlineInferenceRule,
      deadlineInferenceReason: task.deadlineInferenceReason,
      deadlineInferenceConfidence: task.deadlineInferenceConfidence,
      deadlineUsedCurrentYear: task.deadlineUsedCurrentYear,
      deadlineRolledToNextYear: task.deadlineRolledToNextYear,
    }) ?? (task.deadlineText ? parseDeadlineWithAudit(task.deadlineText) : null);
  const waitingFollowUpDue = task.status === "waiting" && isWaitingFollowUpDue(task);
  const displayStatus = task.displayStatus ?? getDisplayTaskStatus(task);
  const predecessorTitles = task.predecessorLinks.map((item) => item.predecessorTask.title);
  const successorTitles = task.successorLinks.map((item) => item.successorTask.title);
  const waitingReason = describeWaitingReason(task);
  const initialBanter = buildTaskBanterFallback({
    id: task.id,
    title: task.title,
    status: task.status,
    deadline: task.deadline,
    deadlineText: task.deadlineText,
    deliveryType: task.deliveryType,
    requiresSignature: task.requiresSignature,
    requiresStamp: task.requiresStamp,
    recurrenceType: task.recurrenceType,
    recurrenceTargetCount: task.recurrenceTargetCount,
    dependsOnExternal: task.dependsOnExternal,
    waitingReasonText: task.waitingReasonText,
    nextActionSuggestion: task.nextActionSuggestion,
  });

  return (
    <main className="space-y-4 pb-10">
      <DetailPageNav
        items={[
          { label: "总览", href: "/" },
          { label: "任务", href: "/?section=tasks&filter=all" },
          { label: "来源", href: `/sources/${task.sourceId}` as Route },
          { label: task.title },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="space-y-6">
        <div className="rounded-[30px] border border-[var(--line)] bg-[var(--panel)] p-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={displayStatus} />
            <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs text-[var(--accent)]">
              {taskTypeLabels[task.taskType]}
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs text-[var(--muted)] ring-1 ring-[var(--line)]">
              {deliveryTypeLabels[task.deliveryType]}
            </span>
          </div>
          <div className="mt-4 flex justify-end">
            <DeleteTaskAction redirectTo={`/sources/${task.sourceId}`} taskId={task.id} />
          </div>
          <h1 className="mt-4 text-3xl font-semibold">{task.title}</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{task.description || task.nextActionSuggestion}</p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
              <p className="text-sm text-[var(--muted)]">截止时间</p>
              <p className={`mt-2 text-xl font-semibold ${task.status === "overdue" ? "text-rose-700" : "text-[var(--text)]"}`}>
                {formatDeadline(task.deadline)}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">原始表达：{task.deadlineText || "未明确"}</p>
              {deadlineAudit ? <p className="mt-1 text-sm text-[var(--muted)]">{describeDeadlineAudit(deadlineAudit)}</p> : null}
              {deadlineAudit?.rule ? <p className="mt-1 text-xs text-[var(--muted)]">审计规则：{deadlineAudit.rule}</p> : null}
            </div>
            <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
              <p className="text-sm text-[var(--muted)]">决策排序</p>
              <p className="mt-2 text-xl font-semibold text-[var(--teal)]">{task.priorityScore}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{task.priorityReason}</p>
            </div>
          </div>

          {task.needsHumanReview || review.lowRiskItems.length > 0 ? (
            <div className="mt-5 rounded-[24px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-medium text-amber-950">解析确认</h2>
                  <p className="mt-1">
                    {task.needsHumanReview
                      ? "这里只拦高风险字段，先确认关键要求；低风险项可以顺手补，不会挡住任务流转。"
                      : "高风险字段已经放行，下面只保留一些可顺手补充的低风险提示。"}
                  </p>
                </div>
                {task.needsHumanReview ? <ReviewQuickActions taskId={task.id} /> : null}
              </div>
              {task.needsHumanReview ? (
                <div className="mt-4">
                  <h3 className="font-medium text-amber-950">高风险确认</h3>
                  <div className="mt-2 space-y-2">
                    {review.highRiskItems.map((item) => (
                      <p key={item.code}>- {item.label}</p>
                    ))}
                  </div>
                </div>
              ) : null}
              {review.lowRiskItems.length > 0 ? (
                <div className="mt-4">
                  <h3 className="font-medium text-amber-950">低风险补充</h3>
                  <div className="mt-2 space-y-2 text-amber-800">
                    {review.lowRiskItems.map((item) => (
                      <p key={item.code}>- {item.label}</p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
              <h2 className="font-medium">提交与交付要求</h2>
              <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                <p>提交对象：{task.submitTo || "未明确"}</p>
                <p>提交方式：{task.submitChannel || "未明确"}</p>
                <p>适用身份：{describeIdentityScope(task)}</p>
                <p>交付形式：{deliveryTypeLabels[task.deliveryType]}</p>
                <p>任务节奏：{getRecurrenceSummary(task)}</p>
                <p>签字要求：{task.requiresSignature ? "需要" : "不需要/未提及"}</p>
                <p>盖章要求：{task.requiresStamp ? "需要" : "不需要/未提及"}</p>
              </div>
            </div>
            <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
              <h2 className="font-medium">下一步与阻塞</h2>
              <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                <p>下一步建议：{task.nextActionSuggestion}</p>
                <p>前置任务：{predecessorTitles.length > 0 ? `先完成 ${predecessorTitles.join("、")}` : "无"}</p>
                <p>后续任务：{successorTitles.length > 0 ? `完成后会解锁 ${successorTitles.join("、")}` : "无"}</p>
                <p>外部等待：{waitingReason ? waitingReason : task.dependsOnExternal ? "有，等待外部配合" : "无"}</p>
                <p>等待类型：{task.waitingReasonType ? waitingReasonTypeLabels[task.waitingReasonType as keyof typeof waitingReasonTypeLabels] : "未设置"}</p>
                {waitingFollowUpDue ? <p className="text-amber-700">现在已经到回看时间，可以催一下或重新安排。</p> : null}
              </div>
            </div>
          </div>

          {materials.length > 0 ? (
            <div className="mt-5">
              <h2 className="font-medium">涉及材料</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {materials.map((material) => (
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-[var(--muted)] ring-1 ring-[var(--line)]" key={material}>
                    {material}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {shouldShowTaskProgress(task) ? (
            <div className="mt-5 rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
              <h2 className="font-medium">重复进度</h2>
              <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                <p>{progress.helperText}</p>
                {task.recurrenceType === "limited" && task.recurrenceLimit ? <p>计划总次数：{task.recurrenceLimit}</p> : null}
              </div>
              <TaskProgressActions taskId={task.id} />
            </div>
          ) : null}

          {task.needsHumanReview ? null : task.status === "waiting" ? <WaitingFollowUpActions taskId={task.id} /> : <QuickStatusActions taskId={task.id} />}
        </div>

        <TaskBanterPanel initialMode="fallback" initialText={initialBanter} taskId={task.id} />

        <TaskEditForm
          task={{
            id: task.id,
            title: task.title,
            description: task.description,
            submitTo: task.submitTo,
            submitChannel: task.submitChannel,
            recurrenceType: task.recurrenceType as "single" | "daily" | "weekly" | "limited",
            recurrenceDays: Array.isArray(task.recurrenceDays) ? task.recurrenceDays.map((item) => Number(item)).filter((item) => !Number.isNaN(item)) : [],
            recurrenceTargetCount: task.recurrenceTargetCount,
            recurrenceLimit: task.recurrenceLimit,
            deadlineText: task.deadlineText,
            deadlineISO: task.deadline?.toISOString() ?? null,
            deliveryType: task.deliveryType,
            requiresSignature: task.requiresSignature,
            requiresStamp: task.requiresStamp,
            dependsOnExternal: task.dependsOnExternal,
            waitingFor: task.waitingFor,
            waitingReasonType: task.waitingReasonType,
            waitingReasonText: task.waitingReasonText,
            nextCheckAt: task.nextCheckAt?.toISOString() ?? null,
            nextActionSuggestion: task.nextActionSuggestion,
            status: task.status,
            materials,
            taskType: task.taskType,
            applicableIdentities: Array.isArray(task.applicableIdentities)
              ? task.applicableIdentities.map((item) => String(item)).filter(Boolean)
              : [],
            identityHint: task.identityHint,
          }}
        />
      </section>

      <aside className="space-y-6">
        <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">来源可追溯</h2>
            <Link className="text-sm text-[var(--accent)]" href={`/sources/${task.sourceId}`}>
              查看来源
            </Link>
          </div>
          <div className="mt-4 rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
            <p className="text-sm font-medium">{task.source.title || task.source.originalFilename || "未命名来源"}</p>
            <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{task.evidenceSnippet}</p>
          </div>
        </section>

        <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-xl font-semibold">相关依赖</h2>
          <div className="mt-4 space-y-3">
            {task.predecessorLinks.length === 0 && task.successorLinks.length === 0 ? (
              <p className="rounded-[22px] bg-white/75 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">当前没有记录依赖关系。</p>
            ) : null}
            {task.predecessorLinks.map((item) => (
              <Link className="block rounded-[22px] bg-white/75 p-4 ring-1 ring-[var(--line)]" href={`/tasks/${item.predecessorTask.id}`} key={item.id}>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">前置任务</p>
                <p className="mt-2 font-medium">{item.predecessorTask.title}</p>
              </Link>
            ))}
            {task.successorLinks.map((item) => (
              <Link className="block rounded-[22px] bg-white/75 p-4 ring-1 ring-[var(--line)]" href={`/tasks/${item.successorTask.id}`} key={item.id}>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">后续任务</p>
                <p className="mt-2 font-medium">{item.successorTask.title}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-xl font-semibold">操作记录</h2>
          <div className="mt-4 space-y-3">
            {task.actionLogs.map((log) => (
              <div className="rounded-[22px] bg-white/75 p-4 ring-1 ring-[var(--line)]" key={log.id}>
                <p className="text-sm font-medium">{log.actionType}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{log.note || "无备注"}</p>
              </div>
            ))}
          </div>
        </section>
      </aside>
      </div>
    </main>
  );
}
