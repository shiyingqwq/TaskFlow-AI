import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

import { getAiRuntimeConfig } from "@/lib/server/app-settings";

const bodySchema = z.object({
  text: z.string().min(1, "日志内容不能为空"),
  style: z.enum(["formal", "casual", "report"]).default("report"),
});

function stylePrompt(style: "formal" | "casual" | "report") {
  if (style === "formal") {
    return "正式、稳重、简洁，适合发给老师或行政对象。";
  }
  if (style === "casual") {
    return "自然、直接、口语化一点，适合同学或小组同步。";
  }
  return "汇报体，条理清晰，适合上级阅读。";
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法，请检查 text/style" }, { status: 400 });
  }

  const config = await getAiRuntimeConfig();
  if (!config) {
    return NextResponse.json({ error: "未配置可用 AI，无法进行润色。" }, { status: 400 });
  }

  try {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });

    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            "你是中文工作日志润色助手。只允许改写表达方式和结构，不得新增、删减或篡改事实信息（任务名、时间、状态、数量、结论）。输出纯文本，不要 Markdown 代码块。",
        },
        {
          role: "user",
          content: `请按“${stylePrompt(parsed.data.style)}”润色下面日志，保持事实完全一致：\n\n${parsed.data.text}`,
        },
      ],
    });

    const polishedText = completion.choices[0]?.message?.content?.trim();
    if (!polishedText) {
      return NextResponse.json({ error: "AI 未返回有效润色结果，请重试。" }, { status: 502 });
    }

    return NextResponse.json({
      polishedText,
      style: parsed.data.style,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? `AI 润色失败：${error.message}` : "AI 润色失败，请稍后重试。",
      },
      { status: 502 },
    );
  }
}

