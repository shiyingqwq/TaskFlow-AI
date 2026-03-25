import { recurrenceTypeLabels, recurrenceWeekdayLabels } from "@/lib/constants";
import { nowInTaipei, toTaipei } from "@/lib/time";

export type RecurrenceType = keyof typeof recurrenceTypeLabels;

type ProgressLogInput = {
  id?: string;
  completedAt: string | Date;
};

type RecurrenceInput = {
  recurrenceType?: string | null;
  recurrenceDays?: unknown;
  recurrenceTargetCount?: number | null;
  recurrenceLimit?: number | null;
  recurrenceStartAt?: string | Date | null;
  recurrenceUntil?: string | Date | null;
  recurrenceMaxOccurrences?: number | null;
  progressLogs?: ProgressLogInput[];
};

export type TaskProgressState = {
  recurrenceType: RecurrenceType;
  recurrenceDays: number[];
  recurrenceTargetCount: number;
  recurrenceLimit: number | null;
  currentCount: number;
  targetCount: number;
  totalCount: number;
  totalTargetCount: number;
  completed: boolean;
  activeToday: boolean;
  cycleLabel: string;
  helperText: string;
};

function normalizePositiveInt(value: unknown, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function normalizeRecurrenceType(value: unknown): RecurrenceType {
  return value === "daily" || value === "weekly" || value === "limited" ? value : "single";
}

export function normalizeRecurrenceDays(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as number[];
  }

  const values = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);

  return [...new Set(values)].sort((left, right) => {
    const order = [1, 2, 3, 4, 5, 6, 0];
    return order.indexOf(left) - order.indexOf(right);
  });
}

function getLogsForLocalDay(logs: ProgressLogInput[], base = nowInTaipei()) {
  return logs.filter((log) => {
    const completedAt = toTaipei(log.completedAt);
    return completedAt?.isSame(base, "day");
  });
}

function getNextWeeklyDayLabel(days: number[], today: number) {
  if (days.length === 0) {
    return null;
  }

  const futureDays = [...days].sort((left, right) => {
    const leftOffset = left >= today ? left - today : left + 7 - today;
    const rightOffset = right >= today ? right - today : right + 7 - today;
    return leftOffset - rightOffset;
  });

  return recurrenceWeekdayLabels[futureDays[0] as keyof typeof recurrenceWeekdayLabels] ?? null;
}

export function getTaskProgress(task: RecurrenceInput, base = nowInTaipei()): TaskProgressState {
  const recurrenceType = normalizeRecurrenceType(task.recurrenceType);
  const recurrenceDays = normalizeRecurrenceDays(task.recurrenceDays);
  const recurrenceTargetCount = normalizePositiveInt(task.recurrenceTargetCount, 1);
  const recurrenceLimit = task.recurrenceLimit ? normalizePositiveInt(task.recurrenceLimit, 1) : null;
  const progressLogs = task.progressLogs ?? [];
  const totalCount = progressLogs.length;

  if (recurrenceType === "daily") {
    const currentCount = getLogsForLocalDay(progressLogs, base).length;
    return {
      recurrenceType,
      recurrenceDays,
      recurrenceTargetCount,
      recurrenceLimit,
      currentCount,
      targetCount: recurrenceTargetCount,
      totalCount,
      totalTargetCount: recurrenceTargetCount,
      completed: currentCount >= recurrenceTargetCount,
      activeToday: true,
      cycleLabel: "今日",
      helperText: `今日已完成 ${Math.min(currentCount, recurrenceTargetCount)}/${recurrenceTargetCount}`,
    };
  }

  if (recurrenceType === "weekly") {
    const activeToday = recurrenceDays.length === 0 || recurrenceDays.includes(base.day());
    const currentCount = activeToday ? getLogsForLocalDay(progressLogs, base).length : 0;
    const nextLabel = getNextWeeklyDayLabel(recurrenceDays, base.day());
    return {
      recurrenceType,
      recurrenceDays,
      recurrenceTargetCount,
      recurrenceLimit,
      currentCount,
      targetCount: recurrenceTargetCount,
      totalCount,
      totalTargetCount: recurrenceTargetCount,
      completed: activeToday ? currentCount >= recurrenceTargetCount : false,
      activeToday,
      cycleLabel: activeToday ? "今日" : "本周",
      helperText: activeToday
        ? `今日已完成 ${Math.min(currentCount, recurrenceTargetCount)}/${recurrenceTargetCount}`
        : `今天不在重复日内${nextLabel ? `，下次是 ${nextLabel}` : ""}`,
    };
  }

  if (recurrenceType === "limited") {
    const totalTargetCount = recurrenceTargetCount * normalizePositiveInt(recurrenceLimit ?? 1, 1);
    return {
      recurrenceType,
      recurrenceDays,
      recurrenceTargetCount,
      recurrenceLimit,
      currentCount: totalCount,
      targetCount: totalTargetCount,
      totalCount,
      totalTargetCount,
      completed: totalCount >= totalTargetCount,
      activeToday: true,
      cycleLabel: "总计",
      helperText: `总进度 ${Math.min(totalCount, totalTargetCount)}/${totalTargetCount}`,
    };
  }

  return {
    recurrenceType,
    recurrenceDays,
    recurrenceTargetCount,
    recurrenceLimit,
    currentCount: totalCount,
    targetCount: recurrenceTargetCount,
    totalCount,
    totalTargetCount: recurrenceTargetCount,
    completed: totalCount >= recurrenceTargetCount,
    activeToday: true,
    cycleLabel: "本次",
    helperText: `本次已完成 ${Math.min(totalCount, recurrenceTargetCount)}/${recurrenceTargetCount}`,
  };
}

