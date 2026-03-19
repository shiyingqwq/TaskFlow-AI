import { NextResponse } from "next/server";
import { z } from "zod";

import { sendDingtalkText } from "@/lib/server/dingtalk";

export const runtime = "nodejs";

const schema = z.object({
  text: z.string().trim().min(1, "text 不能为空").max(4000, "text 太长"),
  atAll: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const result = await sendDingtalkText(body.text, { atAll: body.atAll });
    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "钉钉消息发送失败。";
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}
