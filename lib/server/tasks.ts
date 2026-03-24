import { promises as fs } from "fs";
import path from "path";

import { ActionType, DeliveryType, TaskStatus, TaskType } from "@/generated/prisma/enums";
import type { Dependency, Source, Task, TaskProgressLog } from "@/generated/prisma/client";

import { parseSourceIntoTasks, ParsedSourceInput, enrichTasksForCreation } from "@/lib/parser";
import type { ExtractedTaskInput } from "@/lib/parser/schema";
import { buildFocusSummaryFallback, generateFocusSummary } from "@/lib/focus-summary";
import { matchesActiveIdentities, normalizeActiveIdentities, normalizeApplicableIdentities, normalizeIdentityHint } from "@/lib/identity";
import { getCurrentCycleLogIds } from "@/lib/recurrence";
import { calculatePriority } from "@/lib/scoring/priority";
import { getAppSettings, readAppSettingsRecord, updateFocusSummarySnapshot } from "@/lib/server/app-settings";
import { prisma } from "@/lib/server/db";
import { deriveSourceTitle } from "@/lib/source-title";
import { buildReviewState } from "@/lib/task-review";
import { getBlockingPredecessorTitles, getDisplayTaskStatus, isTaskBlockedByPredecessor } from "@/lib/task-blocking";
import { inferConfirmedTaskStatus, inferTaskStatus, normalizeSubmittedStatus } from "@/lib/task-status";
import { resolveRecalculatedStatus } from "@/lib/task-status";
import { buildTodayBuckets } from "@/lib/today-view";
import { buildDeadlineAuditRecord, normalizeDeadlineInput } from "@/lib/time";
import { normalizeWaitingReasonInput, resolveWaitingFollowUpPreset, type WaitingFollowUpPreset } from "@/lib/waiting";

function isDatabaseNotReadyError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /no such table/i.test(error.message) || /SQLITE_ERROR/i.test(error.message);
}

async function sanitizeTaskJsonColumns() {
  await prisma.$executeRawUnsafe(`
    UPDATE Task
    SET
      recurrenceDays = CASE WHEN recurrenceDays IS NULL OR TRIM(recurrenceDays) = '' THEN '[]' ELSE recurrenceDays END,
      materials = CASE WHEN materials IS NULL OR TRIM(materials) = '' THEN '[]' ELSE materials END,
      reviewReasons = CASE WHEN reviewReasons IS NULL OR TRIM(reviewReasons) = '' THEN '[]' ELSE reviewReasons END,
      applicableIdentities = CASE WHEN applicableIdentities IS NULL OR TRIM(applicableIdentities) = '' THEN '[]' ELSE applicableIdentities END
    WHERE
      recurrenceDays IS NULL OR TRIM(recurrenceDays) = '' OR
      materials IS NULL OR TRIM(materials) = '' OR
      reviewReasons IS NULL OR TRIM(reviewReasons) = '' OR
      applicableIdentities IS NULL OR TRIM(applicableIdentities) = ''
  `);
}

type ReviewableTaskInput = {
  taskType: TaskType | string;
  deliveryType: DeliveryType | string;
  deadline: Date | string | null;
  deadlineText: string | null;
  recurrenceType: string;
  recurrenceDays: unknown;
  recurrenceTargetCount: number;
  recurrenceLimit: number | null;
  submitTo: string | null;
  submitChannel: string | null;
  requiresSignature: boolean;
  requiresStamp: boolean;
  materials: unknown;
  dependsOnExternal: boolean;
  waitingFor: string | null;
  waitingReasonType?: string | null;
  waitingReasonText?: string | null;
  nextCheckAt?: string | Date | null;
  confidence: number;
  description?: string | null;
};

type TaskCoreUpdateInput = {
  title: string;
  description: string;
  submitTo: string | null;
  submitChannel: string | null;
  applicableIdentities: string[];
  identityHint: string | null;
  recurrenceType: string;
  recurrenceDays: number[];
  recurrenceTargetCount: number;
  recurrenceLimit: number | null;
  deadlineText: string | null;
  deadline: string | Date | null;
  deliveryType: DeliveryType;
  requiresSignature: boolean;
  requiresStamp: boolean;
  waitingFor: string | null;
  waitingReasonType: string | null;
  waitingReasonText: string | null;
  nextCheckAt: string | Date | null;
  nextActionSuggestion: string;
  estimatedMinutes: number | null;
  status: TaskStatus;
  materials: string[];
  taskType: TaskType;
  dependsOnExternal: boolean;
};

function resolveStatusForPersistence(task: ReviewableTaskInput & { status: TaskStatus }, needsHumanReview: boolean) {
  const normalizedManualStatus =
    task.status === "submitted"
      ? normalizeSubmittedStatus(task)
      : task.status;

  if (needsHumanReview) {
    return ["done", "ignored", "waiting"].includes(normalizedManualStatus) ? normalizedManualStatus : "needs_review";
  }

  if (normalizedManualStatus === "needs_review") {
    return inferConfirmedTaskStatus(task);
  }

  return normalizedManualStatus;
}

function decorateTaskBlockingState<
  T extends {
    status: TaskStatus;
    predecessorLinks?: Array<{
      predecessorTask?: {
        title: string;
        status: TaskStatus;
      } | null;
    }>;
  },
>(task: T) {
  const blockingPredecessorTitles = getBlockingPredecessorTitles(task);
  return {
    ...task,
    blockingPredecessorTitles,
    isBlockedByPredecessor: blockingPredecessorTitles.length > 0 && isTaskBlockedByPredecessor(task),
    displayStatus: getDisplayTaskStatus(task),
  };
}

type DashboardTaskRecord = Task & {
  source?: Source | null;
  progressLogs?: TaskProgressLog[];
  predecessorLinks?: Array<
    Dependency & {
      predecessorTask?: Pick<Task, "id" | "title" | "status"> | null;
    }
  >;
  successorLinks?: Dependency[];
};

async function expandImpactedTaskIds(seedTaskIds: string[]) {
  const visited = new Set(seedTaskIds.filter(Boolean));
  if (visited.size === 0) {
    return [];
  }

  let frontier = [...visited];
  while (frontier.length > 0) {
    const links = await prisma.dependency.findMany({
      where: {
        predecessorTaskId: {
          in: frontier,
        },
      },
      select: {
        successorTaskId: true,
      },
    });

    const nextFrontier: string[] = [];
    for (const link of links) {
      if (!visited.has(link.successorTaskId)) {
        visited.add(link.successorTaskId);
        nextFrontier.push(link.successorTaskId);
      }
    }

    frontier = nextFrontier;
  }

  return [...visited];
}

