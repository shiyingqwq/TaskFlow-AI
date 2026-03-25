import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteTask, updateTaskCore } from "@/lib/server/tasks";

const updateSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  startAtISO: z.string().datetime().nullable().optional(),
  submitTo: z.string().nullable().optional(),
  submitChannel: z.string().nullable().optional(),
  applicableIdentities: z.array(z.string()),
  identityHint: z.string().nullable().optional(),
  recurrenceType: z.enum(["single", "daily", "weekly", "limited"]),
  recurrenceDays: z.array(z.number().int().min(0).max(6)),
  recurrenceTargetCount: z.number().int().min(1),
  recurrenceLimit: z.number().int().min(1).nullable().optional(),
  recurrenceStartISO: z.string().datetime().nullable().optional(),
  recurrenceUntilISO: z.string().datetime().nullable().optional(),
  recurrenceMaxOccurrences: z.number().int().min(1).nullable().optional(),
  deadlineText: z.string().nullable().optional(),
  deadlineISO: z.string().datetime().nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  snoozeUntilISO: z.string().datetime().nullable().optional(),
  deliveryType: z.enum(["electronic", "paper", "both", "unknown"]),
  requiresSignature: z.boolean(),
  requiresStamp: z.boolean(),
  dependsOnExternal: z.boolean(),
  waitingFor: z.string().nullable().optional(),
  waitingReasonType: z.string().nullable().optional(),
  waitingReasonText: z.string().nullable().optional(),
  nextCheckAt: z.string().datetime().nullable().optional(),
  nextActionSuggestion: z.string().min(1),
  estimatedMinutes: z.number().int().min(10).max(480).nullable().optional(),
  status: z.enum(["needs_review", "ready", "waiting", "in_progress", "pending_submit", "submitted", "done", "overdue", "ignored"]),
  materials: z.array(z.string()),
  taskType: z.enum(["submission", "collection", "communication", "offline", "production", "followup"]),
}).superRefine((value, ctx) => {
  const startAt = value.startAtISO ? new Date(value.startAtISO) : null;
  const deadline = value.deadlineISO ? new Date(value.deadlineISO) : null;
  if (startAt && deadline && startAt.getTime() > deadline.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "开始时间不能晚于截止时间。",
      path: ["startAtISO"],
    });
  }

  const recurrenceStart = value.recurrenceStartISO ? new Date(value.recurrenceStartISO) : null;
  const recurrenceUntil = value.recurrenceUntilISO ? new Date(value.recurrenceUntilISO) : null;
  if (recurrenceStart && recurrenceUntil && recurrenceStart.getTime() > recurrenceUntil.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "重复开始时间不能晚于重复截止时间。",
      path: ["recurrenceStartISO"],
    });
  }
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = updateSchema.parse(await request.json());
  const updated = await updateTaskCore(id, {
    title: body.title,
    description: body.description,
    startAt: body.startAtISO ? new Date(body.startAtISO) : null,
    submitTo: body.submitTo || null,
    submitChannel: body.submitChannel || null,
    applicableIdentities: body.applicableIdentities,
    identityHint: body.identityHint || null,
    recurrenceType: body.recurrenceType,
    recurrenceDays: body.recurrenceDays,
    recurrenceTargetCount: body.recurrenceTargetCount,
    recurrenceLimit: body.recurrenceLimit ?? null,
    recurrenceStartAt: body.recurrenceStartISO ? new Date(body.recurrenceStartISO) : null,
    recurrenceUntil: body.recurrenceUntilISO ? new Date(body.recurrenceUntilISO) : null,
    recurrenceMaxOccurrences: body.recurrenceMaxOccurrences ?? null,
    deadlineText: body.deadlineText || null,
    deadline: body.deadlineISO ? new Date(body.deadlineISO) : null,
    timezone: body.timezone?.trim() || "Asia/Shanghai",
    snoozeUntil: body.snoozeUntilISO ? new Date(body.snoozeUntilISO) : null,
    deliveryType: body.deliveryType,
    requiresSignature: body.requiresSignature,
    requiresStamp: body.requiresStamp,
    waitingFor: body.waitingFor || null,
    waitingReasonType: body.waitingReasonType || null,
    waitingReasonText: body.waitingReasonText || null,
    nextCheckAt: body.nextCheckAt ? new Date(body.nextCheckAt) : null,
    nextActionSuggestion: body.nextActionSuggestion,
    estimatedMinutes: body.estimatedMinutes ?? null,
    status: body.status,
    materials: body.materials,
    taskType: body.taskType,
    dependsOnExternal: body.dependsOnExternal,
  });

  return NextResponse.json({ id: updated.id });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = await deleteTask(id);
  return NextResponse.json({
    id: deleted.id,
    sourceId: deleted.sourceId,
  });
}
