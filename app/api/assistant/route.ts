import { NextResponse } from "next/server";
import { z } from "zod";

import { handleHomeAssistantMessage } from "@/lib/home-assistant";

const plannedActionSchema = z.union([
  z.object({
    type: z.literal("update_status"),
    taskId: z.string(),
    status: z.enum(["needs_review", "ready", "waiting", "in_progress", "pending_submit", "submitted", "done", "overdue", "ignored"]),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal("resolve_review"),
    taskId: z.string(),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal("schedule_follow_up"),
    taskId: z.string(),
    preset: z.enum(["tonight", "tomorrow", "next_week"]),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal("record_progress"),
    taskId: z.string(),
    mode: z.enum(["increment", "decrement", "reset"]),
  }),
  z.object({
    type: z.literal("create_task"),
    sourceText: z.string(),
  }),
  z.object({
    type: z.literal("delete_task"),
    taskId: z.string(),
  }),
  z.object({
    type: z.literal("auto_fix_time_semantics"),
  }),
  z.object({
    type: z.literal("update_task_core"),
    taskId: z.string(),
    patch: z.record(z.string(), z.any()),
  }),
]);

const pendingActionSchema = z.object({
  type: z.literal("confirm_actions"),
  actions: z.array(plannedActionSchema),
  previewText: z.string(),
  impacts: z.array(
    z.object({
      taskId: z.string(),
      taskTitle: z.string(),
      changedFields: z.array(z.string()),
    }),
  ),
});

const undoActionSchema = z.object({
  type: z.literal("undo_actions"),
  actions: z.array(
    z.union([
      z.object({
        type: z.literal("restore_task_snapshot"),
        snapshot: z.object({
          taskId: z.string(),
          taskTitle: z.string(),
          status: z.enum(["needs_review", "ready", "waiting", "in_progress", "pending_submit", "submitted", "done", "overdue", "ignored"]),
          needsHumanReview: z.boolean(),
          reviewResolved: z.boolean(),
          reviewReasons: z.array(z.string()),
          waitingFor: z.string().nullable(),
          waitingReasonType: z.string().nullable(),
          waitingReasonText: z.string().nullable(),
          nextCheckAt: z.string().nullable(),
        }),
      }),
      z.object({
        type: z.literal("restore_progress_logs"),
        taskId: z.string(),
        taskTitle: z.string(),
        completedAts: z.array(z.string()),
      }),
      z.object({
        type: z.literal("delete_source"),
        sourceId: z.string(),
        sourceLabel: z.string(),
      }),
    ]),
  ),
  summary: z.string().optional(),
});

const historyItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const clarifyStateSchema = z.union([
  z.object({
    type: z.literal("arrange_task_time"),
    taskId: z.string().nullable().optional(),
    hour: z.number().int().min(0).max(23).nullable().optional(),
    minute: z.number().int().min(0).max(59).nullable().optional(),
    turns: z.number().int().min(0).max(5).optional(),
  }),
  z.object({
    type: z.literal("create_task_deadline_time"),
    sourceText: z.string().min(1),
    dayHint: z.enum(["today", "tomorrow"]),
    turns: z.number().int().min(0).max(5).optional(),
  }),
  z.object({
    type: z.literal("create_task_batch_execution_time"),
    courseTitles: z.array(z.string().min(1)).min(1).max(8),
    turns: z.number().int().min(0).max(5).optional(),
  }),
]);

const requestSchema = z.object({
  message: z.string().min(1),
  history: z.array(historyItemSchema).max(12).optional(),
  context: z
    .object({
      lastReferencedTaskId: z.string().nullable().optional(),
      pendingAction: pendingActionSchema.nullable().optional(),
      undoAction: undoActionSchema.nullable().optional(),
      clarifyState: clarifyStateSchema.nullable().optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const result = await handleHomeAssistantMessage({
    message: body.message,
    history: body.history ?? [],
    context: body.context,
  });

  return NextResponse.json(result);
}
