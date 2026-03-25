"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CourseScheduleItem, getCoursesForDay } from "@/lib/course-schedule";
import type { TaskStatus } from "@/generated/prisma/enums";
import { formatDeadline, nowInTaipei, toTaipei } from "@/lib/time";
import { StatusBadge } from "@/components/status-badge";

type ScheduleTask = {
  id: string;
  title: string;
  status: TaskStatus;
  displayStatus?: TaskStatus | "blocked";
  startAt?: string | Date | null;
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

type ScheduleFixCandidate = {
  type: "start_after_deadline";
  taskId: string;
  title: string;
  minimumBufferMinutes: number;
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

function compactText(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function inferEarliestStartMinutes(task: ScheduleTask, todayCourses: CourseScheduleItem[]) {
  const startAt = toTaipei(task.startAt);
  const today = nowInTaipei();
  if (startAt) {
    if (startAt.isAfter(today, "day")) {
      return toMinutes("23:59");
    }
    if (startAt.isSame(today, "day")) {
      return startAt.hour() * 60 + startAt.minute();
    }
  }

  if (todayCourses.length === 0) {
    return null;
  }

  const text = compactText(`${task.title} ${task.nextActionSuggestion ?? ""}`);
  const requiresAfterClass =
    /(复习|复盘|总结|回顾)/.test(text) &&
    /(当天|今日|今天)/.test(text) &&
    /(课程|上课|课堂|课)/.test(text);
  if (!requiresAfterClass) {
    return null;
  }

  const matchedCourseEnds = todayCourses
    .filter((course) => {
      const normalizedTitle = compactText(course.title);
      return normalizedTitle.length > 0 && text.includes(normalizedTitle);
    })
    .map((course) => toMinutes(course.endTime));

  if (matchedCourseEnds.length > 0) {
    return Math.max(...matchedCourseEnds);
  }

  // 未匹配到课程名时，保守放到当天最后一节课后。
  return Math.max(...todayCourses.map((course) => toMinutes(course.endTime)));
}

function pickOneTaskFromGroups(
  groups: ScheduleTask[][],
  usedIds: Set<string>,
  remainingMinutes: number,
  mustFit: boolean,
  canPlaceTask: (task: ScheduleTask) => boolean,
) {
  for (const group of groups) {
    for (const task of group) {
      if (usedIds.has(task.id)) {
        continue;
      }
      if (!canPlaceTask(task)) {
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

function pickSlotTasks(input: TodayScheduleBoardProps, slot: ScheduleSlot, usedIds: Set<string>, todayCourses: CourseScheduleItem[]) {
  const maxTasks = slot.endMinutes - slot.startMinutes >= 150 ? 2 : 1;
  const eveningFirst = slot.startMinutes >= toMinutes("18:00");
  const groups = eveningFirst
    ? [input.reminderTasks, input.mustDoTasks, input.shouldDoTasks, input.canWaitTasks]
    : [input.mustDoTasks, input.shouldDoTasks, input.reminderTasks, input.canWaitTasks];
  const canPlaceTask = (task: ScheduleTask) => {
    const earliestStartMinutes = inferEarliestStartMinutes(task, todayCourses);
    const deadline = task.deadline ? toTaipei(task.deadline) : null;
    const deadlineMinutes = deadline ? deadline.hour() * 60 + deadline.minute() : null;

    if (earliestStartMinutes !== null && deadlineMinutes !== null && earliestStartMinutes >= deadlineMinutes) {
      return false;
    }

    return earliestStartMinutes === null || slot.endMinutes > earliestStartMinutes;
  };

  const selected: ScheduleTask[] = [];
  let remaining = slot.endMinutes - slot.startMinutes;

  while (selected.length < maxTasks && remaining >= 25) {
    const picked =
      pickOneTaskFromGroups(groups, usedIds, remaining, true, canPlaceTask) ??
      (selected.length === 0 ? pickOneTaskFromGroups(groups, usedIds, remaining, false, canPlaceTask) : null);
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
    slot.tasks = pickSlotTasks(input, slot, usedIds, todayCourses);
    slot.hint = buildSlotHint(slot.startMinutes, slot.tasks.length > 0);
    return slot;
  });
}

function buildScheduleLintIssues(slots: ScheduleSlot[], courses: CourseScheduleItem[], tasks: ScheduleTask[]) {
  const issues: string[] = [];

  for (const slot of slots) {
    for (const task of slot.tasks) {
      const earliestStartMinutes = inferEarliestStartMinutes(task, courses);
      const deadline = task.deadline ? toTaipei(task.deadline) : null;
      const deadlineMinutes = deadline ? deadline.hour() * 60 + deadline.minute() : null;

      if (earliestStartMinutes !== null && deadlineMinutes !== null && earliestStartMinutes >= deadlineMinutes) {
        issues.push(`「${task.title}」开始时间约束已晚于截止时间（最早 ${formatMinutes(earliestStartMinutes)}，截止 ${formatDeadline(task.deadline)}）。`);
      }

      if (earliestStartMinutes !== null && slot.endMinutes <= earliestStartMinutes) {
        issues.push(`「${task.title}」被安排在 ${slot.period}，但最早应在 ${formatMinutes(earliestStartMinutes)} 后执行。`);
      }

      if (deadlineMinutes !== null) {
        if (slot.endMinutes > deadlineMinutes && slot.startMinutes < deadlineMinutes) {
          const estimate = estimateTaskMinutes(task);
          const effectiveStart = Math.max(slot.startMinutes, earliestStartMinutes ?? slot.startMinutes);
          const canFinishBeforeDeadline = effectiveStart + estimate <= deadlineMinutes;
          if (!canFinishBeforeDeadline) {
            issues.push(`「${task.title}」在 ${slot.period} 内难以在截止时间 ${formatDeadline(task.deadline)} 前完成，建议前移。`);
          }
        }
      }
    }
  }

  const assignedIds = new Set(slots.flatMap((slot) => slot.tasks.map((task) => task.id)));
  for (const task of tasks) {
    if (assignedIds.has(task.id)) {
      continue;
    }
    const earliestStartMinutes = inferEarliestStartMinutes(task, courses);
    const deadline = task.deadline ? toTaipei(task.deadline) : null;
    const deadlineMinutes = deadline ? deadline.hour() * 60 + deadline.minute() : null;

    if (earliestStartMinutes !== null && deadlineMinutes !== null && earliestStartMinutes >= deadlineMinutes) {
      issues.push(`「${task.title}」未被分配：最早开始 ${formatMinutes(earliestStartMinutes)} 已晚于截止 ${formatDeadline(task.deadline)}。`);
      continue;
    }

    if (earliestStartMinutes !== null) {
      const hasViableSlot = slots.some((slot) => slot.endMinutes > earliestStartMinutes);
      if (!hasViableSlot) {
        issues.push(`「${task.title}」未被分配：今天可执行窗口都早于最早开始 ${formatMinutes(earliestStartMinutes)}。`);
      }
    }
  }

  return issues.slice(0, 6);
}

function buildFixCandidates(tasks: ScheduleTask[], courses: CourseScheduleItem[]) {
  const candidates: ScheduleFixCandidate[] = [];
  for (const task of tasks) {
    const earliestStartMinutes = inferEarliestStartMinutes(task, courses);
    const deadline = task.deadline ? toTaipei(task.deadline) : null;
    const deadlineMinutes = deadline ? deadline.hour() * 60 + deadline.minute() : null;
    if (earliestStartMinutes !== null && deadlineMinutes !== null && earliestStartMinutes >= deadlineMinutes) {
      candidates.push({
        type: "start_after_deadline",
        taskId: task.id,
        title: task.title,
        minimumBufferMinutes: 20,
      });
    }
  }
  return candidates;
}

export function TodayScheduleBoard(props: TodayScheduleBoardProps) {
  const router = useRouter();
  const slots = useMemo(
    () => buildScheduleSlots(props),
    [props.mustDoTasks, props.shouldDoTasks, props.reminderTasks, props.canWaitTasks, props.courseSchedule],
  );
  const scheduleTasks = useMemo(
    () => [...props.mustDoTasks, ...props.shouldDoTasks, ...props.reminderTasks, ...props.canWaitTasks],
    [props.mustDoTasks, props.shouldDoTasks, props.reminderTasks, props.canWaitTasks],
  );
  const lintIssues = useMemo(
    () => buildScheduleLintIssues(slots, getCoursesForDay(props.courseSchedule), scheduleTasks),
    [slots, props.courseSchedule, scheduleTasks],
  );
  const [auditSummary, setAuditSummary] = useState<string>("");
  const [auditMode, setAuditMode] = useState<"ai" | "fallback" | "idle">("idle");
  const [auditPending, setAuditPending] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixNotice, setFixNotice] = useState<string>("");
  const totalFreeMinutes = slots.reduce((sum, slot) => sum + (slot.endMinutes - slot.startMinutes), 0);
  const todayCourses = useMemo(() => getCoursesForDay(props.courseSchedule), [props.courseSchedule]);
  const fixCandidates = useMemo(() => buildFixCandidates(scheduleTasks, todayCourses), [scheduleTasks, todayCourses]);

  useEffect(() => {
    let cancelled = false;
    async function runAudit() {
      setAuditPending(true);
      try {
        const response = await fetch("/api/schedule/audit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dateLabel: nowInTaipei().format("YYYY-MM-DD"),
            lintIssues,
            courses: todayCourses.map((course) => ({
              title: course.title,
              startTime: course.startTime,
              endTime: course.endTime,
            })),
            slots: slots.map((slot) => ({
              label: slot.label,
              period: slot.period,
              tasks: slot.tasks.map((task) => ({
                title: task.title,
                status: task.status,
                deadlineLabel: formatDeadline(task.deadline),
                estimateMinutes: estimateTaskMinutes(task),
              })),
            })),
          }),
        });

        if (!response.ok) {
          throw new Error("schedule audit request failed");
        }
        const payload = (await response.json()) as { text?: string; mode?: "ai" | "fallback" };
        if (cancelled) {
          return;
        }
        setAuditSummary(payload.text?.trim() || "");
        setAuditMode(payload.mode === "ai" ? "ai" : "fallback");
      } catch {
        if (cancelled) {
          return;
        }
        setAuditSummary(
          lintIssues.length > 0
            ? `检测到 ${lintIssues.length} 处排程风险，建议先处理高风险时段再执行。`
            : "当前排程未发现明显冲突，可按既定顺序推进。",
        );
        setAuditMode("fallback");
      } finally {
        if (!cancelled) {
          setAuditPending(false);
        }
      }
    }

    runAudit();
    return () => {
      cancelled = true;
    };
  }, [slots, todayCourses, lintIssues]);

  async function handleApplyFixes() {
    if (fixCandidates.length === 0 || fixing) {
      return;
    }
    if (!window.confirm(`将应用 ${fixCandidates.length} 条排程修复建议（会更新任务截止时间），是否继续？`)) {
      return;
    }
    setFixing(true);
    setFixNotice("");
    try {
      const response = await fetch("/api/schedule/fix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fixes: fixCandidates.map((item) => ({
            type: item.type,
            taskId: item.taskId,
            minimumBufferMinutes: item.minimumBufferMinutes,
          })),
        }),
      });
      const payload = (await response.json()) as { fixedCount?: number; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "修复失败");
      }
      const fixedCount = payload.fixedCount ?? 0;
      setFixNotice(fixedCount > 0 ? `已自动修复 ${fixedCount} 条冲突任务。` : "未发现可自动修复项。");
      router.refresh();
    } catch (error) {
      setFixNotice(error instanceof Error ? error.message : "修复失败，请稍后重试。");
    } finally {
      setFixing(false);
    }
  }

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

      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-white/85 px-3 py-2 text-sm text-[var(--muted)]">
          <p>
            <span className="font-medium text-[var(--ink)]">规则审核：</span>
            {lintIssues.length > 0 ? `发现 ${lintIssues.length} 处可疑安排` : "未发现明显冲突"}
          </p>
          {fixCandidates.length > 0 ? (
            <button
              className="rounded-full border border-[rgba(178,75,42,0.24)] bg-[rgba(178,75,42,0.1)] px-3 py-1 text-xs text-[var(--accent)] transition hover:bg-[rgba(178,75,42,0.16)] disabled:opacity-60"
              disabled={fixing}
              onClick={() => {
                void handleApplyFixes();
              }}
              type="button"
            >
              {fixing ? "修复中..." : "应用修复建议"}
            </button>
          ) : null}
        </div>
        {fixNotice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{fixNotice}</div> : null}
        {lintIssues.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {lintIssues[0]}
          </div>
        ) : null}
        <div className="rounded-xl border border-[var(--line)] bg-white/85 px-3 py-2 text-sm text-[var(--muted)]">
          <span className="font-medium text-[var(--ink)]">AI 审核：</span>
          {auditPending
            ? "正在审核当前排程合理性..."
            : auditSummary || "尚未生成审核结论。"}
          {!auditPending && auditMode !== "idle" ? (
            <span className="ml-2 rounded-full bg-[var(--panel)] px-2 py-0.5 text-xs text-[var(--muted)] ring-1 ring-[var(--line)]">
              {auditMode === "ai" ? "AI" : "Fallback"}
            </span>
          ) : null}
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