export async function refreshDashboardFocusSummary() {
  const dashboard = await getDashboardData("all");
  const focusReviewTask = dashboard.reviewTasks[0] ?? null;
  const focusWaitingTask = dashboard.dueWaitingTasks[0] ?? null;
  const focusBlockedTask = dashboard.blockedTasks[0] ?? null;

  const focusMode = dashboard.currentBestTask
    ? "task"
    : focusReviewTask
      ? "review"
      : focusWaitingTask
        ? "waiting"
        : focusBlockedTask
          ? "blocked"
          : "empty";

  const input = {
    databaseReady: dashboard.databaseReady,
    focusMode,
    totalTaskCount: dashboard.tasks.length,
    reviewCount: dashboard.reviewTasks.length,
    dueWaitingCount: dashboard.dueWaitingTasks.length,
    blockedCount: dashboard.blockedTasks.length,
    topTaskTitles: dashboard.topTasksForToday.map((task) => task.title),
    currentBestTask: dashboard.currentBestTask,
    focusReviewTask,
    focusWaitingTask,
    focusBlockedTask,
    tasks: dashboard.tasks,
  } as const;

  const summary = dashboard.databaseReady
    ? await generateFocusSummary(input)
    : {
        text: buildFocusSummaryFallback(input),
        mode: "fallback" as const,
      };

  await updateFocusSummarySnapshot({
    focusSummaryText: summary.text,
    focusSummaryMode: summary.mode,
  });

  return summary;
}

export async function recalculateAllPriorities(input?: { taskIds?: string[]; expandSuccessors?: boolean }) {
  await sanitizeTaskJsonColumns();
  const requestedTaskIds = [...new Set((input?.taskIds ?? []).filter(Boolean))];
  const shouldExpandSuccessors = input?.expandSuccessors ?? true;
  const recalculateAll = requestedTaskIds.length === 0;
  const scopedTaskIds = recalculateAll
    ? []
    : shouldExpandSuccessors
      ? await expandImpactedTaskIds(requestedTaskIds)
      : requestedTaskIds;
  const tasks = await prisma.task.findMany({
    where: recalculateAll
      ? undefined
      : {
          id: {
            in: scopedTaskIds,
          },
        },
    include: {
      progressLogs: true,
      successorLinks: true,
      predecessorLinks: {
        include: {
          predecessorTask: true,
        },
      },
    },
  });

  if (tasks.length > 0) {
    await prisma.$transaction(
      tasks.map((task) => {
        const deadlineAudit = buildDeadlineAuditRecord({
          deadline: task.deadline,
          deadlineText: task.deadlineText,
        });
        const waiting = normalizeWaitingReasonInput({
          waitingFor: task.waitingFor,
          waitingReasonType: task.waitingReasonType,
          waitingReasonText: task.waitingReasonText,
          nextCheckAt: task.nextCheckAt,
          dependsOnExternal: task.dependsOnExternal,
        });
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
          waitingFor: waiting.waitingFor,
          waitingReasonType: waiting.waitingReasonType,
          waitingReasonText: waiting.waitingReasonText,
          nextCheckAt: waiting.nextCheckAt,
          confidence: task.confidence,
          description: task.description,
        });
        const needsHumanReview = review.needsHumanReview && !task.reviewResolved;

        const statusAfterReview = resolveStatusForPersistence(
          {
            status: task.status,
            confidence: task.confidence,
            deadline: task.deadline,
            deadlineText: task.deadlineText,
            taskType: task.taskType,
            recurrenceType: task.recurrenceType,
            recurrenceDays: task.recurrenceDays,
            recurrenceTargetCount: task.recurrenceTargetCount,
            recurrenceLimit: task.recurrenceLimit,
            deliveryType: task.deliveryType,
            submitTo: task.submitTo,
            submitChannel: task.submitChannel,
            requiresSignature: task.requiresSignature,
            requiresStamp: task.requiresStamp,
            materials: task.materials,
            dependsOnExternal: task.dependsOnExternal,
            waitingFor: waiting.waitingFor,
            waitingReasonType: waiting.waitingReasonType,
            waitingReasonText: waiting.waitingReasonText,
            nextCheckAt: waiting.nextCheckAt,
            description: task.description,
          },
          needsHumanReview,
        );

        const calculated = calculatePriority({
          id: task.id,
          title: task.title,
          status: statusAfterReview,
          deadline: task.deadline,
          taskType: task.taskType,
          recurrenceType: task.recurrenceType,
          recurrenceDays: task.recurrenceDays,
          recurrenceTargetCount: task.recurrenceTargetCount,
          recurrenceLimit: task.recurrenceLimit,
          progressLogs: task.progressLogs,
          deliveryType: task.deliveryType,
          requiresSignature: task.requiresSignature,
          requiresStamp: task.requiresStamp,
          dependsOnExternal: task.dependsOnExternal,
          waitingFor: waiting.waitingFor,
          waitingReasonType: waiting.waitingReasonType,
          waitingReasonText: waiting.waitingReasonText,
          nextCheckAt: waiting.nextCheckAt,
          nextActionSuggestion: task.nextActionSuggestion,
          successorCount: task.successorLinks.length,
          blockingPredecessorTitles: getBlockingPredecessorTitles(task),
        });

        const nextStatus = needsHumanReview
          ? statusAfterReview
          : resolveRecalculatedStatus(
              {
                status: statusAfterReview,
                confidence: task.confidence,
                deadline: task.deadline,
                deadlineText: task.deadlineText,
                taskType: task.taskType,
                deliveryType: task.deliveryType,
                dependsOnExternal: task.dependsOnExternal,
                waitingFor: waiting.waitingFor,
                waitingReasonType: waiting.waitingReasonType,
                waitingReasonText: waiting.waitingReasonText,
                nextCheckAt: waiting.nextCheckAt,
              },
              calculated.suggestedStatus,
            );

        return prisma.task.update({
          where: { id: task.id },
          data: {
            priorityScore: calculated.priorityScore,
            priorityReason: calculated.priorityReason,
            needsHumanReview,
            reviewReasons: review.reviewReasons,
            waitingFor: waiting.waitingFor,
            waitingReasonType: waiting.waitingReasonType,
            waitingReasonText: waiting.waitingReasonText,
            nextCheckAt: waiting.nextCheckAt,
            ...deadlineAudit,
            status: nextStatus,
          },
        });
      }),
    );
  }

  await refreshDashboardFocusSummary();
}

