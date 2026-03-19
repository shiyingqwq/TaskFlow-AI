import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import "dayjs/locale/zh-cn";

import { APP_TIMEZONE } from "@/lib/constants";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.locale("zh-cn");
dayjs.tz.setDefault(APP_TIMEZONE);

const weekdayMap: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

export type DeadlineInferenceType =
  | "manual_datetime"
  | "explicit_year"
  | "implicit_current_year"
  | "rolled_to_next_year"
  | "weekday"
  | "tonight"
  | "tomorrow_morning"
  | "tomorrow_evening"
  | "today"
  | "tomorrow"
  | "this_week"
  | "unparsed";

export type DeadlineParseAudit = {
  normalizedText: string;
  matchedText: string | null;
  deadlineISO: string | null;
  inferenceType: DeadlineInferenceType;
  confidence: number;
  rule: string;
  reason: string;
  usedCurrentYear: boolean;
  rolledToNextYear: boolean;
};

export type DeadlineAuditRecord = {
  deadlineInferenceType: string | null;
  deadlineInferenceRule: string | null;
  deadlineInferenceReason: string | null;
  deadlineInferenceConfidence: number | null;
  deadlineUsedCurrentYear: boolean;
  deadlineRolledToNextYear: boolean;
};

export type NormalizedDeadlineInput = {
  deadline: Date | null;
  deadlineISO: string | null;
  deadlineText: string | null;
  auditRecord: DeadlineAuditRecord;
};

export function nowInTaipei() {
  return dayjs().tz(APP_TIMEZONE);
}

export function toTaipei(input?: string | Date | null) {
  if (!input) {
    return null;
  }
  return dayjs(input).tz(APP_TIMEZONE);
}

function normalizeHourMinute(hour?: string, minute?: string, fallbackHour = 18) {
  return {
    hour: hour ? Number(hour) : fallbackHour,
    minute: minute ? Number(minute) : 0,
  };
}

function normalizeRelativeClockHour(hour: number, period: "day" | "morning" | "evening") {
  if (period === "evening" && hour < 12) {
    return hour + 12;
  }

  if (period === "morning" && hour === 12) {
    return 0;
  }

  return hour;
}

function parseClockAfterLabel(text: string, labelPattern: string, period: "day" | "morning" | "evening") {
  const escaped = new RegExp(
    `${labelPattern}(?:\\s*(\\d{1,2})(?:(?::(\\d{2}))|点半|点(?:(\\d{1,2})分?)?|时(?:(\\d{1,2})分?)?)?)?`,
  );
  const match = text.match(escaped);
  if (!match) {
    return null;
  }

  const [, hourText, minuteByColon, minuteByDian, minuteByShi] = match;
  if (!hourText) {
    return null;
  }

  const hour = normalizeRelativeClockHour(Number(hourText), period);
  const minute = minuteByColon ? Number(minuteByColon) : minuteByDian ? Number(minuteByDian) : minuteByShi ? Number(minuteByShi) : match[0].includes("点半") ? 30 : 0;

  return { hour, minute };
}

function buildDeadlineAudit(
  normalizedText: string,
  matchedText: string | null,
  deadline: dayjs.Dayjs | null,
  inferenceType: DeadlineInferenceType,
  rule: string,
  reason: string,
  options?: {
    confidence?: number;
    usedCurrentYear?: boolean;
    rolledToNextYear?: boolean;
  },
): DeadlineParseAudit {
  return {
    normalizedText,
    matchedText,
    deadlineISO: deadline ? deadline.toISOString() : null,
    inferenceType,
    confidence: options?.confidence ?? (deadline ? 0.9 : 0),
    rule,
    reason,
    usedCurrentYear: options?.usedCurrentYear ?? false,
    rolledToNextYear: options?.rolledToNextYear ?? false,
  };
}

