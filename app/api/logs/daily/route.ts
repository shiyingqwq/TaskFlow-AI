import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrGenerateDailyLog, saveDailyLogSnapshot } from "@/lib/server/daily-log";
import { nowInTaipei } from "@/lib/time";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["brief", "full"]).default("brief"),
  refresh: z.coerce.boolean().optional().default(false),
});

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["brief", "full"]),
  text: z.string().min(1, "日志内容不能为空"),
  meta: z.object({
    actionCount: z.number().int().nonnegative().default(0),
    touchedTaskCount: z.number().int().nonnegative().default(0),
    riskCount: z.number().int().nonnegative().default(0),
    waitingOrBlockedCount: z.number().int().nonnegative().default(0),
  }),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get("date") ?? nowInTaipei().format("YYYY-MM-DD"),
    mode: url.searchParams.get("mode") ?? "brief",
    refresh: url.searchParams.get("refresh") === "1" || url.searchParams.get("refresh") === "true",
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "参数不合法，请使用 ?date=YYYY-MM-DD&mode=brief|full",
      },
      { status: 400 },
    );
  }

  const result = await getOrGenerateDailyLog(parsed.data);
  return NextResponse.json({
    date: parsed.data.date,
    mode: parsed.data.mode,
    ...result,
  });
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "参数不合法，请检查 date/mode/text/meta",
      },
      { status: 400 },
    );
  }

  const saved = await saveDailyLogSnapshot(parsed.data);
  return NextResponse.json({
    ok: true,
    saved,
  });
}
