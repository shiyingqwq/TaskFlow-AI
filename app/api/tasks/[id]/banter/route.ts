import { NextResponse } from "next/server";

import { getTaskById } from "@/lib/server/tasks";
import { generateTaskBanter } from "@/lib/task-banter";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTaskById(id);

  if (!task) {
    return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  }

  const banter = await generateTaskBanter({
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

  return NextResponse.json(banter);
}