function matchDeadlineText(normalized: string) {
  return (
    normalized.match(/(?:(\d{4})年)?\d{1,2}月\d{1,2}(?:日|号)(?:\d{1,2}(?::\d{2})?)?(?:前|之前|截止)?/)?.[0] ??
    normalized.match(/(?:(\d{4})[/. -])?\d{1,2}[/. -]\d{1,2}(?:\d{1,2}(?::\d{2})?)?(?:前|之前|截止)?/)?.[0] ??
    normalized.match(/周[一二三四五六日天](?:\d{1,2}(?::\d{2})?)?(?:前|之前|截止)?/)?.[0] ??
    normalized.match(/今晚(?:\d{1,2}(?::\d{2})?|点半|点\d{0,2}(?:分)?|时\d{0,2}(?:分)?)?(?:前|之前|截止)?|明早(?:\d{1,2}(?::\d{2})?|点半|点\d{0,2}(?:分)?|时\d{0,2}(?:分)?)?(?:前|之前|截止)?|明晚(?:\d{1,2}(?::\d{2})?|点半|点\d{0,2}(?:分)?|时\d{0,2}(?:分)?)?(?:前|之前|截止)?|明天(?:早上|上午|晚上)?(?:\d{1,2}(?::\d{2})?|点半|点\d{0,2}(?:分)?|时\d{0,2}(?:分)?)?(?:前|之前|截止)?|今天(?:早上|上午|晚上)?(?:\d{1,2}(?::\d{2})?|点半|点\d{0,2}(?:分)?|时\d{0,2}(?:分)?)?(?:前|之前|截止)?|本周内/)?.[0] ??
    null
  );
}

function parseMonthDay(text: string, base = nowInTaipei()) {
  const match =
    text.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)(?:\s*(\d{1,2})(?::(\d{2}))?)?/) ??
    text.match(/(?:(\d{4})[/. -])?(\d{1,2})[/. -](\d{1,2})(?:\s*(\d{1,2})(?::(\d{2}))?)?/);
  if (!match) {
    return null;
  }

  const [, explicitYear, monthText, dayText, hourText, minuteText] = match;
  const year = explicitYear ? Number(explicitYear) : base.year();
  const month = Number(monthText);
  const day = Number(dayText);
  const { hour, minute } = normalizeHourMinute(hourText, minuteText);
  let candidate = dayjs.tz(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    "YYYY-MM-DD HH:mm",
    APP_TIMEZONE,
  );
  let inferenceType: DeadlineInferenceType = explicitYear ? "explicit_year" : "implicit_current_year";
  let rule = explicitYear ? "month_day_with_explicit_year" : "month_day_default_current_year";
  let reason = explicitYear ? "原文包含显式年份，直接按原文日期解析。" : `原文未写年份，先按当前年份 ${base.year()} 解析。`;
  let rolledToNextYear = false;

  if (!explicitYear && candidate.isBefore(base.subtract(4, "hour"))) {
    candidate = candidate.add(1, "year");
    inferenceType = "rolled_to_next_year";
    rule = "month_day_roll_to_next_year";
    reason = `原文未写年份，按今年解析已明显过去，因此顺延到 ${candidate.year()} 年。`;
    rolledToNextYear = true;
  }

  return {
    deadline: candidate,
    inferenceType,
    rule,
    reason,
    usedCurrentYear: !explicitYear,
    rolledToNextYear,
  };
}

function parseWeekday(text: string, base = nowInTaipei()) {
  const match = text.match(/周([一二三四五六日天])(?:\s*(\d{1,2})(?::(\d{2}))?)?(?:前|之前|截止)?/);
  if (!match) {
    return null;
  }

  const [, weekdayText, hourText, minuteText] = match;
  const targetWeekday = weekdayMap[weekdayText];
  const currentWeekday = base.day();
  let diff = targetWeekday - currentWeekday;
  if (diff < 0) {
    diff += 7;
  }

  const { hour, minute } = normalizeHourMinute(hourText, minuteText);
  return {
    deadline: base.add(diff, "day").hour(hour).minute(minute).second(0).millisecond(0),
    inferenceType: "weekday" as const,
    rule: "weekday_relative_to_current_week",
    reason: "按当前日期所在周，结合星期表达推断具体日期。",
  };
}

