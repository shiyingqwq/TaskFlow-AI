import OpenAI from "openai";

import type { DeliveryType, TaskStatus } from "@/generated/prisma/enums";
import { getAiRuntimeConfig } from "@/lib/server/app-settings";
import { diffHoursFromNow } from "@/lib/time";

export type TaskBanterInput = {
  id: string;
  title: string;
  status: TaskStatus | string;
  deadline?: string | Date | null;
  deadlineText?: string | null;
  deliveryType: DeliveryType | string;
  requiresSignature: boolean;
  requiresStamp: boolean;
  recurrenceType: string;
  recurrenceTargetCount: number;
  dependsOnExternal: boolean;
  waitingReasonText?: string | null;
  nextActionSuggestion: string;
};

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

function hashText(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pick<T>(items: T[], seed: string) {
  return items[hashText(seed) % items.length];
}

export function buildTaskBanterFallback(task: TaskBanterInput) {
  const hoursLeft = diffHoursFromNow(task.deadline);
  const seed = `${task.id}:${task.title}:${task.status}`;

  if (task.status === "overdue") {
    return pick(
      [
        "这条任务已经不是在提醒你了，是在用日历拍你肩膀。",
        "它已经从“待办”进化成“历史遗留问题”了。",
        "这条再不动，连截止时间都要怀疑你们的关系了。",
      ],
      seed,
    );
  }

  if (task.status === "waiting" && task.waitingReasonText) {
    return `它不是你不想做，是现实先卡了门。当前卡点：${task.waitingReasonText}。`;
  }

  if (typeof hoursLeft === "number" && hoursLeft <= 24) {
    return pick(
      [
        "这条已经进入“别做战略思考，先动手”区间了。",
        "离截止不远了，现在最需要的不是灵感，是执行。",
        "这条任务现在的气质很简单：再拖就要现场表演极限操作。",
      ],
      seed,
    );
  }

  if (task.deliveryType === "paper" || task.requiresSignature || task.requiresStamp) {
    return pick(
      [
        "纸质、签字、盖章三件套一出场，事情就自动从轻松模式切到跑腿模式。",
        "只要沾上线下材料，这条任务就会默认你得走路、排队、看人脸色。",
        "这类任务表面叫提交，实际副标题通常叫“别等办公室下班”。",
      ],
      seed,
    );
  }

  if (task.recurrenceType !== "single" && task.recurrenceTargetCount > 1) {
    return `这不是做一次就散会的任务，这是今天得刷满 ${task.recurrenceTargetCount} 次的日常副本。`;
  }

  if (task.dependsOnExternal) {
    return pick(
      [
        "你已经准备上了，可惜这条任务还得看别人有没有空回你。",
        "这条最难的部分不是做，而是等别人把球传回来。",
        "它的核心难点不在执行，在于你得先把外部变量哄顺。",
      ],
      seed,
    );
  }

  if (task.deadlineText) {
    return `原文写着“${task.deadlineText}”，系统已经帮你记住了，接下来就看你什么时候肯动。`;
  }

  return pick(
    [
      "这条任务目前还算讲道理，关键是别把“我知道了”误当成“我做了”。",
      "它看起来不凶，但拖久了照样会变成下一次的紧急事项。",
      "这条现在还在可控范围，趁它没翻脸，先推进一步最划算。",
    ],
    seed,
  );
}

function buildAiPrompt(task: TaskBanterInput) {
  const deadline = task.deadline instanceof Date ? task.deadline.toISOString() : task.deadline ?? "未明确";

  return `请针对下面这条任务，写一段中文“轻吐槽”。
要求：
1. 只输出 1-2 句纯文本，不要 Markdown，不要列表。
2. 风格要像会做事的同学在旁边吐槽，轻松、有点损，但不要刻薄，不要攻击用户。
3. 吐槽必须基于任务事实，不能编造。
4. 如果任务偏正式或高风险，吐槽也要克制。
5. 控制在 25 到 60 个汉字内。

任务标题：${task.title}
状态：${task.status}
截止时间：${deadline}
原始时间表达：${task.deadlineText || "未明确"}
交付形式：${task.deliveryType}
需要签字：${task.requiresSignature ? "是" : "否"}
需要盖章：${task.requiresStamp ? "是" : "否"}
重复类型：${task.recurrenceType}
每轮目标次数：${task.recurrenceTargetCount}
是否依赖他人：${task.dependsOnExternal ? "是" : "否"}
等待原因：${task.waitingReasonText || "无"}
下一步建议：${task.nextActionSuggestion}`;
}

export async function generateTaskBanter(task: TaskBanterInput) {
  const fallback = buildTaskBanterFallback(task);
  const { client, config } = await getClient();

  if (!client || !config) {
    return {
      text: fallback,
      mode: "fallback" as const,
    };
  }

  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.9,
      messages: [
        {
          role: "system",
          content: "你是中文任务应用里的吐槽搭子，负责给任务写一句贴近事实的轻吐槽。",
        },
        {
          role: "user",
          content: buildAiPrompt(task),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      return {
        text: fallback,
        mode: "fallback" as const,
      };
    }

    return {
      text: content.replace(/\s+/g, " ").trim(),
      mode: "ai" as const,
    };
  } catch {
    return {
      text: fallback,
      mode: "fallback" as const,
    };
  }
}
