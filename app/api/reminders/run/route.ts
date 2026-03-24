import { NextResponse } from "next/server";
import { z } from "zod";

import { runReminderCycle } from "@/lib/server/reminders";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    dryRun: z.boolean().optional(),
    atAll: z.boolean().optional(),
  })
  .optional();

function authorize(request: Request) {
  const requiredToken = (process.env.REMINDER_RUN_TOKEN ?? "").trim();
  if (!requiredToken) {
    return true;
  }
  const token = request.headers.get("x-reminder-token")?.trim();
  return token === requiredToken;
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
      },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const atAll = url.searchParams.get("atAll") === "1";

  try {
    const result = await runReminderCycle({ dryRun, atAll });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "提醒任务执行失败。",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
      },
      { status: 401 },
    );
  }

  try {
    const body = bodySchema.parse(await request.json().catch(() => undefined));
    const result = await runReminderCycle({
      dryRun: body?.dryRun ?? false,
      atAll: body?.atAll ?? false,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "提醒任务执行失败。",
      },
      { status },
    );
  }
}