function parseRelative(text: string, base = nowInTaipei()) {
  if (text.includes("今晚")) {
    const explicitClock = parseClockAfterLabel(text, "今晚", "evening");
    return {
      deadline: base
        .hour(explicitClock?.hour ?? 23)
        .minute(explicitClock?.minute ?? 0)
        .second(0)
        .millisecond(0),
      inferenceType: "tonight" as const,
      rule: explicitClock ? "relative_tonight_with_explicit_time" : "relative_tonight_default_23",
      reason: explicitClock ? `将“今晚”解释为当天 ${String(explicitClock.hour).padStart(2, "0")}:${String(explicitClock.minute).padStart(2, "0")}。` : "将“今晚”解释为当天 23:00。",
    };
  }

  if (text.includes("明早") || text.includes("明天早上") || text.includes("明日上午")) {
    const explicitClock =
      parseClockAfterLabel(text, "明早", "morning") ??
      parseClockAfterLabel(text, "明天早上", "morning") ??
      parseClockAfterLabel(text, "明日上午", "morning");
    return {
      deadline: base
        .add(1, "day")
        .hour(explicitClock?.hour ?? 9)
        .minute(explicitClock?.minute ?? 0)
        .second(0)
        .millisecond(0),
      inferenceType: "tomorrow_morning" as const,
      rule: explicitClock ? "relative_tomorrow_morning_with_explicit_time" : "relative_tomorrow_morning_default_09",
      reason: explicitClock
        ? `将“明早/明天早上/明日上午”解释为次日 ${String(explicitClock.hour).padStart(2, "0")}:${String(explicitClock.minute).padStart(2, "0")}。`
        : "将“明早/明天早上/明日上午”解释为次日 09:00。",
    };
  }

  if (text.includes("明晚") || text.includes("明天晚上")) {
    const explicitClock = parseClockAfterLabel(text, "明晚", "evening") ?? parseClockAfterLabel(text, "明天晚上", "evening");
    return {
      deadline: base
        .add(1, "day")
        .hour(explicitClock?.hour ?? 20)
        .minute(explicitClock?.minute ?? 0)
        .second(0)
        .millisecond(0),
      inferenceType: "tomorrow_evening" as const,
      rule: explicitClock ? "relative_tomorrow_evening_with_explicit_time" : "relative_tomorrow_evening_default_20",
      reason: explicitClock
        ? `将“明晚/明天晚上”解释为次日 ${String(explicitClock.hour).padStart(2, "0")}:${String(explicitClock.minute).padStart(2, "0")}。`
        : "将“明晚/明天晚上”解释为次日 20:00。",
    };
  }

  const todayTime = text.match(/今天(?:\s*(\d{1,2})(?::(\d{2}))?)?(?:前|之前|截止)?/);
  if (todayTime) {
    const explicitClock =
      parseClockAfterLabel(text, "今天晚上", "evening") ??
      parseClockAfterLabel(text, "今天早上", "morning") ??
      parseClockAfterLabel(text, "今天上午", "morning") ??
      parseClockAfterLabel(text, "今天", text.includes("晚上") ? "evening" : "day");
    const { hour, minute } = explicitClock ?? normalizeHourMinute(todayTime[1], todayTime[2], 18);
    return {
      deadline: base.hour(hour).minute(minute).second(0).millisecond(0),
      inferenceType: "today" as const,
      rule: explicitClock ? "relative_today_with_explicit_time" : "relative_today",
      reason: explicitClock ? `按当前日期解释“今天”，并读取到明确时刻 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}。` : "按当前日期解释“今天”并补默认时间。",
    };
  }

  const tomorrowTime = text.match(/明天(?:\s*(\d{1,2})(?::(\d{2}))?)?(?:前|之前|截止)?/);
  if (tomorrowTime) {
    const explicitClock =
      parseClockAfterLabel(text, "明天早上", "morning") ??
      parseClockAfterLabel(text, "明天上午", "morning") ??
      parseClockAfterLabel(text, "明天晚上", "evening") ??
      parseClockAfterLabel(text, "明天", "day");
    const { hour, minute } = explicitClock ?? normalizeHourMinute(tomorrowTime[1], tomorrowTime[2], 18);
    return {
      deadline: base.add(1, "day").hour(hour).minute(minute).second(0).millisecond(0),
      inferenceType: "tomorrow" as const,
      rule: explicitClock ? "relative_tomorrow_with_explicit_time" : "relative_tomorrow",
      reason: explicitClock ? `按当前日期解释“明天”，并读取到明确时刻 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}。` : "按当前日期解释“明天”并补默认时间。",
    };
  }

  if (text.includes("本周内")) {
    return {
      deadline: base.day(5).hour(18).minute(0).second(0).millisecond(0),
      inferenceType: "this_week" as const,
      rule: "relative_this_week_default_friday_18",
      reason: "将“本周内”解释为本周五 18:00。",
    };
  }

  return null;
}

