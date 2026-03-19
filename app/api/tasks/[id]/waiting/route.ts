import { NextResponse } from "next/server";
import { z } from "zod";

import { scheduleTaskFollowUp } from "@/lib/server/tasks";

const waitingSchema = z.object({
  preset: z.enum(["tonight", "tomorrow", "next_week"]),
  note: z.string().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = waitingSchema.parse(await request.json());
  const updated = await scheduleTaskFollowUp(id, body.preset, body.note);
  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    nextCheckAt: updated.nextCheckAt,
  });
}
