import { normalizeMaterials } from "@/lib/materials";
import { nowInTaipei, parseDeadlineWithAudit, toTaipei } from "@/lib/time";
import { getWaitingReasonText, normalizeWaitingReasonType } from "@/lib/waiting";

export type ReviewSeverity = "high" | "low";
export type ReviewScope = "time" | "requirements" | "dependency" | "description" | "materials" | "classification";

export type ReviewChecklistItem = {
  code: string;
  label: string;
  severity: ReviewSeverity;
  scope: ReviewScope;
};

type ReviewInput = {
  taskType: string;
  deliveryType: string;
  deadline: string | Date | null;
  deadlineText: string | null;
  submitTo: string | null;
  submitChannel: string | null;
  requiresSignature: boolean;
  requiresStamp: boolean;
  materials: unknown;
  dependsOnExternal: boolean;
  waitingFor: string | null;
  waitingReasonType?: string | null;
  waitingReasonText?: string | null;
  nextCheckAt?: string | Date | null;
  confidence: number;
  description?: string | null;
};

const ambiguousDeadlinePattern = /(尽快|另行通知|待定|之后|择期|另行安排)/;
const offlineSubmitPattern = /(线下|现场|当面|办公室|送交|交到|办理|窗口)/;
const explicitTimeHintPattern = /(\d{1,2}:\d{2}|中午|下午|晚上|凌晨|早上|上午|傍晚|晚间|点半|点\d{0,2}(?:分)?|时\d{0,2}(?:分)?)/;

function addItem(target: ReviewChecklistItem[], item: ReviewChecklistItem) {
  if (!target.some((existing) => existing.code === item.code)) {
    target.push(item);
  }
}

function shouldReviewPaperFlow(task: ReviewInput) {
  return ["submission", "offline"].includes(task.taskType) && task.deliveryType !== "electronic";
}