type PersistSourcePayload = {
  type: "text" | "image" | "pdf";
  title?: string | null;
  rawText: string;
  originalFilename?: string | null;
  filePath?: string | null;
  imageDataUrl?: string | null;
  activeIdentities?: string[];
};

type CreationTaskInput = ReturnType<typeof enrichTasksForCreation>[number];
type ParsedDependencyInput = {
  predecessorIndex: number;
  successorIndex: number;
  relationType: "sequence" | "prerequisite" | "blocks";
};
type ParsedImportDraft = {
  mode: "openai" | "fallback";
  sourceSummary: string;
  tasks: ExtractedTaskInput[];
  dependencies: ParsedDependencyInput[];
};
type ImportPreviewTask = ExtractedTaskInput & {
  index: number;
  deadlineISO: string | null;
  status: TaskStatus;
  displayStatus: TaskStatus | "blocked";
  priorityScore: number;
  priorityReason: string;
  needsHumanReview: boolean;
  reviewReasons: string[];
  blockingPredecessorTitles: string[];
  successorTitles: string[];
};
type ImportSummaryTaskItem = {
  id?: string;
  title: string;
  status: TaskStatus | "blocked";
  priorityScore: number;
  needsHumanReview: boolean;
};
type ImportSummary = {
  createdTaskCount: number;
  urgentTasks: Array<{
    id?: string;
    title: string;
    status: TaskStatus | "blocked";
    priorityScore: number;
  }>;
  reviewTasks: Array<{
    id?: string;
    title: string;
  }>;
  dependencyPairs: Array<{
    predecessorIndex: number;
    successorIndex: number;
    predecessorTitle: string;
    successorTitle: string;
    relationType: "sequence" | "prerequisite" | "blocks";
  }>;
};

function buildAssistantFallbackTask(rawText: string): ExtractedTaskInput {
  const compact = rawText.replace(/\s+/g, " ").trim();
  const inferredDeadline = normalizeDeadlineInput({
    deadlineText: compact,
  });

  return {
    title: compact.slice(0, 36) || "待办事项",
    description: "",
    taskType: "followup",
    recurrenceType: "single",
    recurrenceDays: [],
    recurrenceTargetCount: 1,
    recurrenceLimit: null,
    deadlineISO: inferredDeadline.deadlineISO,
    deadlineText: inferredDeadline.deadlineText,
    submitTo: null,
    submitChannel: null,
    applicableIdentities: [],
    identityHint: null,
    deliveryType: "unknown",
    requiresSignature: false,
    requiresStamp: false,
    materials: [],
    dependsOnExternal: false,
    waitingFor: null,
    waitingReasonType: null,
    waitingReasonText: null,
    nextCheckAt: null,
    confidence: 0.68,
    evidenceSnippet: compact.slice(0, 80) || "首页 AI 助手创建任务",
    nextActionSuggestion: "先确认这条任务的要求与截止时间，再推进第一步。",
    estimatedMinutes: null,
  };
}

async function persistSourceAndTaskInputs(
  payload: PersistSourcePayload,
  parsed: {
    mode: "openai" | "fallback";
    sourceSummary: string;
    dependencies: ParsedDependencyInput[];
  },
  taskInputs: CreationTaskInput[],
) {
  const sourceTitle = deriveSourceTitle({
    explicitTitle: payload.title,
    filename: payload.originalFilename,
    text: payload.rawText,
    summary: parsed.sourceSummary,
  });

  const source = await prisma.source.create({
    data: {
      type: payload.type,
      title: sourceTitle,
      rawText: payload.rawText,
      summary: parsed.sourceSummary,
      originalFilename: payload.originalFilename,
      filePath: payload.filePath,
    },
  });

  const createdTasks = await prisma.$transaction(async (tx) => {
    const tasks = [];
    const preferStructuredDeadline = parsed.mode === "openai";
    for (const taskInput of taskInputs) {
      const normalizedDeadline = normalizeDeadlineInput({
        deadlineISO: taskInput.deadlineISO,
        deadlineText: taskInput.deadlineText,
      }, undefined, { preferStructuredDeadline });
      const waiting = normalizeWaitingReasonInput({
        waitingFor: taskInput.waitingFor,
        waitingReasonType: taskInput.waitingReasonType,
        waitingReasonText: taskInput.waitingReasonText,
        nextCheckAt: taskInput.nextCheckAt,
        dependsOnExternal: taskInput.dependsOnExternal,
      });
      const review = buildReviewState({
        taskType: taskInput.taskType,
        deliveryType: taskInput.deliveryType,
        deadline: normalizedDeadline.deadlineISO,
        deadlineText: normalizedDeadline.deadlineText,
        submitTo: taskInput.submitTo,
        submitChannel: taskInput.submitChannel,
        requiresSignature: taskInput.requiresSignature,
        requiresStamp: taskInput.requiresStamp,
        materials: taskInput.materials,
        dependsOnExternal: taskInput.dependsOnExternal,
        waitingFor: waiting.waitingFor,
        waitingReasonType: waiting.waitingReasonType,
        waitingReasonText: waiting.waitingReasonText,
        nextCheckAt: waiting.nextCheckAt,
        confidence: taskInput.confidence,
        description: taskInput.description,
      });

      const created = await tx.task.create({
        data: {
          sourceId: source.id,
          title: taskInput.title,
          description: taskInput.description,
          taskType: taskInput.taskType,
          recurrenceType: taskInput.recurrenceType,
          recurrenceDays: taskInput.recurrenceDays,
          recurrenceTargetCount: taskInput.recurrenceTargetCount,
          recurrenceLimit: taskInput.recurrenceLimit,
          deadline: normalizedDeadline.deadline,
          deadlineText: normalizedDeadline.deadlineText,
          submitTo: taskInput.submitTo,
          submitChannel: taskInput.submitChannel,
          applicableIdentities: normalizeApplicableIdentities(taskInput.applicableIdentities),
          identityHint: normalizeIdentityHint(taskInput.identityHint),
          deliveryType: taskInput.deliveryType,
          requiresSignature: taskInput.requiresSignature,
          requiresStamp: taskInput.requiresStamp,
          materials: taskInput.materials,
          dependsOnExternal: taskInput.dependsOnExternal,
          waitingFor: waiting.waitingFor,
          waitingReasonType: waiting.waitingReasonType,
          waitingReasonText: waiting.waitingReasonText,
          nextCheckAt: waiting.nextCheckAt,
          status: resolveStatusForPersistence(
            {
              ...taskInput,
              deadline: normalizedDeadline.deadlineISO,
              deadlineText: normalizedDeadline.deadlineText,
              waitingFor: waiting.waitingFor,
              waitingReasonType: waiting.waitingReasonType,
              waitingReasonText: waiting.waitingReasonText,
              nextCheckAt: waiting.nextCheckAt,
              status: taskInput.status,
            },
            review.needsHumanReview,
          ),
          needsHumanReview: review.needsHumanReview,
          reviewResolved: false,
          reviewReasons: review.reviewReasons,
          ...normalizedDeadline.auditRecord,
          confidence: taskInput.confidence,
          evidenceSnippet: taskInput.evidenceSnippet,
          nextActionSuggestion: taskInput.nextActionSuggestion,
          estimatedMinutes: taskInput.estimatedMinutes ?? null,
        },
      });

      await tx.actionLog.create({
        data: {
          taskId: created.id,
          actionType: ActionType.created,
          note: `任务由 ${parsed.mode === "openai" ? "AI provider" : "fallback"} 解析创建`,
        },
      });

      tasks.push(created);
    }

    for (const dependency of parsed.dependencies) {
      const predecessor = tasks[dependency.predecessorIndex];
      const successor = tasks[dependency.successorIndex];
      if (!predecessor || !successor) {
        continue;
      }
      await tx.dependency.create({
        data: {
          predecessorTaskId: predecessor.id,
          successorTaskId: successor.id,
          relationType: dependency.relationType,
        },
      });
    }

    return tasks;
  });

  await recalculateAllPriorities();

  const refreshedTasks = await prisma.task.findMany({
    where: { sourceId: source.id },
    orderBy: { priorityScore: "desc" },
  });
  const refreshedTaskMap = new Map(refreshedTasks.map((task) => [task.id, task]));
  const orderedTasks = createdTasks.map((task) => refreshedTaskMap.get(task.id) ?? task);

  return {
    source,
    mode: parsed.mode,
    sourceSummary: parsed.sourceSummary,
    tasks: refreshedTasks,
    createdTasks,
    orderedTasks,
    summary: buildImportSummary(
      orderedTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priorityScore: task.priorityScore,
        needsHumanReview: task.needsHumanReview,
      })),
      orderedTasks.map((task) => task.title),
      parsed.dependencies,
    ),
  };
}

