import OpenAI from "openai";

import { statusLabels } from "@/lib/constants";
import { getAiRuntimeConfig } from "@/lib/server/app-settings";
import { formatDeadline } from "@/lib/time";

export type FocusSummaryInput = {
  databaseReady: boolean;
  focusMode: "task" | "review" | "waiting" | "blocked" | "empty";
  totalTaskCount: number;
  reviewCount: number;
  dueWaitingCount: number;
  blockedCount: number;
  topTaskTitles: string[];
  currentBestTask?: {
    title: string;
    deadline?: Date | string | null;
    nextActionSuggestion?: string | null;
    priorityReason?: string | null;
  } | null;
  focusReviewTask?: {
    title: string;
  } | null;
  focusWaitingTask?: {
    title: string;
    nextActionSuggestion?: string | null;
  } | null;
  focusBlockedTask?: {
    title: string;
    blockingPredecessorTitles?: string[] | null;
  } | null;
  tasks: Array<{
    title: string;
    status: string;
    displayStatus?: string | null;
    priorityScore: number;
    needsHumanReview: boolean;
  }>;
};

const completedStatuses = new Set(["done", "submitted"]);
const ignoredStatuses = new Set(["ignored"]);

function getFocusCounts(input: FocusSummaryInput) {
  const completedCount = input.tasks.filter((task) => completedStatuses.has(task.status)).length;
  const ignoredCount = input.tasks.filter((task) => ignoredStatuses.has(task.status)).length;
  const activeTaskCount = Math.max(input.totalTaskCount - completedCount - ignoredCount, 0);

  return {
    activeTaskCount,
    completedCount,
    ignoredCount,
  };
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

function buildFocusLine(input: FocusSummaryInput) {
  const { activeTaskCount, completedCount } = getFocusCounts(input);
  const urgentCount = Math.min(Math.max(input.topTaskTitles.length, 0), 3);
  const canPauseCount = Math.max(activeTaskCount - input.reviewCount - input.dueWaitingCount - urgentCount, 0);
  const counts = `今天盘子里当前还有 ${activeTaskCount} 条活跃任务，${urgentCount} 条值得先冲，${input.reviewCount} 条待确认，${input.dueWaitingCount} 条该回看，另外 ${canPauseCount} 条可以先放一放。`;

  if (!input.databaseReady) {
    return "数据库还没有初始化完成，先把数据层准备好，再让系统开始接管任务流转。";
  }

  if (input.totalTaskCount === 0) {
    return "当前还没有任务，先导入一条通知或手动记下一件事，系统才有东西可帮你判断轻重缓急。";
  }

  if (activeTaskCount === 0) {
    if (completedCount > 0) {
      return `今天手头已经没有活跃任务了，现有 ${completedCount} 条都处理结束了。可以先歇一口气，等新消息进来再开工。`;
    }

    return "当前已经没有需要继续推进的活跃任务了。";
  }

  switch (input.focusMode) {
    case "task":
      return `${counts} 当前主线是「${input.currentBestTask?.title || "未命名任务"}」，建议先推进这件事。`;
    case "review":
      return `${counts} 当前最该先清的是待确认项「${input.focusReviewTask?.title || "未命名任务"}」，避免关键字段带着歧义继续流转。`;
    case "waiting":
      return `${counts} 现在最值得先回看的是「${input.focusWaitingTask?.title || "未命名任务"}」，它已经到了该重新推进的时候。`;
    case "blocked":
      return `${counts} 当前主问题不是继续加任务，而是先解锁「${input.focusBlockedTask?.title || "未命名任务"}」这类被前置步骤卡住的事项。`;
    default:
      return `${counts} 当前没有单一主线，适合先扫一遍待确认和今天推进项，把真正需要立刻做的事拎出来。`;
  }
}

export function buildFocusSummaryFallback(input: FocusSummaryInput) {
  const baseLine = buildFocusLine(input);
  const { activeTaskCount } = getFocusCounts(input);

  if (!input.databaseReady || input.totalTaskCount === 0 || activeTaskCount === 0) {
    return baseLine;
  }

  if (input.focusMode === "task" && input.currentBestTask) {
    const deadline = formatDeadline(input.currentBestTask.deadline);
    return `${baseLine} 今天主线先盯「${input.currentBestTask.title}」，它截止 ${deadline}，现在最合适的动作是先${input.currentBestTask.nextActionSuggestion || "推进最小可执行的一步"}。`;
  }

  if (input.focusMode === "waiting" && input.focusWaitingTask?.nextActionSuggestion) {
    return `${baseLine} 当前最值得捞回来的是「${input.focusWaitingTask.title}」，可以从“${input.focusWaitingTask.nextActionSuggestion}”开始恢复推进。`;
  }

  if (input.focusMode === "blocked" && input.focusBlockedTask?.blockingPredecessorTitles?.length) {
    return `${baseLine} 眼下别急着加新任务，先完成 ${input.focusBlockedTask.blockingPredecessorTitles.join("、")}，卡住的几条才会顺着动起来。`;
  }

  if (input.topTaskTitles.length > 0) {
    return `${baseLine} 今天可以先从 ${input.topTaskTitles.slice(0, 3).map((title) => `「${title}」`).join("、")} 里挑一条开动。`;
  }

  return baseLine;
}

function buildFocusSummaryPrompt(input: FocusSummaryInput) {
  const { activeTaskCount, completedCount, ignoredCount } = getFocusCounts(input);
  const taskLines = input.tasks
    .slice(0, 8)
    .map((task, index) => {
      const displayStatus = task.displayStatus || task.status;
      const label = statusLabels[displayStatus as keyof typeof statusLabels] || displayStatus;
      return `${index + 1}. ${task.title}｜状态=${label}｜决策分=${task.priorityScore}｜待确认=${task.needsHumanReview ? "是" : "否"}`;
    })
    .join("\n");

  return `请为任务首页 Focus 区写一句中文总览总结。

要求：
1. 只输出 1-2 句纯文本，不要 Markdown，不要列表。
2. 语气要比普通提示更活泼一点，像靠谱同伴在帮用户捋清今天的任务局面，但不要油腻、不要卖萌过头。
3. 必须基于给定事实，不能编造新任务、新时间、新结论。
4. 最好自然带出三层信息：今天有哪些任务、哪些更急、哪些可以先放一放。
5. 优先回答“现在整体局面如何、当前主线是什么”。
6. 控制在 45 到 110 个汉字。

当前模式：${input.focusMode}
数据库可用：${input.databaseReady ? "是" : "否"}
任务总数：${input.totalTaskCount}
活跃任务数：${activeTaskCount}
已完成任务数：${completedCount}
已忽略任务数：${ignoredCount}
待确认：${input.reviewCount}
到点回看：${input.dueWaitingCount}
被阻塞：${input.blockedCount}
当前主任务：${input.currentBestTask?.title || "无"}
当前待确认焦点：${input.focusReviewTask?.title || "无"}
当前回看焦点：${input.focusWaitingTask?.title || "无"}
当前阻塞焦点：${input.focusBlockedTask?.title || "无"}
前置任务提示：${input.focusBlockedTask?.blockingPredecessorTitles?.join("、") || "无"}
当前前排任务：${input.topTaskTitles.join("、") || "无"}

任务样本：
${taskLines || "无任务样本"}`;
}

export async function generateFocusSummary(input: FocusSummaryInput) {
  const fallback = buildFocusSummaryFallback(input);
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
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: "你是中文任务决策面板里的 Focus 总览助手，只负责把当前任务局面总结成一句简短、可信的全局摘要。",
        },
        {
          role: "user",
          content: buildFocusSummaryPrompt(input),
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
