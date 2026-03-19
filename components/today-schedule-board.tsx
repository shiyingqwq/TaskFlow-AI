import Link from "next/link";

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
};

type ScheduleSlot = {
  id: string;
  label: string;
  period: string;
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
  const morning = takeDistinct(input.mustDoTasks, usedIds, 2);
  const afternoon = takeDistinct([...input.mustDoTasks, ...input.shouldDoTasks], usedIds, 2);
  const evening = takeDistinct([...input.reminderTasks, ...input.shouldDoTasks], usedIds, 2);
  const buffer = takeDistinct([...input.canWaitTasks, ...input.shouldDoTasks], usedIds, 1);

  return [
    {
      id: "morning",
      label: "上午主线",
      period: "09:00 - 11:30",
      hint: "先啃最硬的一到两件，避免被消息打断。",
      tasks: morning,
    },
    {
      id: "afternoon",
      label: "下午推进",
      period: "14:00 - 17:30",
      hint: "处理提交、跑流程、沟通确认等执行项。",
      tasks: afternoon,
    },
    {
      id: "evening",
      label: "晚间回看",
      period: "19:30 - 21:00",
      hint: "集中回看等待项并补一轮跟进。",
      tasks: evening,
    },
    {
      id: "buffer",
      label: "收尾缓冲",
      period: "21:00 - 21:30",
      hint: "确认明天第一件事，把能延后的任务后置。",
      tasks: buffer,
    },
  ];
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
                <p className="rounded-xl bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">当前没有自动分配任务，可按实际情况自由安排。</p>
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