export async function createSourceAndTasks(payload: PersistSourcePayload) {
  const parsedInput: ParsedSourceInput = {
    type: payload.type,
    rawText: payload.rawText,
    imageDataUrl: payload.imageDataUrl,
    originalFilename: payload.originalFilename,
    activeIdentities: payload.activeIdentities,
  };
  const parsed = await parseSourceIntoTasks(parsedInput);
  const taskInputs = enrichTasksForCreation(parsed);

  return persistSourceAndTaskInputs(payload, parsed, taskInputs);
}

function buildImportSummary(
  tasks: ImportSummaryTaskItem[],
  orderedTitles: string[],
  dependencies: ParsedDependencyInput[],
): ImportSummary {
  const dependencyPairs = dependencies
    .map((dependency) => {
      const predecessorTitle = orderedTitles[dependency.predecessorIndex];
      const successorTitle = orderedTitles[dependency.successorIndex];
      if (!predecessorTitle || !successorTitle) {
        return null;
      }

      return {
        predecessorIndex: dependency.predecessorIndex,
        successorIndex: dependency.successorIndex,
        predecessorTitle,
        successorTitle,
        relationType: dependency.relationType,
      };
    })
    .filter(
      (
        item,
      ): item is {
        predecessorIndex: number;
        successorIndex: number;
        predecessorTitle: string;
        successorTitle: string;
        relationType: "sequence" | "prerequisite" | "blocks";
      } => Boolean(item),
    );

  const urgentTasks = [...tasks]
    .filter((task) => !["done", "ignored"].includes(task.status))
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, 3)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priorityScore: task.priorityScore,
    }));

  const reviewTasks = tasks
    .filter((task) => task.needsHumanReview)
    .slice(0, 3)
    .map((task) => ({
      id: task.id,
      title: task.title,
    }));

  return {
    createdTaskCount: tasks.length,
    urgentTasks,
    reviewTasks,
    dependencyPairs,
  };
}

function buildPreviewTasks(
  taskInputs: CreationTaskInput[],
  dependencies: ParsedDependencyInput[],
  options: { preferStructuredDeadline?: boolean } = {},
): ImportPreviewTask[] {
  const preferStructuredDeadline = options.preferStructuredDeadline ?? false;
  const preparedTasks = taskInputs.map((taskInput) => {
    const normalizedDeadline = normalizeDeadlineInput({
      deadlineISO: taskInput.deadlineISO,
      deadlineText: taskInput.deadlineText,
    }, undefined, { preferStructuredDeadline });
    const waiting = normalizeWaitingReasonInput({
      waitingFor: taskInput.waitingFor,
      waitingReasonType: taskInput.waitingReasonType,
      waitingReasonText: taskInput.waitingReasonText,
      nextCheckAt: taskInput.nextCheckAt,
      dependsOnExternal: taskInput.dependsOnExternal,
    });
    const review = buildReviewState({
      taskType: taskInput.taskType,
      deliveryType: taskInput.deliveryType,
      deadline: normalizedDeadline.deadlineISO,
      deadlineText: normalizedDeadline.deadlineText,
      submitTo: taskInput.submitTo,
      submitChannel: taskInput.submitChannel,
      requiresSignature: taskInput.requiresSignature,
      requiresStamp: taskInput.requiresStamp,
      materials: taskInput.materials,
      dependsOnExternal: taskInput.dependsOnExternal,
      waitingFor: waiting.waitingFor,
      waitingReasonType: waiting.waitingReasonType,
      waitingReasonText: waiting.waitingReasonText,
      nextCheckAt: waiting.nextCheckAt,
      confidence: taskInput.confidence,
      description: taskInput.description,
    });
    const status = resolveStatusForPersistence(
      {
        ...taskInput,
        deadline: normalizedDeadline.deadlineISO,
        deadlineText: normalizedDeadline.deadlineText,
        waitingFor: waiting.waitingFor,
        waitingReasonType: waiting.waitingReasonType,
        waitingReasonText: waiting.waitingReasonText,
        nextCheckAt: waiting.nextCheckAt,
        status: taskInput.status,
      },
      review.needsHumanReview,
    );

    return {
      ...taskInput,
      deadlineISO: normalizedDeadline.deadlineISO,
      deadlineText: normalizedDeadline.deadlineText,
      waitingFor: waiting.waitingFor,
      waitingReasonType: waiting.waitingReasonType,
      waitingReasonText: waiting.waitingReasonText,
      nextCheckAt: waiting.nextCheckAt?.toISOString() ?? null,
      status,
      needsHumanReview: review.needsHumanReview,
      reviewReasons: review.reviewReasons,
    };
  });

  return preparedTasks.map((task, index) => {
    const predecessorLinks = dependencies
      .filter((dependency) => dependency.successorIndex === index)
      .map((dependency) => preparedTasks[dependency.predecessorIndex])
      .filter(Boolean)
      .map((predecessorTask) => ({
        predecessorTask: {
          title: predecessorTask.title,
          status: predecessorTask.status,
        },
      }));
    const blockingPredecessorTitles = getBlockingPredecessorTitles({
      status: task.status,
      predecessorLinks,
    });
    const successorTitles = dependencies
      .filter((dependency) => dependency.predecessorIndex === index)
      .map((dependency) => preparedTasks[dependency.successorIndex]?.title)
      .filter((title): title is string => Boolean(title));
    const displayStatus = getDisplayTaskStatus({
      status: task.status,
      predecessorLinks,
    });
    const priority = calculatePriority({
      id: `preview-${index}`,
      title: task.title,
      status: task.status,
      deadline: task.deadlineISO,
      taskType: task.taskType,
      recurrenceType: task.recurrenceType,
      recurrenceDays: task.recurrenceDays,
      recurrenceTargetCount: task.recurrenceTargetCount,
      recurrenceLimit: task.recurrenceLimit,
      progressLogs: [],
      deliveryType: task.deliveryType,
      requiresSignature: task.requiresSignature,
      requiresStamp: task.requiresStamp,
      dependsOnExternal: task.dependsOnExternal,
      waitingFor: task.waitingFor,
      waitingReasonType: task.waitingReasonType ?? null,
      waitingReasonText: task.waitingReasonText ?? null,
      nextCheckAt: task.nextCheckAt ?? null,
      nextActionSuggestion: task.nextActionSuggestion,
      successorCount: successorTitles.length,
      blockingPredecessorTitles,
    });

    return {
      ...task,
      index,
      displayStatus,
      priorityScore: priority.priorityScore,
      priorityReason: priority.priorityReason,
      blockingPredecessorTitles,
      successorTitles,
    };
  });
}

