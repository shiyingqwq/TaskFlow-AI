import { buildFallbackExtraction } from "@/lib/parser/fallback";
import { extractWithOpenAIFromImage, extractWithOpenAIFromText } from "@/lib/parser/openai";
import { ExtractedTaskInput, TaskExtractionResult } from "@/lib/parser/schema";
import { inferTaskStatus } from "@/lib/task-status";

export type ParsedSourceInput = {
  type: "text" | "image" | "pdf";
  rawText: string;
  imageDataUrl?: string | null;
  originalFilename?: string | null;
  activeIdentities?: string[];
};

export type ParsedTaskBundle = TaskExtractionResult & {
  mode: "openai" | "fallback";
};

function hasSequenceCue(text: string) {
  return /(之后|以后|再|然后|完成后|做完后|提交后|公示后|审核通过后|确认后|处理完后|先.*再|需先|必须先|才能)/.test(text);
}

function inferDependencyFromPair(current: ExtractedTaskInput, next: ExtractedTaskInput) {
  const currentText = [current.title, current.description, current.evidenceSnippet, current.nextActionSuggestion].join(" ");
  const nextText = [next.title, next.description, next.evidenceSnippet, next.nextActionSuggestion].join(" ");
  const pairText = `${currentText} ${nextText}`;

  if (hasSequenceCue(pairText)) {
    return "sequence" as const;
  }

  if (/(入群|进群|加入.*群)/.test(nextText) && /(公示|名单|填写|汇总|确认)/.test(currentText)) {
    return "sequence" as const;
  }

  if (next.dependsOnExternal || next.waitingFor) {
    return "prerequisite" as const;
  }

  if (
    current.taskType === "collection" ||
    current.taskType === "production" ||
    current.requiresSignature ||
    current.requiresStamp ||
    current.deliveryType === "paper"
  ) {
    return "sequence" as const;
  }

  return null;
}

function buildDependencies(tasks: ExtractedTaskInput[], aiDependencies: TaskExtractionResult["dependencies"] = []) {
  const dependencies: Array<{ predecessorIndex: number; successorIndex: number; relationType: "sequence" | "prerequisite" | "blocks" }> = [];
  const seen = new Set<string>();

  for (const dependency of aiDependencies) {
    if (
      dependency.predecessorIndex < 0 ||
      dependency.successorIndex < 0 ||
      dependency.predecessorIndex >= tasks.length ||
      dependency.successorIndex >= tasks.length ||
      dependency.predecessorIndex === dependency.successorIndex
    ) {
      continue;
    }

    const key = `${dependency.predecessorIndex}:${dependency.successorIndex}:${dependency.relationType}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dependencies.push(dependency);
  }

  for (let index = 0; index < tasks.length - 1; index += 1) {
    const current = tasks[index];
    const next = tasks[index + 1];

    const relationType = inferDependencyFromPair(current, next);
    if (relationType) {
      const key = `${index}:${index + 1}:${relationType}`;
      if (!seen.has(key)) {
        seen.add(key);
        dependencies.push({
          predecessorIndex: index,
          successorIndex: index + 1,
          relationType,
        });
      }
    }
  }
  return dependencies;
}

export function buildDependenciesForTest(tasks: ExtractedTaskInput[], aiDependencies: TaskExtractionResult["dependencies"] = []) {
  return buildDependencies(tasks, aiDependencies);
}

export async function parseSourceIntoTasks(input: ParsedSourceInput): Promise<ParsedTaskBundle> {
  let openAiResult: TaskExtractionResult | null = null;
  try {
    openAiResult =
      input.type === "image" && input.imageDataUrl
        ? await extractWithOpenAIFromImage(input.imageDataUrl, input.originalFilename, input.activeIdentities ?? [])
        : input.rawText
          ? await extractWithOpenAIFromText(input.rawText, input.activeIdentities ?? [])
          : null;
  } catch (error) {
    console.error("AI extraction failed, falling back to heuristic parser:", error);
    openAiResult = null;
  }

  if (openAiResult) {
    return {
      ...openAiResult,
      mode: "openai",
      dependencies: buildDependencies(openAiResult.tasks, openAiResult.dependencies),
    };
  }

  if (input.type === "image" && !input.rawText.trim()) {
    return {
      mode: "fallback",
      sourceSummary: "图片已保存。当前未配置可用的 AI Provider 或未开启视觉能力，图片内容暂不做智能识别，可先使用内置 demo 数据演示。",
      tasks: [],
      dependencies: [],
    };
  }

  const fallback = buildFallbackExtraction(input.rawText);
  return {
    ...fallback,
    mode: "fallback",
    dependencies: buildDependencies(fallback.tasks, fallback.dependencies),
  };
}

export function enrichTasksForCreation(result: ParsedTaskBundle) {
  return result.tasks.map((task) => ({
    ...task,
    status: inferTaskStatus({
      confidence: task.confidence,
      deadline: task.deadlineISO,
      deadlineText: task.deadlineText,
      taskType: task.taskType,
      deliveryType: task.deliveryType,
      dependsOnExternal: task.dependsOnExternal,
      waitingFor: task.waitingFor,
      waitingReasonType: task.waitingReasonType ?? null,
      waitingReasonText: task.waitingReasonText ?? null,
      nextCheckAt: task.nextCheckAt ?? null,
    }),
  }));
}