export function getRecurrenceSummary(task: RecurrenceInput) {
  const recurrenceType = normalizeRecurrenceType(task.recurrenceType);
  const recurrenceDays = normalizeRecurrenceDays(task.recurrenceDays);
  const recurrenceTargetCount = normalizePositiveInt(task.recurrenceTargetCount, 1);
  const recurrenceLimit = task.recurrenceLimit ? normalizePositiveInt(task.recurrenceLimit, 1) : null;
  const recurrenceMaxOccurrences = task.recurrenceMaxOccurrences ? normalizePositiveInt(task.recurrenceMaxOccurrences, 1) : null;
  const recurrenceStartLabel = task.recurrenceStartAt ? toTaipei(task.recurrenceStartAt)?.format("M/D HH:mm") ?? null : null;
  const recurrenceUntilLabel = task.recurrenceUntil ? toTaipei(task.recurrenceUntil)?.format("M/D HH:mm") ?? null : null;
  const boundaryNotes = [
    recurrenceStartLabel ? `起始 ${recurrenceStartLabel}` : null,
    recurrenceUntilLabel ? `截止 ${recurrenceUntilLabel}` : null,
    recurrenceMaxOccurrences ? `最多 ${recurrenceMaxOccurrences} 次` : null,
  ].filter(Boolean);

  if (recurrenceType === "weekly") {
    const labels = recurrenceDays.map((day) => recurrenceWeekdayLabels[day as keyof typeof recurrenceWeekdayLabels]).filter(Boolean);
    return `${recurrenceTypeLabels.weekly}${labels.length > 0 ? ` · ${labels.join(" / ")}` : ""} · 每次 ${recurrenceTargetCount}${boundaryNotes.length > 0 ? ` · ${boundaryNotes.join(" · ")}` : ""}`;
  }

  if (recurrenceType === "limited") {
    return `${recurrenceTypeLabels.limited} · 共 ${recurrenceLimit ?? 1} 次 · 每次 ${recurrenceTargetCount}${boundaryNotes.length > 0 ? ` · ${boundaryNotes.join(" · ")}` : ""}`;
  }

  if (recurrenceType === "daily") {
    return `${recurrenceTypeLabels.daily} · 每日 ${recurrenceTargetCount}${boundaryNotes.length > 0 ? ` · ${boundaryNotes.join(" · ")}` : ""}`;
  }

  return recurrenceTargetCount > 1 ? `${recurrenceTypeLabels.single} · 本次 ${recurrenceTargetCount}` : recurrenceTypeLabels.single;
}

export function shouldShowTaskProgress(task: RecurrenceInput) {
  return normalizeRecurrenceType(task.recurrenceType) !== "single" || normalizePositiveInt(task.recurrenceTargetCount, 1) > 1 || (task.progressLogs?.length ?? 0) > 0;
}

export function getCurrentCycleLogIds(task: RecurrenceInput, base = nowInTaipei()) {
  const recurrenceType = normalizeRecurrenceType(task.recurrenceType);
  const progressLogs = task.progressLogs ?? [];

  if (recurrenceType === "daily") {
    return getLogsForLocalDay(progressLogs, base).map((log) => log.id).filter(Boolean) as string[];
  }

  if (recurrenceType === "weekly") {
    const recurrenceDays = normalizeRecurrenceDays(task.recurrenceDays);
    if (recurrenceDays.length > 0 && !recurrenceDays.includes(base.day())) {
      return [] as string[];
    }
    return getLogsForLocalDay(progressLogs, base).map((log) => log.id).filter(Boolean) as string[];
  }

  return progressLogs.map((log) => log.id).filter(Boolean) as string[];
}