export async function previewSourceTasks(payload: PersistSourcePayload) {
  const parsedInput: ParsedSourceInput = {
    type: payload.type,
    rawText: payload.rawText,
    imageDataUrl: payload.imageDataUrl,
    originalFilename: payload.originalFilename,
    activeIdentities: payload.activeIdentities,
  };
  const parsed = await parseSourceIntoTasks(parsedInput);
  const taskInputs = enrichTasksForCreation(parsed);
  const previewTasks = buildPreviewTasks(taskInputs, parsed.dependencies, { preferStructuredDeadline: parsed.mode === "openai" });

  return {
    mode: parsed.mode,
    sourceSummary: parsed.sourceSummary,
    tasks: previewTasks,
    dependencies: parsed.dependencies,
    summary: buildImportSummary(
      previewTasks.map((task) => ({
        title: task.title,
        status: task.displayStatus,
        priorityScore: task.priorityScore,
        needsHumanReview: task.needsHumanReview,
      })),
      previewTasks.map((task) => task.title),
      parsed.dependencies,
    ),
  };
}

export async function createSourceAndTasksFromDraft(payload: PersistSourcePayload, draft: ParsedImportDraft) {
  const taskInputs = enrichTasksForCreation({
    mode: draft.mode,
    sourceSummary: draft.sourceSummary,
    tasks: draft.tasks,
    dependencies: draft.dependencies,
  });

  return persistSourceAndTaskInputs(
    payload,
    {
      mode: draft.mode,
      sourceSummary: draft.sourceSummary,
      dependencies: draft.dependencies,
    },
    taskInputs,
  );
}

export async function createAssistantTask(rawText: string, activeIdentities: string[] = []) {
  const compact = rawText.replace(/\s+/g, " ").trim();
  if (!compact) {
    throw new Error("Assistant task text is empty");
  }

  const parsedInput: ParsedSourceInput = {
    type: "text",
    rawText: compact,
    activeIdentities,
  };
  const parsed = await parseSourceIntoTasks(parsedInput);

  const taskInputs =
    parsed.tasks.length > 0
      ? enrichTasksForCreation(parsed)
      : enrichTasksForCreation({
          mode: "fallback",
          sourceSummary: `首页 AI 助手记录：${compact.slice(0, 90)}`,
          tasks: [
            buildAssistantFallbackTask(compact),
          ],
          dependencies: [],
        });

  return persistSourceAndTaskInputs(
    {
      type: "text",
      title: "首页 AI 助手",
      rawText: compact,
      activeIdentities,
    },
    {
      mode: parsed.tasks.length > 0 ? parsed.mode : "fallback",
      sourceSummary: parsed.tasks.length > 0 ? parsed.sourceSummary : `首页 AI 助手记录：${compact.slice(0, 90)}`,
      dependencies: parsed.tasks.length > 0 ? parsed.dependencies : [],
    },
    taskInputs.map((taskInput) => ({
      ...taskInput,
      status: inferTaskStatus({
        confidence: taskInput.confidence,
        deadline: taskInput.deadlineISO,
        deadlineText: taskInput.deadlineText,
        taskType: taskInput.taskType,
        deliveryType: taskInput.deliveryType,
        dependsOnExternal: taskInput.dependsOnExternal,
        waitingFor: taskInput.waitingFor,
        waitingReasonType: taskInput.waitingReasonType ?? null,
        waitingReasonText: taskInput.waitingReasonText ?? null,
        nextCheckAt: taskInput.nextCheckAt ?? null,
      }),
    })),
  );
}

