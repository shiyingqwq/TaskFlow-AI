import Link from "next/link";

import { CourseScheduleItem, getCoursesForDay } from "@/lib/course-schedule";
import type { TaskStatus } from "@/generated/prisma/enums";
import { formatDeadline } from "@/lib/time";
import { StatusBadge } from "@/components/status-badge";

type ScheduleTask = {
  id: string;
  title: string;
  status: TaskStatus;
  displayStatus?: TaskStatus | "blocked";
  deadline?: string | Date | null;
  nextActionSuggestion?: string | null;
  priorityScore?: number;
  estimatedMinutes?: number | null;
};

type TodayScheduleBoardProps = {
  mustDoTasks: ScheduleTask[];
  shouldDoTasks: ScheduleTask[];
  reminderTasks: ScheduleTask[];
  canWaitTasks: ScheduleTask[];
  courseSchedule: CourseScheduleItem[];
};

type ScheduleSlot = {
  id: string;
  label: string;
  period: string;
  hint: string;
  tasks: ScheduleTask[];
  startMinutes: number;
  endMinutes: number;
};

function toMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function formatMinutes(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function mergeCourseRanges(courses: CourseScheduleItem[]) {
  const sorted = [...courses]
    .map((course) => ({ start: toMinutes(course.startTime), end: toMinutes(course.endTime) }))
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev || range.start > prev.end) {
      merged.push({ ...range });
      continue;
    }
    prev.end = Math.max(prev.end, range.end);
  }
  return merged;
}

function buildFreeRanges(courses: CourseScheduleItem[]) {
  const dayStart = toMinutes("09:00");
  const dayEnd = toMinutes("21:30");
  const classRanges = mergeCourseRanges(courses);
  const free: Array<{ start: number; end: number }> = [];
  let cursor = dayStart;

  for (const range of classRanges) {
    const blockedStart = Math.max(dayStart, range.start);
    const blockedEnd = Math.min(dayEnd, range.end);
    if (blockedEnd <= dayStart || blockedStart >= dayEnd) {
      continue;
    }
    if (blockedStart > cursor) {
      free.push({ start: cursor, end: blockedStart });
    }
    cursor = Math.max(cursor, blockedEnd);
    if (cursor >= dayEnd) {
      break;
    }
  }

  if (cursor < dayEnd) {
    free.push({ start: cursor, end: dayEnd });
  }

  return free.filter((range) => range.end - range.start >= 30);
}

function buildSlotLabel(index: number, startMinutes: number) {
  const hour = Math.floor(startMinutes / 60);
  const prefix = hour < 12 ? "上午" : hour < 18 ? "下午" : "晚间";
  return `${prefix}时段 ${index + 1}`;
}

function getSlotTone(startMinutes: number) {
  if (startMinutes >= toMinutes("18:00")) {
    return "border-cyan-200 bg-cyan-50/45";
  }
  if (startMinutes >= toMinutes("12:00")) {
    return "border-amber-200 bg-amber-50/45";
  }
  return "border-rose-200 bg-rose-50/45";
}

function getSlotRailTone(startMinutes: number) {
  if (startMinutes >= toMinutes("18:00")) {
    return "bg-cyan-400";
  }
  if (startMinutes >= toMinutes("12:00")) {
    return "bg-amber-400";
  }
  return "bg-rose-400";
}

function buildSlotHint(startMinutes: number, hasTasks: boolean) {
  if (startMinutes >= toMinutes("18:00")) {
    return hasTasks ? "优先回看等待项，再补今天必须做的收尾动作。" : "这段建议做收尾、整理与明日预排。";
  }
  return hasTasks ? "先处理必须做，再推进顺手项，尽量一段内完成闭环。" : "这段留作机动窗口，可处理临时事项或短任务。";
}

function estimateTaskMinutes(task: ScheduleTask) {
  const explicit = Number(task.estimatedMinutes);
  if (Number.isFinite(explicit) && explicit >= 10 && explicit <= 480) {
    return Math.round(explicit);
  }

  if (task.status === "in_progress") {
    return 30;
  }

  const score = Number(task.priorityScore ?? 0);
  if (score >= 90) {
    return 120;
  }
  if (score >= 75) {
    return 90;
  }
  if (score >= 50) {
    return 60;
  }
  return 45;
}

function pickOneTaskFromGroups(
  groups: ScheduleTask[][],
  usedIds: Set<string>,
  remainingMinutes: number,
  mustFit: boolean,
) {
  for (const group of groups) {
    for (const task of group) {
      if (usedIds.has(task.id)) {
        continue;
      }
      const estimate = estimateTaskMinutes(task);
      if (mustFit && estimate > remainingMinutes) {
        continue;
      }
      return { task, estimate };
    }
  }
  return null;
}

