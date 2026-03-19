import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTaskReview } from "@/lib/server/tasks";

const reviewSchema = z.object({
  note: z.string().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = reviewSchema.parse(await request.json().catch(() => ({})));
  const updated = await resolveTaskReview(id, body.note);
  return NextResponse.json({ id: updated.id, status: updated.status, needsHumanReview: updated.needsHumanReview });
}