export async function updateTaskCore(taskId: string, data: TaskCoreUpdateInput) {
  await sanitizeTaskJsonColumns();
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!existing) {
    throw new Error(`Task ${taskId} not found`);
  }

  const normalizedDeadline = normalizeDeadlineInput({
    deadlineISO: data.deadline,
    deadlineText: data.deadlineText,
  });
  const waiting = normalizeWaitingReasonInput({
    waitingFor: data.waitingFor,
    waitingReasonType: data.waitingReasonType,
    waitingReasonText: data.waitingReasonText,
    nextCheckAt: data.nextCheckAt,
    dependsOnExternal: data.dependsOnExternal,
  });
  const review = buildReviewState({
    taskType: data.taskType,
    deliveryType: data.deliveryType,
    deadline: normalizedDeadline.deadlineISO,
    deadlineText: normalizedDeadline.deadlineText,
    submitTo: data.submitTo,
    submitChannel: data.submitChannel,
    requiresSignature: data.requiresSignature,
    requiresStamp: data.requiresStamp,
    materials: data.materials,
    dependsOnExternal: data.dependsOnExternal,
    waitingFor: waiting.waitingFor,
    waitingReasonType: waiting.waitingReasonType,
    waitingReasonText: waiting.waitingReasonText,
    nextCheckAt: waiting.nextCheckAt,
    confidence: existing.confidence,
    description: data.description,
  });

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...data,
      applicableIdentities: normalizeApplicableIdentities(data.applicableIdentities),
      identityHint: normalizeIdentityHint(data.identityHint),
      deadline: normalizedDeadline.deadline,
      deadlineText: normalizedDeadline.deadlineText,
      waitingFor: waiting.waitingFor,
      waitingReasonType: waiting.waitingReasonType,
      waitingReasonText: waiting.waitingReasonText,
      nextCheckAt: waiting.nextCheckAt,
      status: resolveStatusForPersistence(
        {
          ...data,
          deadline: normalizedDeadline.deadlineISO,
          deadlineText: normalizedDeadline.deadlineText,
          waitingFor: waiting.waitingFor,
          waitingReasonType: waiting.waitingReasonType,
          waitingReasonText: waiting.waitingReasonText,
          nextCheckAt: waiting.nextCheckAt,
          confidence: existing.confidence,
        },
        review.needsHumanReview,
      ),
      needsHumanReview: review.needsHumanReview,
      reviewResolved: false,
      reviewReasons: review.reviewReasons,
      ...normalizedDeadline.auditRecord,
    },
  });

  await prisma.actionLog.create({
    data: {
      taskId,
      actionType: ActionType.edited,
      note: "用户更新了任务核心字段",
    },
  });

  await recalculateAllPriorities({ taskIds: [taskId] });
  return task;
}

export async function updateTaskStatus(taskId: string, status: TaskStatus, note?: string) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!existing) {
    throw new Error(`Task ${taskId} not found`);
  }

  const normalizedStatus =
    status === "submitted"
      ? normalizeSubmittedStatus({
          confidence: existing.confidence,
          deadline: existing.deadline,
          deadlineText: existing.deadlineText,
          taskType: existing.taskType,
          deliveryType: existing.deliveryType,
          dependsOnExternal: existing.dependsOnExternal,
          waitingFor: existing.waitingFor,
          waitingReasonType: existing.waitingReasonType,
          waitingReasonText: existing.waitingReasonText,
          nextCheckAt: existing.nextCheckAt,
        })
      : status;

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: normalizedStatus,
      ...(normalizedStatus === "ignored"
        ? {
            needsHumanReview: false,
            reviewResolved: true,
            reviewReasons: [],
          }
        : {}),
    },
  });

  await prisma.actionLog.create({
    data: {
      taskId,
      actionType: normalizedStatus === "ignored" ? ActionType.ignored : ActionType.status_changed,
      note: note ?? `状态更新为 ${normalizedStatus}`,
    },
  });

  await recalculateAllPriorities({ taskIds: [taskId] });
  return task;
}

export async function deleteTask(taskId: string) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      sourceId: true,
    },
  });

  if (!existing) {
    throw new Error(`Task ${taskId} not found`);
  }

  const relatedDependencies = await prisma.dependency.findMany({
    where: {
      OR: [{ predecessorTaskId: taskId }, { successorTaskId: taskId }],
    },
    select: {
      predecessorTaskId: true,
      successorTaskId: true,
    },
  });
  const predecessorIds = [
    ...new Set(relatedDependencies.filter((item) => item.successorTaskId === taskId).map((item) => item.predecessorTaskId)),
  ];
  const directSuccessorIds = [
    ...new Set(relatedDependencies.filter((item) => item.predecessorTaskId === taskId).map((item) => item.successorTaskId)),
  ];

  await prisma.task.delete({
    where: { id: taskId },
  });

  const impactedSuccessorIds = directSuccessorIds.length > 0 ? await expandImpactedTaskIds(directSuccessorIds) : [];
  const impactedTaskIds = [...new Set([...predecessorIds, ...impactedSuccessorIds])];

  if (impactedTaskIds.length > 0) {
    await recalculateAllPriorities({
      taskIds: impactedTaskIds,
      expandSuccessors: false,
    });
  } else {
    await refreshDashboardFocusSummary();
  }

  return existing;
}

async function removeUploadedSourceFile(filePath: string | null | undefined) {
  if (!filePath?.startsWith("/uploads/")) {
    return;
  }

  const absolutePath = path.join(process.cwd(), "public", filePath);
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function deleteSource(sourceId: string) {
  const existing = await prisma.source.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      filePath: true,
    },
  });

  if (!existing) {
    throw new Error(`Source ${sourceId} not found`);
  }

  const sourceTasks = await prisma.task.findMany({
    where: { sourceId },
    select: { id: true },
  });
  const deletedTaskIds = sourceTasks.map((task) => task.id);
  const deletedTaskIdSet = new Set(deletedTaskIds);

  const relatedDependencies =
    deletedTaskIds.length > 0
      ? await prisma.dependency.findMany({
          where: {
            OR: [{ predecessorTaskId: { in: deletedTaskIds } }, { successorTaskId: { in: deletedTaskIds } }],
          },
          select: {
            predecessorTaskId: true,
            successorTaskId: true,
          },
        })
      : [];
  const predecessorIds = [
    ...new Set(
      relatedDependencies
        .filter((item) => deletedTaskIdSet.has(item.successorTaskId) && !deletedTaskIdSet.has(item.predecessorTaskId))
        .map((item) => item.predecessorTaskId),
    ),
  ];
  const directSuccessorIds = [
    ...new Set(
      relatedDependencies
        .filter((item) => deletedTaskIdSet.has(item.predecessorTaskId) && !deletedTaskIdSet.has(item.successorTaskId))
        .map((item) => item.successorTaskId),
    ),
  ];

  await prisma.source.delete({
    where: { id: sourceId },
  });

  await removeUploadedSourceFile(existing.filePath);

  const impactedSuccessorIds = directSuccessorIds.length > 0 ? await expandImpactedTaskIds(directSuccessorIds) : [];
  const impactedTaskIds = [...new Set([...predecessorIds, ...impactedSuccessorIds])];

  if (impactedTaskIds.length > 0) {
    await recalculateAllPriorities({
      taskIds: impactedTaskIds,
      expandSuccessors: false,
    });
  } else {
    await refreshDashboardFocusSummary();
  }

  return existing;
}