function pickSlotTasks(input: TodayScheduleBoardProps, slot: ScheduleSlot, usedIds: Set<string>) {
  const maxTasks = slot.endMinutes - slot.startMinutes >= 150 ? 2 : 1;
  const eveningFirst = slot.startMinutes >= toMinutes("18:00");
  const groups = eveningFirst
    ? [input.reminderTasks, input.mustDoTasks, input.shouldDoTasks, input.canWaitTasks]
    : [input.mustDoTasks, input.shouldDoTasks, input.reminderTasks, input.canWaitTasks];

  const selected: ScheduleTask[] = [];
  let remaining = slot.endMinutes - slot.startMinutes;

  while (selected.length < maxTasks && remaining >= 25) {
    const picked =
      pickOneTaskFromGroups(groups, usedIds, remaining, true) ??
      (selected.length === 0 ? pickOneTaskFromGroups(groups, usedIds, remaining, false) : null);
    if (!picked) {
      break;
    }
    selected.push(picked.task);
    usedIds.add(picked.task.id);
    remaining -= Math.min(remaining, Math.max(25, picked.estimate));
  }

  return selected;
}

function buildScheduleSlots(input: TodayScheduleBoardProps): ScheduleSlot[] {
  const usedIds = new Set<string>();
  const todayCourses = getCoursesForDay(input.courseSchedule);
  const freeRanges = buildFreeRanges(todayCourses);
  return freeRanges.map((range, index) => {
    const slot: ScheduleSlot = {
      id: `slot-${index + 1}`,
      label: buildSlotLabel(index, range.start),
      period: `${formatMinutes(range.start)} - ${formatMinutes(range.end)}`,
      hint: "",
      tasks: [],
      startMinutes: range.start,
      endMinutes: range.end,
    };
    slot.tasks = pickSlotTasks(input, slot, usedIds);
    slot.hint = buildSlotHint(slot.startMinutes, slot.tasks.length > 0);
    return slot;
  });
}

export function TodayScheduleBoard(props: TodayScheduleBoardProps) {
  const slots = buildScheduleSlots(props);
  const totalFreeMinutes = slots.reduce((sum, slot) => sum + (slot.endMinutes - slot.startMinutes), 0);
  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[linear-gradient(160deg,rgba(255,252,246,0.92),rgba(255,255,255,0.9))] p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold">今日日程安排</h3>
          <p className="text-sm text-[var(--muted)]">系统已按课程空档自动切分可执行时段，并按优先级排入任务。</p>
        </div>
        <div className="rounded-2xl bg-white/75 px-3 py-2 text-right ring-1 ring-[var(--line)]">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">可执行窗口</p>
          <p className="text-sm font-semibold text-[var(--ink)]">{slots.length} 段 · {totalFreeMinutes} 分钟</p>
        </div>
      </div>

      {slots.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-white/75 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">
          今日课程已基本占满 09:00 - 21:30，可在课程间隙手动处理最紧急事项。
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {slots.map((slot) => (
            <article className={`rounded-[20px] border p-3.5 ${getSlotTone(slot.startMinutes)}`} key={slot.id}>
              <div className="grid gap-3 md:grid-cols-[220px_1fr] md:items-start">
                <div className="flex gap-3">
                  <span className={`mt-1 h-12 w-1.5 rounded-full ${getSlotRailTone(slot.startMinutes)}`} />
                  <div>
                    <p className="text-sm font-semibold text-[var(--ink)]">{slot.label}</p>
                    <p className="mt-1 inline-flex rounded-full bg-white px-2.5 py-1 text-xs text-[var(--muted)] ring-1 ring-[var(--line)]">{slot.period}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">时长 {slot.endMinutes - slot.startMinutes} 分钟</p>
                    <p className="mt-2 text-sm text-[var(--muted)]">{slot.hint}</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {slot.tasks.length === 0 ? (
                    <p className="rounded-xl bg-white/85 px-3 py-2 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">当前没有自动分配任务，可按实际情况自由安排。</p>
                  ) : (
                    slot.tasks.map((task) => (
                      <div className="rounded-xl bg-white/90 px-3 py-2.5 ring-1 ring-[var(--line)]" key={task.id}>
                        <div className="flex items-center justify-between gap-2">
                          <Link className="font-medium hover:text-[var(--accent)]" href={`/tasks/${task.id}`}>
                            {task.title}
                          </Link>
                          <StatusBadge status={task.displayStatus ?? task.status} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-[var(--panel)] px-2.5 py-1 text-[var(--muted)] ring-1 ring-[var(--line)]">
                            预估 {estimateTaskMinutes(task)} 分钟
                          </span>
                          {typeof task.priorityScore === "number" ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800 ring-1 ring-emerald-200">
                              分数 {task.priorityScore}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-[var(--muted)]">截止：{formatDeadline(task.deadline)}</p>
                        <p className="mt-0.5 text-sm text-[var(--muted)]">{task.nextActionSuggestion || "先推进最小可执行的一步。"}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
