import OpenAI from "openai";

import { APP_TIMEZONE } from "@/lib/constants";
import { describeActiveIdentitiesForPrompt, normalizeActiveIdentities, normalizeApplicableIdentities, normalizeIdentityHint } from "@/lib/identity";
import { nowInTaipei, normalizeDeadlineInput } from "@/lib/time";
import { taskExtractionSchema, TaskExtractionResult } from "@/lib/parser/schema";
import { getAiRuntimeConfig } from "@/lib/server/app-settings";
import { normalizeWaitingReasonInput, normalizeWaitingReasonType } from "@/lib/waiting";

export function buildTaskExtractionSystemPrompt(activeIdentities: string[] = []) {
  const today = nowInTaipei().format("YYYY-MM-DD HH:mm");

  return `你是一个中文任务决策助手。请把输入内容抽取为严格 JSON，顶层字段必须只有 sourceSummary、tasks、dependencies。
要求：
1. 只抽取用户可执行或需要推进的任务。
2. 若通知包含链式流程，请拆成多个任务。
2.1 如果任务之间存在明确先后、前置条件或阻塞关系，请在 dependencies 里输出，使用任务在 tasks 数组中的下标。字段为 predecessorIndex、successorIndex、relationType。
2.2 relationType 只能是 sequence、prerequisite、blocks。
3. 若原文出现“每天/每周某几天/共几次/每天完成几次”这类表达，请尽量补出 recurrenceType、recurrenceDays、recurrenceTargetCount、recurrenceLimit。
3.1 如果原文明确说明任务只针对某个身份或角色，例如班长、团支书、负责人、申请人、组长，请填 applicableIdentities；如果只能看出一点提示但不够确定，可写 identityHint。
4. deadlineISO 使用 ISO 8601，时区按 ${APP_TIMEZONE}。
5. 若时间不确定，deadlineISO 设为 null，并在 deadlineText 保留原表达。
6. 不要编造 submitTo、submitChannel、材料或依赖。
7. confidence 范围 0 到 1。
8. evidenceSnippet 必须来自原文，尽量短且能支撑判断。
9. 今天时间是 ${today}（${APP_TIMEZONE}）。
10. 如果原文没有写年份，deadlineISO 必须按当前年份推断，不允许写成往年年份。
11. 输出必须是合法 JSON，不要附加解释。`;
}

export function buildTaskExtractionUserPrompt(text: string, activeIdentities: string[] = []) {
  const normalizedIdentities = normalizeActiveIdentities(activeIdentities);
  const identityContext = describeActiveIdentitiesForPrompt(normalizedIdentities);

  return `${identityContext}\n\n请从下面内容抽取任务：\n\n${text}`;
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

function normalizeTaskType(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  const mapping: Record<string, TaskExtractionResult["tasks"][number]["taskType"]> = {
    submission: "submission",
    submit: "submission",
    提交: "submission",
    上交: "submission",
    collection: "collection",
    collect: "collection",
    收集: "collection",
    汇总: "collection",
    communication: "communication",
    communicate: "communication",
    沟通: "communication",
    确认: "communication",
    联系: "communication",
    offline: "offline",
    线下: "offline",
    打印: "offline",
    送交: "offline",
    production: "production",
    produce: "production",
    制作: "production",
    整理: "production",
    followup: "followup",
    follow_up: "followup",
    跟进: "followup",
  };

  return mapping[normalized] ?? "followup";
}

function normalizeDeliveryType(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  const mapping: Record<string, TaskExtractionResult["tasks"][number]["deliveryType"]> = {
    electronic: "electronic",
    online: "electronic",
    电子: "electronic",
    电子版: "electronic",
    paper: "paper",
    纸质: "paper",
    纸质版: "paper",
    both: "both",
    mixed: "both",
    全部: "both",
    电子和纸质: "both",
    unknown: "unknown",
    未知: "unknown",
    未明确: "unknown",
  };

  return mapping[normalized] ?? "unknown";
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "需要", "是", "有"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "不需要", "否", "无"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeMaterials(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[、，,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [] as string[];
}

function normalizeConfidence(value: unknown) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return 0.72;
  }
  return Math.max(0, Math.min(1, parsed));
}

function normalizeRecurrenceType(value: unknown): TaskExtractionResult["tasks"][number]["recurrenceType"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (["daily", "每日"].includes(normalized)) return "daily";
  if (["weekly", "每周", "每周某几天"].includes(normalized)) return "weekly";
  if (["limited", "特定几次", "fixed_times"].includes(normalized)) return "limited";
  return "single";
}

function normalizeRecurrenceDays(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as number[];
  }

  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
}