export async function recordTaskProgress(taskId: string) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!existing) {
    throw new Error(`Task ${taskId} not found`);
  }

  await prisma.taskProgressLog.create({
    data: {
      taskId,
    },
  });

  await prisma.actionLog.create({
    data: {
      taskId,
      actionType: ActionType.edited,
      note: "记录了一次完成进度",
    },
  });

  await recalculateAllPriorities({ taskIds: [taskId] });
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      progressLogs: {
        orderBy: { completedAt: "desc" },
      },
    },
  });
}

export async function undoTaskProgress(taskId: string) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      progressLogs: {
        orderBy: { completedAt: "desc" },
      },
    },
  });

  if (!existing) {
    throw new Error(`Task ${taskId} not found`);
  }

  const currentCycleLogIds = getCurrentCycleLogIds(existing);
  if (currentCycleLogIds.length === 0) {
    return existing;
  }

  await prisma.taskProgressLog.delete({
    where: { id: currentCycleLogIds[0] },
  });

  await prisma.actionLog.create({
    data: {
      taskId,
      actionType: ActionType.edited,
      note: "撤回了一次完成进度",
    },
  });

  await recalculateAllPriorities({ taskIds: [taskId] });
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      progressLogs: {
        orderBy: { completedAt: "desc" },
      },
    },
  });
}

export async function resetTaskProgressCycle(taskId: string) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      progressLogs: {
        orderBy: { completedAt: "desc" },
      },
    },
  });

  if (!existing) {
    throw new Error(`Task ${taskId} not found`);
  }

  const currentCycleLogIds = getCurrentCycleLogIds(existing);
  if (currentCycleLogIds.length === 0) {
    return existing;
  }

  await prisma.taskProgressLog.deleteMany({
    where: {
      id: {
        in: currentCycleLogIds,
      },
    },
  });

  await prisma.actionLog.create({
    data: {
      taskId,
      actionType: ActionType.edited,
      note: "重置了当前一轮的完成进度",
    },
  });

  await recalculateAllPriorities({ taskIds: [taskId] });
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      progressLogs: {
        orderBy: { completedAt: "desc" },
      },
    },
  });
}

export async function scheduleTaskFollowUp(taskId: string, preset: WaitingFollowUpPreset, note?: string) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!existing) {
    throw new Error(`Task ${taskId} not found`);
  }

  const nextCheckAt = resolveWaitingFollowUpPreset(preset);
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "waiting",
      nextCheckAt,
    },
  });

  const label = preset === "tonight" ? "今晚" : preset === "tomorrow" ? "明天" : "下周";
  await prisma.actionLog.create({
    data: {
      taskId,
      actionType: ActionType.edited,
      note: note ?? `用户已跟进，设置为 ${label} 再回看`,
    },
  });

  await recalculateAllPriorities({ taskIds: [taskId] });
  return task;
}

export async function resolveTaskReview(taskId: string, note?: string) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!existing) {
    throw new Error(`Task ${taskId} not found`);
  }

  const nextStatus =
    existing.status === "needs_review"
      ? inferConfirmedTaskStatus({
          confidence: existing.confidence,
          deadline: existing.deadline,
          deadlineText: existing.deadlineText,
          taskType: existing.taskType,
          deliveryType: existing.deliveryType,
          dependsOnExternal: existing.dependsOnExternal,
          waitingFor: existing.waitingFor,
          waitingReasonType: existing.waitingReasonType,
          waitingReasonText: existing.waitingReasonText,
          nextCheckAt: existing.nextCheckAt,
        })
      : existing.status;

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      needsHumanReview: false,
      reviewResolved: true,
      reviewReasons: [],
      status: nextStatus,
    },
  });

  await prisma.actionLog.create({
    data: {
      taskId,
      actionType: ActionType.edited,
      note: note ?? "用户确认了解析结果，任务退出待确认队列",
    },
  });

  await recalculateAllPriorities({ taskIds: [taskId] });
  return task;
}

export async function restoreTaskAssistantSnapshot(input: {
  taskId: string;
  status: TaskStatus;
  needsHumanReview: boolean;
  reviewResolved: boolean;
  reviewReasons: string[];
  waitingFor: string | null;
  waitingReasonType: string | null;
  waitingReasonText: string | null;
  nextCheckAt: string | Date | null;
}) {
  const existing = await prisma.task.findUnique({
    where: { id: input.taskId },
  });

  if (!existing) {
    throw new Error(`Task ${input.taskId} not found`);
  }

  const restored = await prisma.task.update({
    where: { id: input.taskId },
    data: {
      status: input.status,
      needsHumanReview: input.needsHumanReview,
      reviewResolved: input.reviewResolved,
      reviewReasons: input.reviewReasons,
      waitingFor: input.waitingFor,
      waitingReasonType: input.waitingReasonType,
      waitingReasonText: input.waitingReasonText,
      nextCheckAt: input.nextCheckAt,
    },
  });

  await prisma.actionLog.create({
    data: {
      taskId: input.taskId,
      actionType: ActionType.edited,
      note: "撤销了首页 AI 助手的任务字段修改",
    },
  });

  await recalculateAllPriorities({ taskIds: [input.taskId] });
  return restored;
}

export async function restoreTaskProgressLogs(taskId: string, completedAts: Array<string | Date>) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!existing) {
    throw new Error(`Task ${taskId} not found`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskProgressLog.deleteMany({
      where: { taskId },
    });

    if (completedAts.length > 0) {
      await tx.taskProgressLog.createMany({
        data: completedAts.map((completedAt) => ({
          taskId,
          completedAt,
        })),
      });
    }

    await tx.actionLog.create({
      data: {
        taskId,
        actionType: ActionType.edited,
        note: "撤销了首页 AI 助手的进度变更",
      },
    });
  });

  await recalculateAllPriorities({ taskIds: [taskId] });

  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      progressLogs: {
        orderBy: { completedAt: "desc" },
      },
    },
  });
}

type DashboardDataSection = "all" | "overview" | "today" | "courses" | "tasks" | "sources" | "settings";

