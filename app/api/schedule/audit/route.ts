import { NextResponse } from "next/server";
import { z } from "zod";

import { generateScheduleAuditSummary } from "@/lib/schedule-audit";

const requestSchema = z.object({
  dateLabel: z.string().min(1),
  lintIssues: z.array(z.string().min(1)).max(12),
  courses: z.array(z.object({
    title: z.string().min(1),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  })).max(24),
  slots: z.array(
    z.object({
      label: z.string().min(1),
      period: z.string().min(1),
      tasks: z.array(
        z.object({
          title: z.string().min(1),
          status: z.string().min(1),
          deadlineLabel: z.string().min(1),
          estimateMinutes: z.number().int().min(10).max(480),
        }),
      ).max(4),
    }),
  ).max(12),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const summary = await generateScheduleAuditSummary(body);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "排程审核失败。" },
      { status: 400 },
    );
  }
}
