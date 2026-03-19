import { NextResponse } from "next/server";
import { z } from "zod";

import { recordTaskProgress, resetTaskProgressCycle, undoTaskProgress } from "@/lib/server/tasks";

const progressSchema = z.object({
  action: z.enum(["increment", "decrement", "reset"]),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = progressSchema.parse(await request.json());

  const updated =
    body.action === "increment"
      ? await recordTaskProgress(id)
      : body.action === "decrement"
        ? await undoTaskProgress(id)
        : await resetTaskProgressCycle(id);

  return NextResponse.json({
    id: updated?.id,
    progressCount: updated?.progressLogs.length ?? 0,
  });
}