export async function getDashboardData(filter = "all", options?: { section?: DashboardDataSection }) {
  try {
    await sanitizeTaskJsonColumns();
    const section = options?.section ?? "all";
    const needsTaskData = ["all", "overview", "today", "tasks", "settings"].includes(section);
    const needsRichTaskData = ["all", "tasks"].includes(section);
    const needsBlockingContext = ["all", "overview", "today"].includes(section);
    const needsRecentSources = ["all", "sources"].includes(section);

    const settings = await readAppSettingsRecord();
    let rawTasks: DashboardTaskRecord[] = [];
    if (needsTaskData) {
      if (needsRichTaskData) {
        rawTasks = await prisma.task.findMany({
          include: {
            progressLogs: {
              orderBy: { completedAt: "desc" },
            },
            source: true,
            successorLinks: true,
            predecessorLinks: {
              include: {
                predecessorTask: true,
              },
            },
          },
          orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
        });
      } else if (needsBlockingContext) {
        rawTasks = await prisma.task.findMany({
          include: {
            predecessorLinks: {
              include: {
                predecessorTask: {
                  select: {
                    id: true,
                    title: true,
                    status: true,
                  },
                },
              },
            },
          },
          orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
        });
      } else {
        rawTasks = await prisma.task.findMany({
          orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
        });
      }
    }

    const tasks = rawTasks.map((task) => decorateTaskBlockingState(task));
    const activeIdentities = normalizeActiveIdentities(
      Array.isArray(settings.activeIdentities) && settings.activeIdentities.length > 0 ? settings.activeIdentities : settings.activeIdentity ? [settings.activeIdentity] : [],
    );
    const matchedIdentityTasks = tasks.filter((task) => matchesActiveIdentities(task, activeIdentities));
    const unmatchedIdentityTasks = tasks.filter((task) => !matchesActiveIdentities(task, activeIdentities));

    const recentSources = needsRecentSources
      ? await prisma.source.findMany({
          orderBy: { createdAt: "desc" },
          take: 6,
          include: {
            tasks: true,
          },
        })
      : [];

    const reviewTasks = [...matchedIdentityTasks.filter((task) => task.needsHumanReview), ...unmatchedIdentityTasks.filter((task) => task.needsHumanReview)];
    const blockedTasks = [
      ...matchedIdentityTasks.filter((task) => task.isBlockedByPredecessor),
      ...unmatchedIdentityTasks.filter((task) => task.isBlockedByPredecessor),
    ];
    const actionable = [
      ...matchedIdentityTasks.filter((task) => !task.needsHumanReview && !task.isBlockedByPredecessor && !["waiting", "submitted", "done", "ignored"].includes(task.status)),
      ...unmatchedIdentityTasks.filter((task) => !task.needsHumanReview && !task.isBlockedByPredecessor && !["waiting", "submitted", "done", "ignored"].includes(task.status)),
    ];
    const currentBestTask = actionable[0] ?? null;
    const topTasksForToday = actionable
      .filter((task) => task.priorityScore >= 40 || ["pending_submit", "overdue"].includes(task.status))
      .slice(0, 3);
    const waitingTasks = [
      ...matchedIdentityTasks.filter((task) => task.status === "waiting"),
      ...unmatchedIdentityTasks.filter((task) => task.status === "waiting"),
    ].slice(0, 6);
    const dueWaitingTasks = tasks
      .filter((task) => task.status === "waiting" && task.nextCheckAt && new Date(task.nextCheckAt).getTime() <= Date.now())
      .sort((left, right) => {
        const identityDelta = Number(matchesActiveIdentities(right, activeIdentities)) - Number(matchesActiveIdentities(left, activeIdentities));
        if (identityDelta !== 0) {
          return identityDelta;
        }
        return new Date(left.nextCheckAt!).getTime() - new Date(right.nextCheckAt!).getTime();
      })
      .slice(0, 6);
    const todayBuckets = buildTodayBuckets(tasks);

    let filteredTasks = tasks;
    if (filter === "actionable") {
      filteredTasks = actionable;
    } else if (filter === "review") {
      filteredTasks = reviewTasks;
    } else if (filter === "waiting") {
      filteredTasks = waitingTasks;
    } else if (filter === "risk") {
      filteredTasks = tasks.filter((task) => task.status === "overdue" || task.priorityScore >= 50);
    }

    const grouped = filteredTasks.reduce<Record<string, typeof tasks>>((acc, task) => {
      const groupKey = task.displayStatus;
      if (!acc[groupKey]) {
        acc[groupKey] = [];
      }
      acc[groupKey].push(task);
      return acc;
    }, {});

    return {
      tasks,
      activeIdentity: activeIdentities[0] ?? null,
      activeIdentities,
      matchedIdentityTasks,
      blockedTasks,
      filteredTasks,
      grouped,
      currentBestTask,
      topTasksForToday,
      reviewTasks,
      waitingTasks,
      dueWaitingTasks,
      todayMustDoTasks: todayBuckets.mustDo,
      todayReminderTasks: todayBuckets.reminderQueue,
      todayShouldDoTasks: todayBuckets.shouldDo,
      todayCanWaitTasks: todayBuckets.canWait,
      recentSources,
      databaseReady: true,
    };
  } catch (error) {
    if (!isDatabaseNotReadyError(error)) {
      throw error;
    }

    return {
      tasks: [],
      activeIdentity: null,
      activeIdentities: [],
      matchedIdentityTasks: [],
      blockedTasks: [],
      filteredTasks: [],
      grouped: {},
      currentBestTask: null,
      topTasksForToday: [],
      reviewTasks: [],
      waitingTasks: [],
      dueWaitingTasks: [],
      todayMustDoTasks: [],
      todayReminderTasks: [],
      todayShouldDoTasks: [],
      todayCanWaitTasks: [],
      recentSources: [],
      databaseReady: false,
    };
  }
}

export async function getTaskById(taskId: string) {
  try {
    await sanitizeTaskJsonColumns();
    return await prisma.task
      .findUnique({
      where: { id: taskId },
      include: {
        progressLogs: {
          orderBy: { completedAt: "desc" },
        },
        source: true,
        successorLinks: {
          include: {
            successorTask: true,
          },
        },
        predecessorLinks: {
          include: {
            predecessorTask: true,
          },
        },
        actionLogs: {
          orderBy: { createdAt: "desc" },
        },
      },
      })
      .then((task) => (task ? decorateTaskBlockingState(task) : null));
  } catch (error) {
    if (isDatabaseNotReadyError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getSourceById(sourceId: string) {
  try {
    await sanitizeTaskJsonColumns();
    return await prisma.source
      .findUnique({
      where: { id: sourceId },
      include: {
        tasks: {
          include: {
            progressLogs: {
              orderBy: { completedAt: "desc" },
            },
            successorLinks: true,
            predecessorLinks: {
              include: {
                predecessorTask: true,
              },
            },
          },
          orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
        },
      },
      })
      .then((source) =>
        source
          ? {
              ...source,
              tasks: source.tasks.map((task) => decorateTaskBlockingState(task)),
            }
          : null,
      );
  } catch (error) {
    if (isDatabaseNotReadyError(error)) {
      return null;
    }
    throw error;
  }
}