export function parseDeadlineWithAudit(text: string, base = nowInTaipei()): DeadlineParseAudit {
  const normalized = text.replace(/\s+/g, "");
  const matchedText = matchDeadlineText(normalized);

  const monthDay = parseMonthDay(normalized, base);
  if (monthDay) {
    return buildDeadlineAudit(normalized, matchedText, monthDay.deadline, monthDay.inferenceType, monthDay.rule, monthDay.reason, {
      confidence: monthDay.inferenceType === "explicit_year" ? 0.98 : 0.9,
      usedCurrentYear: monthDay.usedCurrentYear,
      rolledToNextYear: monthDay.rolledToNextYear,
    });
  }

  const weekday = parseWeekday(normalized, base);
  if (weekday) {
    return buildDeadlineAudit(normalized, matchedText, weekday.deadline, weekday.inferenceType, weekday.rule, weekday.reason, {
      confidence: 0.88,
    });
  }

  const relative = parseRelative(normalized, base);
  if (relative) {
    return buildDeadlineAudit(normalized, matchedText, relative.deadline, relative.inferenceType, relative.rule, relative.reason, {
      confidence: 0.86,
    });
  }

  return buildDeadlineAudit(normalized, matchedText, null, "unparsed", "no_matching_rule", "没有命中任何可审计的时间规则。", {
    confidence: 0,
  });
}

export function buildDeadlineAuditRecord(
  input: {
    deadline: string | Date | null;
    deadlineText: string | null;
  },
  base = nowInTaipei(),
): DeadlineAuditRecord {
  if (input.deadlineText) {
    const audit = parseDeadlineWithAudit(input.deadlineText, base);
    return {
      deadlineInferenceType: audit.inferenceType,
      deadlineInferenceRule: audit.rule,
      deadlineInferenceReason: audit.reason,
      deadlineInferenceConfidence: audit.confidence,
      deadlineUsedCurrentYear: audit.usedCurrentYear,
      deadlineRolledToNextYear: audit.rolledToNextYear,
    };
  }

  if (input.deadline) {
    return {
      deadlineInferenceType: "manual_datetime",
      deadlineInferenceRule: "structured_deadline_without_raw_text",
      deadlineInferenceReason: "截止时间由结构化字段直接提供，未附原始时间表达。",
      deadlineInferenceConfidence: 1,
      deadlineUsedCurrentYear: false,
      deadlineRolledToNextYear: false,
    };
  }

  return {
    deadlineInferenceType: null,
    deadlineInferenceRule: null,
    deadlineInferenceReason: null,
    deadlineInferenceConfidence: null,
    deadlineUsedCurrentYear: false,
    deadlineRolledToNextYear: false,
  };
}

