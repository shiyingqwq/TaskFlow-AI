import OpenAI from "openai";
import { z } from "zod";

import { normalizeCourseSchedule, parseCourseScheduleText } from "@/lib/course-schedule";
import { APP_TIMEZONE } from "@/lib/constants";
import { getAiRuntimeConfig } from "@/lib/server/app-settings";

const aiCourseSchema = z.object({
  courses: z
    .array(
      z.object({
        title: z.string(),
        weekday: z.number().int().min(0).max(6),
        startTime: z.string(),
        endTime: z.string(),
        location: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

const weekdayDesc = "0=周日,1=周一,2=周二,3=周三,4=周四,5=周五,6=周六";

function buildCourseImportPrompt() {
  return `你是课表结构化助手。请从输入内容提取课程课表并输出 JSON。
要求：
1. 顶层仅输出 {"courses":[...]}。
2. 每条课程字段：title, weekday, startTime, endTime, location。
3. weekday 按 ${weekdayDesc}。
4. startTime/endTime 使用 24 小时 HH:mm。
5. 无法确认的课程不要臆造。
6. 如果同一门课有多节，拆成多条。
7. 时区按 ${APP_TIMEZONE}，但不要输出日期。`;
}

async function getClient() {
  const config = await getAiRuntimeConfig();
  if (!config) {
    return { client: null, config: null };
  }
  return {
    client: new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    }),
    config,
  };
}

function parseAiJson(content: string) {
  const parsed = JSON.parse(content);
  const normalized = aiCourseSchema.parse(parsed);
  return normalizeCourseSchedule(normalized.courses);
}

export async function importCoursesFromImage(dataUrl: string, filename?: string | null) {
  const { client, config } = await getClient();
  if (!client || !config) {
    return {
      courses: [] as ReturnType<typeof normalizeCourseSchedule>,
      warnings: ["未配置可用 AI，无法识别课表图片。"],
      mode: "fallback" as const,
    };
  }

  if (!config.supportsVision) {
    return {
      courses: [] as ReturnType<typeof normalizeCourseSchedule>,
      warnings: ["当前 AI 配置未启用视觉模型，无法识别图片。"],
      mode: "fallback" as const,
    };
  }

  const completion = await client.chat.completions.create({
    model: config.visionModel,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildCourseImportPrompt() },
      {
        role: "user",
        content: [
          { type: "text", text: `请识别这张课表图片并输出结构化课程。文件名：${filename ?? "unknown"}` },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    return {
      courses: [] as ReturnType<typeof normalizeCourseSchedule>,
      warnings: ["AI 未返回可解析内容。"],
      mode: "openai" as const,
    };
  }

  try {
    return {
      courses: parseAiJson(content),
      warnings: [] as string[],
      mode: "openai" as const,
    };
  } catch {
    return {
      courses: [] as ReturnType<typeof normalizeCourseSchedule>,
      warnings: ["AI 返回内容格式不符合课程结构。"],
      mode: "openai" as const,
    };
  }
}

export async function importCoursesFromText(text: string) {
  const fallback = parseCourseScheduleText(text);
  if (fallback.items.length > 0 && fallback.errors.length === 0) {
    return {
      courses: normalizeCourseSchedule(fallback.items),
      warnings: [] as string[],
      mode: "fallback" as const,
    };
  }

  const { client, config } = await getClient();
  if (!client || !config) {
    return {
      courses: normalizeCourseSchedule(fallback.items),
      warnings: fallback.errors.length > 0 ? fallback.errors : ["未配置可用 AI，文本课表仅完成基础解析。"],
      mode: "fallback" as const,
    };
  }

  const completion = await client.chat.completions.create({
    model: config.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildCourseImportPrompt() },
      { role: "user", content: `请从以下文本提取课表：\n\n${text}` },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    return {
      courses: normalizeCourseSchedule(fallback.items),
      warnings: fallback.errors.length > 0 ? fallback.errors : ["AI 未返回可解析内容。"],
      mode: "fallback" as const,
    };
  }

  try {
    return {
      courses: parseAiJson(content),
      warnings: fallback.errors,
      mode: "openai" as const,
    };
  } catch {
    return {
      courses: normalizeCourseSchedule(fallback.items),
      warnings: ["AI 返回内容格式不符合课程结构。", ...fallback.errors],
      mode: "fallback" as const,
    };
  }
}
