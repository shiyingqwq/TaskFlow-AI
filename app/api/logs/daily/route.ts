import { NextResponse } from "next/server";
import { z } from "zod";

import { generateDailyLog } from "@/lib/server/daily-log";
import { nowInTaipei } from "@/lib/time";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["brief", "full"]).default("brief"),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get("date") ?? nowInTaipei().format("YYYY-MM-DD"),
    mode: url.searchParams.get("mode") ?? "brief",
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "参数不合法，请使用 ?date=YYYY-MM-DD&mode=brief|full",
      },
      { status: 400 },
    );
  }

  const result = await generateDailyLog(parsed.data);
  return NextResponse.json({
    date: parsed.data.date,
    mode: parsed.data.mode,
    ...result,
  });
}