function normalizeDeadlineIsoInput(input: string | Date | null | undefined) {
  if (!input) {
    return null;
  }

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input.toISOString();
  }

  const normalized = String(input).trim();
  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function buildStructuredDeadlineAuditRecord(reason: string): DeadlineAuditRecord {
  return {
    deadlineInferenceType: "manual_datetime",
    deadlineInferenceRule: "structured_deadline_without_raw_text",
    deadlineInferenceReason: reason,
    deadlineInferenceConfidence: 1,
    deadlineUsedCurrentYear: false,
    deadlineRolledToNextYear: false,
  };
}

export function normalizeDeadlineInput(
  input: {
    deadlineISO?: string | Date | null;
    deadlineText?: string | null;
  },
  base = nowInTaipei(),
): NormalizedDeadlineInput {
  const deadlineText = input.deadlineText?.trim() || null;
  const structuredDeadlineISO = normalizeDeadlineIsoInput(input.deadlineISO);

  if (deadlineText) {
    const audit = parseDeadlineWithAudit(deadlineText, base);
    if (audit.deadlineISO) {
      return {
        deadline: new Date(audit.deadlineISO),
        deadlineISO: audit.deadlineISO,
        deadlineText,
        auditRecord: buildDeadlineAuditRecord({ deadline: audit.deadlineISO, deadlineText }, base),
      };
    }

    if (structuredDeadlineISO) {
      return {
        deadline: new Date(structuredDeadlineISO),
        deadlineISO: structuredDeadlineISO,
        deadlineText,
        auditRecord: buildStructuredDeadlineAuditRecord("原始时间表达未命中规则，沿用结构化截止时间。"),
      };
    }

    return {
      deadline: null,
      deadlineISO: null,
      deadlineText,
      auditRecord: buildDeadlineAuditRecord({ deadline: null, deadlineText }, base),
    };
  }

  if (structuredDeadlineISO) {
    return {
      deadline: new Date(structuredDeadlineISO),
      deadlineISO: structuredDeadlineISO,
      deadlineText: null,
      auditRecord: buildStructuredDeadlineAuditRecord("截止时间由结构化字段直接提供，未附原始时间表达。"),
    };
  }

  return {
    deadline: null,
    deadlineISO: null,
    deadlineText: null,
    auditRecord: buildDeadlineAuditRecord({ deadline: null, deadlineText: null }, base),
  };
}

export function readDeadlineAuditRecord(record: Partial<DeadlineAuditRecord>): DeadlineParseAudit | null {
  if (!record.deadlineInferenceType || !record.deadlineInferenceRule || !record.deadlineInferenceReason) {
    return null;
  }

  return {
    normalizedText: "",
    matchedText: null,
    deadlineISO: null,
    inferenceType: record.deadlineInferenceType as DeadlineInferenceType,
    confidence: record.deadlineInferenceConfidence ?? 0,
    rule: record.deadlineInferenceRule,
    reason: record.deadlineInferenceReason,
    usedCurrentYear: record.deadlineUsedCurrentYear ?? false,
    rolledToNextYear: record.deadlineRolledToNextYear ?? false,
  };
}

export function extractDeadlineFromText(text: string, base = nowInTaipei()) {
  const audit = parseDeadlineWithAudit(text, base);
  return {
    deadlineISO: audit.deadlineISO,
    deadlineText: audit.matchedText,
  };
}

export function describeDeadlineAudit(audit: DeadlineParseAudit) {
  if (!audit.deadlineISO) {
    return "规则：未命中可解析时间表达。";
  }

  return `规则：${audit.reason}`;
}

export function formatDeadline(input?: string | Date | null, base = nowInTaipei()) {
  const value = toTaipei(input);
  if (!value) {
    return "未明确";
  }
  return value.year() === base.year() ? value.format("M月D日 HH:mm") : value.format("YYYY年M月D日 HH:mm");
}

export function diffHoursFromNow(input?: string | Date | null) {
  const value = toTaipei(input);
  if (!value) {
    return null;
  }
  return value.diff(nowInTaipei(), "hour", true);
}
