import { NextResponse } from "next/server";
import { z } from "zod";

import { fixTaskStartDeadlineConflict } from "@/lib/server/tasks";

const requestSchema = z.object({
  fixes: z.array(
    z.object({
      type: z.literal("start_after_deadline"),
      taskId: z.string().min(1),
      minimumBufferMinutes: z.number().int().min(10).max(480).optional(),
    }),
  ).max(20),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const results = await Promise.all(
      body.fixes.map((item) => fixTaskStartDeadlineConflict(item.taskId, item.minimumBufferMinutes ?? 20)),
    );

    return NextResponse.json({
      results,
      fixedCount: results.filter((item) => item.fixed).length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "排程修复失败。" },
      { status: 400 },
    );
  }
}

