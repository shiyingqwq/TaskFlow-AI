import { ExtractedTaskInput, TaskExtractionResult } from "@/lib/parser/schema";
import { extractDeadlineFromText } from "@/lib/time";

const actionKeywords = /(提交|上交|发送|报名|打印|盖章|签字|确认|联系|收集|汇总|合并|命名|制作|整理|回复)/;

function compact(text: string) {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function sourceSummary(text: string) {
  const normalized = compact(text);
  return normalized.slice(0, 90) + (normalized.length > 90 ? "…" : "");
}

function pickSubject(text: string) {
  const firstLine = compact(text).split("\n")[0] ?? "任务通知";
  return firstLine.replace(/[：:，,。]/g, " ").trim().slice(0, 24) || "任务通知";
}

function evidenceAround(text: string, keyword: string) {
  const index = text.indexOf(keyword);
  if (index === -1) {
    return compact(text).slice(0, 80);
  }
  const start = Math.max(0, index - 18);
  const end = Math.min(text.length, index + 40);
  return compact(text.slice(start, end));
}

function extractMaterials(text: string) {
  const pool = [
    "申请表",
    "承诺书",
    "身份证",
    "学生证",
    "成绩单",
    "报名表",
    "病例汇报 PPT",
    "PPT",
    "PDF",
    "获奖证明",
    "队友材料",
    "个人陈述",
    "电子版",
    "纸质版",
  ];
  return pool.filter((item) => text.includes(item));
}

function createTask(partial: Partial<ExtractedTaskInput> & Pick<ExtractedTaskInput, "title" | "taskType" | "evidenceSnippet" | "nextActionSuggestion">): ExtractedTaskInput {
  return {
    description: "",
    recurrenceType: "single",
    recurrenceDays: [],
    recurrenceTargetCount: 1,
    recurrenceLimit: null,
    deadlineISO: null,
    deadlineText: null,
    submitTo: null,
    submitChannel: null,
    applicableIdentities: [],
    identityHint: null,
    deliveryType: "unknown",
    requiresSignature: false,
    requiresStamp: false,
    materials: [],
    dependsOnExternal: false,
    waitingFor: null,
    waitingReasonType: null,
    waitingReasonText: null,
    nextCheckAt: null,
    confidence: 0.72,
    ...partial,
  };
}

function inferSubmitTo(text: string) {
  const patterns = ["辅导员", "老师", "学院办公室", "比赛负责人", "学工办", "秘书处", "班长"];
  return patterns.find((item) => text.includes(item)) ?? null;
}

function inferSubmitChannel(text: string) {
  if (text.includes("邮箱")) return "邮箱";
  if (text.includes("群文件")) return "群文件";
  if (text.includes("系统")) return "系统";
  if (text.includes("现场") || text.includes("办公室")) return "线下提交";
  if (text.includes("微信")) return "微信";
  return null;
}

function buildSpecializedTasks(text: string) {
  const normalized = compact(text);
  const subject = pickSubject(normalized);
  const materials = extractMaterials(normalized);
  const deadlineInfo = extractDeadlineFromText(normalized);
  const tasks: ExtractedTaskInput[] = [];

  if (/电子版|邮箱|群文件|系统/.test(normalized)) {
    tasks.push(
      createTask({
        title: `${subject}：提交电子版`,
        description: "先完成电子版整理并提交，避免后续纸质流程拖延。",
        taskType: "submission",
        deadlineISO: deadlineInfo.deadlineISO,
        deadlineText: deadlineInfo.deadlineText,
        submitTo: inferSubmitTo(normalized),
        submitChannel: inferSubmitChannel(normalized) ?? "线上",
        deliveryType: /纸质/.test(normalized) ? "both" : "electronic",
        materials,
        confidence: 0.84,
        evidenceSnippet: evidenceAround(normalized, "电子"),
        nextActionSuggestion: "先确认电子版命名与格式，再立即提交。",
      }),
    );
  }

  if (/打印|纸质/.test(normalized)) {
    tasks.push(
      createTask({
        title: `${subject}：打印纸质材料`,
        description: "纸质材料通常受打印店、办公时间影响，需要提前处理。",
        taskType: "offline",
        deadlineISO: deadlineInfo.deadlineISO,
        deadlineText: deadlineInfo.deadlineText ?? "纸质版时间未完全明确",
        deliveryType: /电子版/.test(normalized) ? "both" : "paper",
        materials,
        confidence: 0.82,
        evidenceSnippet: evidenceAround(normalized, "纸质"),
        nextActionSuggestion: "检查页数和份数，尽快打印并预留补印时间。",
      }),
    );
  }

  if (/签字|签名/.test(normalized)) {
    tasks.push(
      createTask({
        title: `${subject}：完成签字`,
        description: "签字往往受老师时间影响，应提前预约。",
        taskType: "communication",
        deadlineISO: deadlineInfo.deadlineISO,
        deadlineText: deadlineInfo.deadlineText,
        submitTo: normalized.includes("辅导员") ? "辅导员" : inferSubmitTo(normalized),
        deliveryType: "paper",
        requiresSignature: true,
        materials,
        confidence: 0.8,
        evidenceSnippet: evidenceAround(normalized, "签"),
        nextActionSuggestion: "先联系可签字的人，确认何时能当面处理。",
      }),
    );
  }

  if (/盖章|学院章|公章/.test(normalized)) {
    tasks.push(
      createTask({
        title: `${subject}：办理盖章`,
        description: "盖章往往需要办公时间，属于高风险线下环节。",
        taskType: "offline",
        deadlineISO: deadlineInfo.deadlineISO,
        deadlineText: deadlineInfo.deadlineText,
        submitTo: normalized.includes("学院") ? "学院办公室" : inferSubmitTo(normalized),
        submitChannel: "线下办理",
        deliveryType: "paper",
        requiresStamp: true,
        materials,
        confidence: 0.81,
        evidenceSnippet: evidenceAround(normalized, "章"),
        nextActionSuggestion: "确认办公时间并带齐材料，一次完成盖章。",
      }),
    );
  }

  if (/送到|交到|交至|办公室/.test(normalized) && (/纸质|盖章|签字/.test(normalized) || normalized.includes("现场"))) {
    tasks.push(
      createTask({
        title: `${subject}：送交线下材料`,
        description: "最终送交前要核对签字、盖章与份数是否完整。",
        taskType: "offline",
        deadlineISO: deadlineInfo.deadlineISO,
        deadlineText: deadlineInfo.deadlineText,
        submitTo: inferSubmitTo(normalized),
        submitChannel: "线下提交",
        deliveryType: "paper",
        materials,
        confidence: 0.83,
        evidenceSnippet: evidenceAround(normalized, "交"),
        nextActionSuggestion: "完成签字盖章后立即送交，避免办公时间结束。",
      }),
    );
  }

  if (/收集|汇总/.test(normalized) && /队友|同学|成员/.test(normalized)) {
    tasks.push(
      createTask({
        title: `${subject}：收集团队材料`,
        description: "先把每位成员材料收齐，后续统一提交才不会卡住。",
        taskType: "collection",
        deadlineISO: deadlineInfo.deadlineISO,
        deadlineText: deadlineInfo.deadlineText,
        submitTo: "队友",
        submitChannel: "聊天工具",
        deliveryType: "electronic",
        materials,
        dependsOnExternal: true,
        waitingFor: normalized.match(/(\d+位队友材料)/)?.[1] ?? "队友材料",
        waitingReasonType: "materials_pending",
        waitingReasonText: normalized.match(/(\d+位队友材料)/)?.[1] ?? "队友材料没收齐",
        confidence: 0.86,
        evidenceSnippet: evidenceAround(normalized, "收集"),
        nextActionSuggestion: "先发统一清单并逐个催收缺失材料。",
      }),
    );
  }

  if (/统一提交|报名/.test(normalized)) {
    tasks.push(
      createTask({
        title: `${subject}：统一提交报名材料`,
        description: "汇总完成后尽快统一提交，避免队友材料临时出错。",
        taskType: "submission",
        deadlineISO: deadlineInfo.deadlineISO,
        deadlineText: deadlineInfo.deadlineText,
        submitTo: inferSubmitTo(normalized),
        submitChannel: inferSubmitChannel(normalized) ?? "线上",
        deliveryType: "electronic",
        materials,
        dependsOnExternal: /队友|成员/.test(normalized),
        waitingFor: /队友|成员/.test(normalized) ? "队友材料收齐" : null,
        waitingReasonType: /队友|成员/.test(normalized) ? "materials_pending" : null,
        waitingReasonText: /队友|成员/.test(normalized) ? "等队友材料收齐" : null,
        confidence: /队友|成员/.test(normalized) ? 0.75 : 0.85,
        evidenceSnippet: evidenceAround(normalized, "提交"),
        nextActionSuggestion: /队友|成员/.test(normalized)
          ? "先确认材料是否收齐，再进行统一报名提交。"
          : "检查报名信息后直接提交。",
      }),
    );
  }

  if (/PPT|制作|整理|合并/.test(normalized)) {
    tasks.push(
      createTask({
        title: `${subject}：制作整理材料`,
        description: "把内容先整理成可提交版本，可显著降低后续风险。",
        taskType: "production",
        deadlineISO: deadlineInfo.deadlineISO,
        deadlineText: deadlineInfo.deadlineText,
        deliveryType: "electronic",
        materials,
        confidence: 0.78,
        evidenceSnippet: evidenceAround(normalized, normalized.includes("PPT") ? "PPT" : "整理"),
        nextActionSuggestion: normalized.includes("PDF")
          ? "先检查命名和页序，再合并导出 PDF。"
          : "先完成主体内容，再快速自检一遍。",
      }),
    );
  }

  if (/联系|确认|回复/.test(normalized) && /老师|辅导员|办公室/.test(normalized)) {
    tasks.push(
      createTask({
        title: `${subject}：联系确认关键人`,
        description: "先确认关键人的时间和要求，能减少反复跑腿。",
        taskType: "communication",
        deadlineISO: deadlineInfo.deadlineISO,
        deadlineText: deadlineInfo.deadlineText,
        submitTo: inferSubmitTo(normalized),
        submitChannel: normalized.includes("电话") ? "电话" : "消息",
        deliveryType: "unknown",
        confidence: 0.74,
        evidenceSnippet: evidenceAround(normalized, normalized.includes("确认") ? "确认" : "联系"),
        nextActionSuggestion: "先发一条明确消息确认时间和材料要求。",
      }),
    );
  }

  return tasks;
}

export function buildFallbackExtraction(text: string): TaskExtractionResult {
  const normalized = compact(text);
  const tasks = buildSpecializedTasks(normalized);

  if (tasks.length > 0) {
    return {
      sourceSummary: sourceSummary(normalized),
      dependencies: [],
      tasks: tasks.map((task) => {
        const parsedDeadline = task.deadlineText ? extractDeadlineFromText(task.deadlineText) : { deadlineISO: null, deadlineText: null };
        const confidencePenalty = !parsedDeadline.deadlineISO && task.deadlineText ? 0.08 : 0;
        const needsReviewPenalty = /(尽快|另行通知|待定|之后再说|有变动)/.test(normalized) ? 0.12 : 0;
        return {
          ...task,
          deadlineISO: task.deadlineISO ?? parsedDeadline.deadlineISO,
          deadlineText: task.deadlineText ?? parsedDeadline.deadlineText,
          confidence: Math.max(0.45, Number((task.confidence - confidencePenalty - needsReviewPenalty).toFixed(2))),
        };
      }),
    };
  }

  const lines = normalized
    .split(/[\n。；;]/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidateLine = lines.find((line) => actionKeywords.test(line)) ?? normalized;
  const deadline = extractDeadlineFromText(candidateLine);

  return {
    sourceSummary: sourceSummary(normalized),
    dependencies: [],
    tasks: [
      createTask({
        title: `${pickSubject(normalized)}：待人工确认`,
        description: "这条通知存在模糊条件，系统只抽出一个待确认任务。",
        taskType: "followup",
        deadlineISO: deadline.deadlineISO,
        deadlineText: deadline.deadlineText,
        submitTo: inferSubmitTo(candidateLine),
        submitChannel: inferSubmitChannel(candidateLine),
        deliveryType: "unknown",
        confidence: 0.5,
        evidenceSnippet: compact(candidateLine).slice(0, 80),
        nextActionSuggestion: "先把要求拆清楚，再决定具体执行动作。",
      }),
    ],
  };
}