function parseToTimestamp(input: string | Date | null) {
  if (!input) {
    return null;
  }

  if (input instanceof Date) {
    const timestamp = input.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  const timestamp = Date.parse(input);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function extractExplicitClockHint(text: string) {
  const colon = text.match(/(\d{1,2}):(\d{2})/);
  const byShi = text.match(/(\d{1,2})时(?:(\d{1,2})分?)?/);
  const byDian = text.match(/(\d{1,2})点(?:(\d{1,2})分?)?/);
  const hasHalf = /点半/.test(text);

  const rawHour = colon?.[1] ?? byShi?.[1] ?? byDian?.[1] ?? null;
  if (!rawHour) {
    return null;
  }

  let hour = Number(rawHour);
  let minute = colon?.[2] ? Number(colon[2]) : byShi?.[2] ? Number(byShi[2]) : byDian?.[2] ? Number(byDian[2]) : hasHalf ? 30 : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  if (/(下午|晚上|傍晚|晚间)/.test(text) && hour < 12) {
    hour += 12;
  } else if (/中午/.test(text) && hour < 11) {
    hour += 12;
  } else if (/(早上|上午)/.test(text) && hour === 12) {
    hour = 0;
  } else if (/凌晨/.test(text) && hour === 12) {
    hour = 0;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

export function normalizeReviewReasons(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

export function buildReviewChecklist(task: ReviewInput, base = nowInTaipei()) {
  const checklist: ReviewChecklistItem[] = [];

  if (!task.deadline && task.deadlineText && ambiguousDeadlinePattern.test(task.deadlineText)) {
    addItem(checklist, {
      code: "deadline_ambiguous",
      label: "请确认截止时间",
      severity: "high",
      scope: "time",
    });
  }

  if (!task.deadline && !task.deadlineText && ["submission", "collection", "offline"].includes(task.taskType)) {
    addItem(checklist, {
      code: "deadline_missing",
      label: "请确认截止时间",
      severity: "high",
      scope: "time",
    });
  }

  if (task.deadlineText) {
    const audit = parseDeadlineWithAudit(task.deadlineText, base);
    if (audit.usedCurrentYear && audit.rolledToNextYear && task.deadline) {
      addItem(checklist, {
        code: "deadline_year_inferred",
        label: "请确认截止时间",
        severity: "high",
        scope: "time",
      });
    }

    if (audit.deadlineISO && task.deadline) {
      const parsedTimestamp = parseToTimestamp(audit.deadlineISO);
      const structuredTimestamp = parseToTimestamp(task.deadline);
      if (parsedTimestamp !== null && structuredTimestamp !== null) {
        const diffMinutes = Math.abs(parsedTimestamp - structuredTimestamp) / (60 * 1000);
        const hasExplicitTimeHint = explicitTimeHintPattern.test(task.deadlineText);
        const isClearConflict = diffMinutes >= 24 * 60 || (hasExplicitTimeHint && diffMinutes >= 120);
        if (isClearConflict) {
          addItem(checklist, {
            code: "deadline_conflict",
            label: "截止时间与原文时间表达存在冲突，请确认",
            severity: "high",
            scope: "time",
          });
        }
      }
    }

    if (task.deadline) {
      const structuredLocal = toTaipei(task.deadline);
      const explicitClock = extractExplicitClockHint(task.deadlineText);
      if (structuredLocal && explicitClock) {
        const structuredMinutes = structuredLocal.hour() * 60 + structuredLocal.minute();
        const hintedMinutes = explicitClock.hour * 60 + explicitClock.minute;
        const diffClockMinutes = Math.abs(structuredMinutes - hintedMinutes);
        if (diffClockMinutes >= 120) {
          addItem(checklist, {
            code: "deadline_conflict",
            label: "截止时间与原文时间表达存在冲突，请确认",
            severity: "high",
            scope: "time",
          });
        }
      }
    }
  }

  if (["submission", "offline"].includes(task.taskType) && task.deliveryType === "unknown") {
    addItem(checklist, {
      code: "delivery_paper_unclear",
      label: "请确认是否需要纸质版",
      severity: "high",
      scope: "requirements",
    });
  }

  if (shouldReviewPaperFlow(task) && !task.requiresSignature && !task.requiresStamp) {
    addItem(checklist, {
      code: "signature_stamp_unclear",
      label: "请确认是否需要签字或盖章",
      severity: "high",
      scope: "requirements",
    });
  }

  if (shouldReviewPaperFlow(task) && !offlineSubmitPattern.test(task.submitChannel || "")) {
    addItem(checklist, {
      code: "offline_submit_unclear",
      label: "请确认是否需要线下提交",
      severity: "high",
      scope: "requirements",
    });
  }

  if (task.dependsOnExternal && !getWaitingReasonText(task) && !normalizeWaitingReasonType(task.waitingReasonType)) {
    addItem(checklist, {
      code: "dependency_unclear",
      label: "请确认是否依赖他人配合",
      severity: "high",
      scope: "dependency",
    });
  }

  if (task.confidence < 0.65) {
    addItem(checklist, {
      code: "confidence_low",
      label: "整体解析置信度偏低，建议快速扫一眼原文",
      severity: "low",
      scope: "classification",
    });
  }

  if (task.taskType === "submission") {
    if (!task.submitTo) {
      addItem(checklist, {
        code: "submit_to_missing",
        label: "提交对象还不够明确，可顺手补充",
        severity: "low",
        scope: "requirements",
      });
    }

    if (!task.submitChannel || ["线上", "线下提交", "聊天工具", "消息"].includes(task.submitChannel)) {
      addItem(checklist, {
        code: "submit_channel_generic",
        label: "提交方式细节还比较粗，可顺手补充",
        severity: "low",
        scope: "requirements",
      });
    }
  }

  if (["submission", "offline", "collection"].includes(task.taskType) && normalizeMaterials(task.materials).length === 0) {
    addItem(checklist, {
      code: "materials_maybe_missing",
      label: "材料清单可能还有小遗漏，可顺手补充",
      severity: "low",
      scope: "materials",
    });
  }

  if (!task.description || task.description.trim().length < 8) {
    addItem(checklist, {
      code: "description_brief",
      label: "描述文案偏简略，可顺手补一句",
      severity: "low",
      scope: "description",
    });
  }

  return checklist;
}

export function buildReviewState(task: ReviewInput, base = nowInTaipei()) {
  const reviewChecklist = buildReviewChecklist(task, base);
  const highRiskItems = reviewChecklist.filter((item) => item.severity === "high");
  const lowRiskItems = reviewChecklist.filter((item) => item.severity === "low");
  const reviewReasons = highRiskItems.map((item) => item.label);

  return {
    needsHumanReview: highRiskItems.length > 0,
    reviewReasons,
    reviewChecklist,
    highRiskItems,
    lowRiskItems,
  };
}
