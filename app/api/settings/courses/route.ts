import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizeCourseSchedule, normalizeCourseTableConfig } from "@/lib/course-schedule";
import { getAppSettings, updateCourseSchedule } from "@/lib/server/app-settings";

const courseSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
  location: z.string().trim().nullable().optional(),
});

const bodySchema = z.object({
  courseSchedule: z.array(courseSchema),
  courseTableConfig: z
    .object({
      currentTerm: z.enum(["spring", "autumn"]).optional(),
      spring: z.object({ dayStart: z.string().optional(), dayEnd: z.string().optional() }).optional(),
      autumn: z.object({ dayStart: z.string().optional(), dayEnd: z.string().optional() }).optional(),
      slotMinutes: z.number().int().optional(),
    })
    .optional(),
});

export async function GET() {
  const settings = await getAppSettings();
  const courseSchedule = normalizeCourseSchedule(settings.courseSchedule);
  return NextResponse.json({
    courseSchedule,
    courseTableConfig: normalizeCourseTableConfig(settings.courseTableConfig),
  });
}

export async function PATCH(request: Request) {
  const body = bodySchema.parse(await request.json());
  const normalized = normalizeCourseSchedule(body.courseSchedule);
  const normalizedTableConfig = normalizeCourseTableConfig(body.courseTableConfig);
  const settings = await updateCourseSchedule({
    courseSchedule: normalized,
    courseTableConfig: normalizedTableConfig,
  });
  return NextResponse.json({
    courseSchedule: normalizeCourseSchedule(settings.courseSchedule),
    courseTableConfig: normalizeCourseTableConfig(settings.courseTableConfig),
  });
}
