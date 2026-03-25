import OpenAI from "openai";

import { getAiRuntimeConfig } from "@/lib/server/app-settings";

export type ScheduleAuditPayload = {
  dateLabel: string;
  lintIssues: string[];
  courses: Array<{ title: string; startTime: string; endTime: string }>;
  slots: Array<{
    label: string;
    period: string;
    tasks: Array<{
      title: string;
      status: string;
      deadlineLabel: string;
      estimateMinutes: number;
    }>;
  }>;
};

function buildFallbackAudit(payload: ScheduleAuditPayload) {
  if (payload.lintIssues.length > 0) {
    return `检测到 ${payload.lintIssues.length} 处排程风险：${payload.lintIssues.slice(0, 2).join("；")}。建议先修正高风险项再执行今日计划。`;
  }

  const taskCount = payload.slots.reduce((sum, slot) => sum + slot.tasks.length, 0);
  if (taskCount === 0) {
    return "当前日程没有自动分配任务，建议先补一条必须完成项，再让系统重排。";
  }

  return "当前排程未发现明显冲突，可按时段顺序推进；优先处理临近截止与课程后置任务。";
}

function buildAuditPrompt(payload: ScheduleAuditPayload) {
  const slotLines = payload.slots
    .map((slot, index) => {
      const taskLines =
        slot.tasks.length === 0
          ? "- 无任务"
          : slot.tasks
              .map((task, taskIndex) => `- ${taskIndex + 1}. ${task.title}｜状态=${task.status}｜预估=${task.estimateMinutes} 分钟｜截止=${task.deadlineLabel}`)
              .join("\n");
      return `${index + 1}. ${slot.label}（${slot.period}）\n${taskLines}`;
    })
    .join("\n\n");

  const courseLines =
    payload.courses.length === 0
      ? "今日无课程"
      : payload.courses.map((course, index) => `${index + 1}. ${course.title} ${course.startTime}-${course.endTime}`).join("\n");

  const lintLines = payload.lintIssues.length > 0 ? payload.lintIssues.map((issue, index) => `${index + 1}. ${issue}`).join("\n") : "无";

  return `请审核今天的任务排程是否合理。

输出要求：
1. 只输出 1-3 句中文纯文本，不要 Markdown。
2. 必须先给结论（可执行 / 需调整）。
3. 若需调整，最多给 2 条最关键改动建议，且建议必须基于给定事实。
4. 不得编造不存在的任务、课程和时间。
5. “规则审查发现”是硬约束：若出现“最早开始晚于截止”或“未被分配”类问题，禁止建议把任务安排到违反该约束的时段。
6. 若存在“最早开始 > 截止”冲突，优先建议“顺延截止”或“放宽最早开始约束”，不要建议取消任务。

日期：${payload.dateLabel}

课程：
${courseLines}

时段安排：
${slotLines}

规则审查发现：
${lintLines}`;
}

export async function generateScheduleAuditSummary(payload: ScheduleAuditPayload) {
  const fallback = buildFallbackAudit(payload);
  const config = await getAiRuntimeConfig();
  if (!config) {
    return {
      text: fallback,
      mode: "fallback" as const,
    };
  }

  try {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "你是中文日程审核助手，只根据给定排程识别冲突并给出最小修改建议。",
        },
        {
          role: "user",
          content: buildAuditPrompt(payload),
        },
      ],
    });
    const text = completion.choices[0]?.message?.content?.replace(/\s+/g, " ").trim();
    if (!text) {
      return { text: fallback, mode: "fallback" as const };
    }
    return {
      text,
      mode: "ai" as const,
    };
  } catch {
    return {
      text: fallback,
      mode: "fallback" as const,
    };
  }
}
