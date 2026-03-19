import Link from "next/link";

import { CourseScheduleItem, getCourseOverlapMinutes, getCoursesForDay } from "@/lib/course-schedule";
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
  startTime: string;
  endTime: string;
  hint: string;
  tasks: ScheduleTask[];
};

function takeDistinct(tasks: ScheduleTask[], usedIds: Set<string>, count: number) {
  const selected: ScheduleTask[] = [];
  for (const task of tasks) {
    if (usedIds.has(task.id)) {
      continue;
    }
    selected.push(task);
    usedIds.add(task.id);
    if (selected.length >= count) {
      break;
    }
  }
  return selected;
}

function buildScheduleSlots(input: TodayScheduleBoardProps): ScheduleSlot[] {
  const usedIds = new Set<string>();
  const todayCourses = getCoursesForDay(input.courseSchedule);
  const slots: ScheduleSlot[] = [
    {
      id: "morning",
      label: "上午主线",
      period: "09:00 - 11:30",
      startTime: "09:00",
      endTime: "11:30",
      hint: "先啃最硬的一到两件，避免被消息打断。",
      tasks: [],
    },
    {
      id: "afternoon",
      label: "下午推进",
      period: "14:00 - 17:30",
      startTime: "14:00",
      endTime: "17:30",
      hint: "处理提交、跑流程、沟通确认等执行项。",
      tasks: [],
    },
    {
      id: "evening",
      label: "晚间回看",
      period: "19:30 - 21:00",
      startTime: "19:30",
      endTime: "21:00",
      hint: "集中回看等待项并补一轮跟进。",
      tasks: [],
    },
    {
      id: "buffer",
      label: "收尾缓冲",
      period: "21:00 - 21:30",
      startTime: "21:00",
      endTime: "21:30",
      hint: "确认明天第一件事，把能延后的任务后置。",
      tasks: [],
    },
  ];

  const slotCourseMap = new Map<string, CourseScheduleItem[]>();
  for (const slot of slots) {
    const blockingCourses = todayCourses.filter((course) => getCourseOverlapMinutes(course, slot) >= 60);
    slotCourseMap.set(slot.id, blockingCourses);
  }

  for (const slot of slots) {
    const hasClassConflict = (slotCourseMap.get(slot.id) ?? []).length > 0;
    if (hasClassConflict) {
      slot.tasks = [];
      continue;
    }

    if (slot.id === "morning") {
      slot.tasks = takeDistinct(input.mustDoTasks, usedIds, 2);
    } else if (slot.id === "afternoon") {
      slot.tasks = takeDistinct([...input.mustDoTasks, ...input.shouldDoTasks], usedIds, 2);
    } else if (slot.id === "evening") {
      slot.tasks = takeDistinct([...input.reminderTasks, ...input.shouldDoTasks], usedIds, 2);
    } else {
      slot.tasks = takeDistinct([...input.canWaitTasks, ...input.shouldDoTasks], usedIds, 1);
    }
  }

  return slots;
}

export function TodayScheduleBoard(props: TodayScheduleBoardProps) {
  const slots = buildScheduleSlots(props);
  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold">今日日程安排</h3>
        <p className="text-sm text-[var(--muted)]">系统按优先级自动排了 4 个时间段，你可以直接照着推进。</p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {slots.map((slot) => (
          <article className="rounded-[22px] bg-white/80 p-4 ring-1 ring-[var(--line)]" key={slot.id}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[var(--ink)]">{slot.label}</p>
              <span className="rounded-full bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)] ring-1 ring-[var(--line)]">{slot.period}</span>
            </div>
            <p className="mt-2 text-sm text-[var(--muted)]">{slot.hint}</p>

            <div className="mt-3 space-y-3">
              {slot.tasks.length === 0 ? (
                <p className="rounded-xl bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">
                  {getCoursesForDay(props.courseSchedule).some((course) => getCourseOverlapMinutes(course, slot) >= 60)
                    ? "该时段被课程占用，系统已避免排入任务。"
                    : "当前没有自动分配任务，可按实际情况自由安排。"}
                </p>
              ) : (
                slot.tasks.map((task) => (
                  <div className="rounded-xl bg-white px-3 py-3 ring-1 ring-[var(--line)]" key={task.id}>
                    <div className="flex items-center justify-between gap-2">
                      <Link className="font-medium hover:text-[var(--accent)]" href={`/tasks/${task.id}`}>
                        {task.title}
                      </Link>
                      <StatusBadge status={task.displayStatus ?? task.status} />
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">截止：{formatDeadline(task.deadline)}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{task.nextActionSuggestion || "先推进最小可执行的一步。"}</p>
                  </div>
                ))
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
