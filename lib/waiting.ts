import { formatDeadline, nowInTaipei, toTaipei } from "@/lib/time";

export const waitingReasonTypeLabels = {
  teacher_reply: "等老师回复",
  office_closed: "办公室没开门",
  materials_pending: "材料没收齐",
  printing_blocked: "今天不方便打印",
  external_dependency: "依赖他人推进",
  other: "其他原因",
} as const;

export type WaitingReasonType = keyof typeof waitingReasonTypeLabels;
export type WaitingFollowUpPreset = "tonight" | "tomorrow" | "next_week";

type WaitingReasonInput = {
  waitingFor?: string | null;
  waitingReasonType?: string | null;
  waitingReasonText?: string | null;
  nextCheckAt?: string | Date | null;
  dependsOnExternal?: boolean;
};

function normalizeText(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeWaitingReasonType(value: unknown): WaitingReasonType | null {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized in waitingReasonTypeLabels) {
    return normalized as WaitingReasonType;
  }

  return null;
}

export function inferWaitingReasonType(text: string | null, dependsOnExternal = false): WaitingReasonType | null {
  if (!text) {
    return dependsOnExternal ? "external_dependency" : null;
  }

  if (/(老师|辅导员|审批|回复|确认)/.test(text)) {
    return "teacher_reply";
  }
  if (/(办公室|窗口|开门|办公时间|值班)/.test(text)) {
    return "office_closed";
  }
  if (/(材料|资料|名单|队友|成员|没收齐|未收齐|缺)/.test(text)) {
    return "materials_pending";
  }
  if (/(打印|打印店|装订|复印)/.test(text)) {
    return "printing_blocked";
  }
  if (dependsOnExternal || /(对方|他人|别人|外部)/.test(text)) {
    return "external_dependency";
  }

  return "other";
}

export function normalizeWaitingReasonInput(input: WaitingReasonInput) {
  const waitingReasonText = normalizeText(input.waitingReasonText) ?? normalizeText(input.waitingFor);
  const waitingReasonType = normalizeWaitingReasonType(input.waitingReasonType) ?? inferWaitingReasonType(waitingReasonText, input.dependsOnExternal);
  const nextCheckAt = input.nextCheckAt ? new Date(input.nextCheckAt) : null;

  return {
    waitingReasonType,
    waitingReasonText,
    waitingFor: waitingReasonText,
    nextCheckAt,
  };
}

export function getWaitingReasonText(input: WaitingReasonInput) {
  return normalizeText(input.waitingReasonText) ?? normalizeText(input.waitingFor);
}

export function hasWaitingReason(input: WaitingReasonInput) {
  return Boolean(getWaitingReasonText(input) || normalizeWaitingReasonType(input.waitingReasonType) || input.nextCheckAt);
}

export function describeWaitingReason(input: WaitingReasonInput) {
  const label = normalizeWaitingReasonType(input.waitingReasonType)
    ? waitingReasonTypeLabels[normalizeWaitingReasonType(input.waitingReasonType)!]
    : null;
  const text = getWaitingReasonText(input);
  const nextCheckAt = input.nextCheckAt ? formatDeadline(input.nextCheckAt) : null;

  if (label && text && label !== text) {
    return nextCheckAt ? `${label}：${text}；下次检查 ${nextCheckAt}` : `${label}：${text}`;
  }
  if (text) {
    return nextCheckAt ? `${text}；下次检查 ${nextCheckAt}` : text;
  }
  if (label) {
    return nextCheckAt ? `${label}；下次检查 ${nextCheckAt}` : label;
  }
  if (nextCheckAt) {
    return `下次检查 ${nextCheckAt}`;
  }

  return null;
}

export function isWaitingFollowUpDue(input: WaitingReasonInput) {
  if (!input.nextCheckAt) {
    return false;
  }

  const nextCheck = toTaipei(input.nextCheckAt);
  if (!nextCheck) {
    return false;
  }

  return !nextCheck.isAfter(nowInTaipei());
}

export function resolveWaitingFollowUpPreset(preset: WaitingFollowUpPreset) {
  const base = nowInTaipei();

  if (preset === "tonight") {
    const tonight = base.hour(20).minute(0).second(0).millisecond(0);
    return (tonight.isAfter(base) ? tonight : tonight.add(1, "day")).toDate();
  }

  if (preset === "tomorrow") {
    return base.add(1, "day").hour(10).minute(0).second(0).millisecond(0).toDate();
  }

  return base.add(7, "day").hour(10).minute(0).second(0).millisecond(0).toDate();
}
