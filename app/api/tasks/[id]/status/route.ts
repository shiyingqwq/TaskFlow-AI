import { NextResponse } from "next/server";
import { z } from "zod";

import { updateTaskStatus } from "@/lib/server/tasks";

const statusSchema = z.object({
  status: z.enum(["needs_review", "ready", "waiting", "in_progress", "pending_submit", "submitted", "done", "overdue", "ignored"]),
  note: z.string().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = statusSchema.parse(await request.json());
  const updated = await updateTaskStatus(id, body.status, body.note);
  return NextResponse.json({ id: updated.id, status: updated.status });
}
