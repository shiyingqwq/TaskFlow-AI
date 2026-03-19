import { NextResponse } from "next/server";
import { z } from "zod";

import { handleHomeAssistantMessage } from "@/lib/home-assistant";

const pendingActionSchema = z.union([
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
]);

const historyItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const requestSchema = z.object({
  message: z.string().min(1),
  history: z.array(historyItemSchema).max(12).optional(),
  context: z
    .object({
      lastReferencedTaskId: z.string().nullable().optional(),
      pendingAction: pendingActionSchema.nullable().optional(),
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
