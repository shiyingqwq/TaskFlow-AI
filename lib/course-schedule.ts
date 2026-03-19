import { nowInTaipei, toTaipei } from "@/lib/time";

export type CourseScheduleItem = {
  id: string;
  title: string;
  weekday: number; // 0-6, Sunday=0
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  location?: string | null;
};

export type CourseTerm = "spring" | "autumn";

export type CourseTableConfig = {
  currentTerm: CourseTerm;
  spring: {
    dayStart: string;
    dayEnd: string;
  };
  autumn: {
    dayStart: string;
    dayEnd: string;
  };
  slotMinutes: 30 | 60;
};

const defaultCourseTableConfig: CourseTableConfig = {
  currentTerm: "spring",
  spring: {
    dayStart: "08:00",
    dayEnd: "22:00",
  },
  autumn: {
    dayStart: "08:00",
    dayEnd: "22:00",
  },
  slotMinutes: 60,
};

const weekdayTokenMap: Record<string, number> = {
  "周日": 0,
  "周天": 0,
  "周一": 1,
  "周二": 2,
  "周三": 3,
  "周四": 4,
  "周五": 5,
  "周六": 6,
};

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeTime(value: unknown) {
  const raw = String(value ?? "").trim();
  const canonical = raw.replace(/^(\d):/, "0$1:");
  return timePattern.test(canonical) ? canonical : null;
}

function normalizeWeekday(value: unknown) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 6) {
    return parsed;
  }
  return null;
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function safeId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

export function normalizeCourseSchedule(value: unknown): CourseScheduleItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: CourseScheduleItem[] = [];
  value.forEach((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const title = String(row.title ?? "").trim();
    const weekday = normalizeWeekday(row.weekday);
    const startTime = normalizeTime(row.startTime);
    const endTime = normalizeTime(row.endTime);
    if (!title || weekday === null || !startTime || !endTime) {
      return;
    }

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    if (endMinutes <= startMinutes) {
      return;
    }

    normalized.push({
      id: String(row.id ?? "").trim() || safeId("course", index),
      title,
      weekday,
      startTime,
      endTime,
      location: row.location ? String(row.location).trim() : null,
    });
  });

  return normalized.sort((a, b) => {
    if (a.weekday !== b.weekday) {
      return a.weekday - b.weekday;
    }
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  });
}

export function parseCourseScheduleText(input: string) {
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const items: CourseScheduleItem[] = [];
  const errors: string[] = [];

  lines.forEach((line, index) => {
    const match = line.match(/^(周[一二三四五六日天])\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s+(.+)$/);
    if (!match) {
      errors.push(`第 ${index + 1} 行格式不正确：${line}`);
      return;
    }

    const [, weekdayToken, rawStart, rawEnd, tail] = match;
    const weekday = weekdayTokenMap[weekdayToken];
    const startTime = normalizeTime(rawStart);
    const endTime = normalizeTime(rawEnd);
    if (weekday === undefined || !startTime || !endTime) {
      errors.push(`第 ${index + 1} 行时间或星期无效：${line}`);
      return;
    }

    const [titlePart, locationPart] = tail.split("@");
    const title = titlePart.trim();
    if (!title) {
      errors.push(`第 ${index + 1} 行课程名不能为空：${line}`);
      return;
    }

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    if (endMinutes <= startMinutes) {
      errors.push(`第 ${index + 1} 行结束时间必须晚于开始时间：${line}`);
      return;
    }

    items.push({
      id: safeId("course", index),
      title,
      weekday,
      startTime,
      endTime,
      location: locationPart?.trim() || null,
    });
  });

  return {
    items,
    errors,
  };
}

export function toCourseScheduleText(courses: CourseScheduleItem[]) {
  const weekdayLabel = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return courses
    .map((course) =>
      `${weekdayLabel[course.weekday] ?? "周?"} ${course.startTime}-${course.endTime} ${course.title}${course.location ? ` @${course.location}` : ""}`,
    )
    .join("\n");
}

export function getCoursesForDay(courses: CourseScheduleItem[], dateInput?: string | Date | null) {
  const day = (toTaipei(dateInput) ?? nowInTaipei()).day();
  return courses.filter((course) => course.weekday === day).sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
}

export function getCourseOverlapMinutes(
  course: Pick<CourseScheduleItem, "startTime" | "endTime">,
  slot: { startTime: string; endTime: string },
) {
  const start = Math.max(timeToMinutes(course.startTime), timeToMinutes(slot.startTime));
  const end = Math.min(timeToMinutes(course.endTime), timeToMinutes(slot.endTime));
  return Math.max(0, end - start);
}

export function normalizeCourseTableConfig(value: unknown): CourseTableConfig {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const currentTerm = raw.currentTerm === "autumn" ? "autumn" : "spring";
  const springRaw = raw.spring && typeof raw.spring === "object" ? (raw.spring as Record<string, unknown>) : {};
  const autumnRaw = raw.autumn && typeof raw.autumn === "object" ? (raw.autumn as Record<string, unknown>) : {};
  const springStart = normalizeTime(springRaw.dayStart) ?? defaultCourseTableConfig.spring.dayStart;
  const springEnd = normalizeTime(springRaw.dayEnd) ?? defaultCourseTableConfig.spring.dayEnd;
  const autumnStart = normalizeTime(autumnRaw.dayStart) ?? defaultCourseTableConfig.autumn.dayStart;
  const autumnEnd = normalizeTime(autumnRaw.dayEnd) ?? defaultCourseTableConfig.autumn.dayEnd;
  const rawSlot = Number(raw.slotMinutes);
  const slotMinutes = rawSlot === 30 ? 30 : 60;

  return {
    currentTerm,
    spring: {
      dayStart: springStart,
      dayEnd: springEnd,
    },
    autumn: {
      dayStart: autumnStart,
      dayEnd: autumnEnd,
    },
    slotMinutes,
  };
}

export function resolveCourseDayWindow(config: CourseTableConfig) {
  const termWindow = config.currentTerm === "autumn" ? config.autumn : config.spring;
  const start = timeToMinutes(termWindow.dayStart);
  const end = timeToMinutes(termWindow.dayEnd);
  if (end <= start) {
    return {
      start: timeToMinutes(defaultCourseTableConfig.spring.dayStart),
      end: timeToMinutes(defaultCourseTableConfig.spring.dayEnd),
      slotMinutes: config.slotMinutes,
    };
  }

  return {
    start,
    end,
    slotMinutes: config.slotMinutes,
  };
}