function normalizePositiveInt(value: unknown, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeIsoDateTime(value: unknown) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeDeadline(deadlineISO: unknown, deadlineText: unknown, base = nowInTaipei()) {
  const normalized = normalizeDeadlineInput(
    {
      deadlineISO: normalizeString(deadlineISO),
      deadlineText: normalizeString(deadlineText),
    },
    base,
    { preferStructuredDeadline: true },
  );
  return {
    deadlineISO: normalized.deadlineISO,
    deadlineText: normalized.deadlineText,
  };
}

function normalizeTask(task: unknown) {
  const raw = task && typeof task === "object" ? (task as Record<string, unknown>) : {};
  const deadline = normalizeDeadline(
    raw.deadlineISO ?? raw.deadlineIso ?? raw.deadline ?? raw.dueAt,
    raw.deadlineText ?? raw.deadlineRaw ?? raw.deadlineLabel ?? raw.dueText,
  );

  const description = normalizeString(raw.description ?? raw.detail ?? raw.notes) ?? "";
  const title =
    normalizeString(raw.title ?? raw.name ?? raw.task ?? raw.action) ??
    normalizeString(raw.evidenceSnippet ?? raw.evidence ?? raw.excerpt) ??
    "待确认任务";
  const waiting = normalizeWaitingReasonInput({
    waitingFor: normalizeString(raw.waitingFor ?? raw.blockedBy),
    waitingReasonType: normalizeWaitingReasonType(raw.waitingReasonType ?? raw.waitingType),
    waitingReasonText: normalizeString(raw.waitingReasonText ?? raw.waitingReason ?? raw.blockedReason),
    nextCheckAt: normalizeIsoDateTime(raw.nextCheckAt ?? raw.followUpAt),
    dependsOnExternal: normalizeBoolean(raw.dependsOnExternal ?? raw.externalDependency),
  });

  return {
    title,
    description,
    taskType: normalizeTaskType(raw.taskType ?? raw.type ?? raw.category),
    recurrenceType: normalizeRecurrenceType(raw.recurrenceType ?? raw.repeatType),
    recurrenceDays: normalizeRecurrenceDays(raw.recurrenceDays ?? raw.repeatDays),
    recurrenceTargetCount: normalizePositiveInt(raw.recurrenceTargetCount ?? raw.targetCount ?? raw.countPerCycle, 1),
    recurrenceLimit:
      raw.recurrenceLimit === null || raw.repeatLimit === null || (raw.recurrenceLimit === undefined && raw.repeatLimit === undefined)
        ? null
        : normalizePositiveInt(raw.recurrenceLimit ?? raw.repeatLimit, 1),
    deadlineISO: deadline.deadlineISO,
    deadlineText: deadline.deadlineText,
    submitTo: normalizeString(raw.submitTo ?? raw.receiver ?? raw.assignee),
    submitChannel: normalizeString(raw.submitChannel ?? raw.channel ?? raw.method),
    applicableIdentities: normalizeApplicableIdentities(raw.applicableIdentities ?? raw.identities ?? raw.roles ?? raw.audience),
    identityHint: normalizeIdentityHint(raw.identityHint ?? raw.identityNote ?? raw.audienceHint),
    deliveryType: normalizeDeliveryType(raw.deliveryType ?? raw.delivery ?? raw.submitType),
    requiresSignature: normalizeBoolean(raw.requiresSignature ?? raw.signatureRequired),
    requiresStamp: normalizeBoolean(raw.requiresStamp ?? raw.stampRequired),
    materials: normalizeMaterials(raw.materials ?? raw.files ?? raw.requiredMaterials),
    dependsOnExternal: normalizeBoolean(raw.dependsOnExternal ?? raw.externalDependency),
    waitingFor: waiting.waitingFor,
    waitingReasonType: waiting.waitingReasonType,
    waitingReasonText: waiting.waitingReasonText,
    nextCheckAt: waiting.nextCheckAt?.toISOString() ?? null,
    confidence: normalizeConfidence(raw.confidence),
    evidenceSnippet:
      normalizeString(raw.evidenceSnippet ?? raw.evidence ?? raw.excerpt ?? raw.sourceSnippet) ?? title,
    nextActionSuggestion:
      normalizeString(raw.nextActionSuggestion ?? raw.nextAction ?? raw.actionSuggestion) ?? "先核对要求，再推进最小可执行的一步。",
  };
}

async function parseJson(content: string) {
  const parsed = JSON.parse(content);
  const rawTasks = Array.isArray(parsed.tasks)
    ? parsed.tasks
    : Array.isArray(parsed.items)
      ? parsed.items
      : [];
  const rawDependencies = Array.isArray(parsed.dependencies)
    ? parsed.dependencies
    : Array.isArray(parsed.links)
      ? parsed.links
      : [];
  type NormalizedDependency = {
    predecessorIndex: number;
    successorIndex: number;
    relationType: "sequence" | "prerequisite" | "blocks";
  };

  const normalized = {
    sourceSummary:
      normalizeString(parsed.sourceSummary ?? parsed.summary ?? parsed.source_summary ?? parsed.overview) ??
      "AI 已解析来源内容。",
    tasks: rawTasks.map(normalizeTask),
    dependencies: rawDependencies
      .map((item: unknown): NormalizedDependency | null => {
        const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const predecessorIndex = Number(raw.predecessorIndex ?? raw.from ?? raw.sourceIndex);
        const successorIndex = Number(raw.successorIndex ?? raw.to ?? raw.targetIndex);
        const relationType = String(raw.relationType ?? raw.type ?? "sequence").trim().toLowerCase();
        const normalizedRelationType: NormalizedDependency["relationType"] = ["sequence", "prerequisite", "blocks"].includes(
          relationType,
        )
          ? (relationType as NormalizedDependency["relationType"])
          : "sequence";

        if (!Number.isInteger(predecessorIndex) || predecessorIndex < 0 || !Number.isInteger(successorIndex) || successorIndex < 0) {
          return null;
        }

        if (predecessorIndex === successorIndex) {
          return null;
        }

        return {
          predecessorIndex,
          successorIndex,
          relationType: normalizedRelationType,
        };
      })
      .filter((item: NormalizedDependency | null): item is NormalizedDependency => Boolean(item)),
  };

  return taskExtractionSchema.parse(normalized);
}

export async function extractWithOpenAIFromText(text: string, activeIdentities: string[] = []): Promise<TaskExtractionResult | null> {
  const { client, config } = await getClient();
  if (!client || !config) {
    return null;
  }

  const completion = await client.chat.completions.create({
    model: config.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildTaskExtractionSystemPrompt(activeIdentities) },
      {
        role: "user",
        content: buildTaskExtractionUserPrompt(text, activeIdentities),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    return null;
  }
  return parseJson(content);
}

export async function extractWithOpenAIFromImage(
  dataUrl: string,
  filename?: string | null,
  activeIdentities: string[] = [],
): Promise<TaskExtractionResult | null> {
  const { client, config } = await getClient();
  if (!client || !config || !config.supportsVision) {
    return null;
  }

  const completion = await client.chat.completions.create({
    model: config.visionModel,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildTaskExtractionSystemPrompt(activeIdentities) },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${describeActiveIdentitiesForPrompt(activeIdentities)}\n\n请阅读这张通知截图并抽取任务。文件名：${filename ?? "unknown"}`,
          },
          {
            type: "image_url",
            image_url: {
              url: dataUrl,
            },
          },
        ],
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    return null;
  }
  return parseJson(content);
}
