import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteTask, updateTaskCore } from "@/lib/server/tasks";

const updateSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  submitTo: z.string().nullable().optional(),
  submitChannel: z.string().nullable().optional(),
  applicableIdentities: z.array(z.string()),
  identityHint: z.string().nullable().optional(),
  recurrenceType: z.enum(["single", "daily", "weekly", "limited"]),
  recurrenceDays: z.array(z.number().int().min(0).max(6)),
  recurrenceTargetCount: z.number().int().min(1),
  recurrenceLimit: z.number().int().min(1).nullable().optional(),
  deadlineText: z.string().nullable().optional(),
  deadlineISO: z.string().datetime().nullable().optional(),
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
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = updateSchema.parse(await request.json());
  const updated = await updateTaskCore(id, {
    title: body.title,
    description: body.description,
    submitTo: body.submitTo || null,
    submitChannel: body.submitChannel || null,
    applicableIdentities: body.applicableIdentities,
    identityHint: body.identityHint || null,
    recurrenceType: body.recurrenceType,
    recurrenceDays: body.recurrenceDays,
    recurrenceTargetCount: body.recurrenceTargetCount,
    recurrenceLimit: body.recurrenceLimit ?? null,
    deadlineText: body.deadlineText || null,
    deadline: body.deadlineISO ? new Date(body.deadlineISO) : null,
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
