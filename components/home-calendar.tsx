"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Task } from "@/generated/prisma/client";

import { nowInTaipei, toTaipei } from "@/lib/time";

type CalendarTask = Pick<Task, "id" | "title" | "status" | "deadline" | "nextCheckAt">;

type CalendarEvent = {
  taskId: string;
  title: string;
  kind: "deadline" | "follow_up";
  atLabel: string;
  status: CalendarTask["status"];
  isCompleted: boolean;
};

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

function buildCalendarDays(tasks: CalendarTask[]) {
  const base = nowInTaipei();
  const monthStart = base.startOf("month");
  const monthEnd = base.endOf("month");
  const startOffset = (monthStart.day() + 6) % 7;
  const rangeStart = monthStart.subtract(startOffset, "day");
  const endOffset = 6 - ((monthEnd.day() + 6) % 7);
  const rangeEnd = monthEnd.add(endOffset, "day");

  const eventMap = new Map<string, CalendarEvent[]>();

  for (const task of tasks) {
    const deadline = toTaipei(task.deadline);
    if (deadline && deadline.isSame(base, "month")) {
      const key = deadline.format("YYYY-MM-DD");
      const events = eventMap.get(key) ?? [];
      events.push({
        taskId: task.id,
        title: task.title,
        kind: "deadline",
        atLabel: deadline.format("HH:mm"),
        status: task.status,
        isCompleted: ["done", "submitted"].includes(task.status),
      });
      eventMap.set(key, events);
    }

    const followUp = toTaipei(task.nextCheckAt);
    if (followUp && followUp.isSame(base, "month")) {
      const key = followUp.format("YYYY-MM-DD");
      const events = eventMap.get(key) ?? [];
      events.push({
        taskId: task.id,
        title: task.title,
        kind: "follow_up",
        atLabel: followUp.format("HH:mm"),
        status: task.status,
        isCompleted: ["done", "submitted"].includes(task.status),
      });
      eventMap.set(key, events);
    }
  }

  const days: Array<{
    key: string;
    label: string;
    isCurrentMonth: boolean;
    isToday: boolean;
    events: CalendarEvent[];
  }> = [];

  let cursor = rangeStart;
  while (cursor.isBefore(rangeEnd) || cursor.isSame(rangeEnd, "day")) {
    const key = cursor.format("YYYY-MM-DD");
    days.push({
      key,
      label: cursor.format("D"),
      isCurrentMonth: cursor.month() === base.month(),
      isToday: cursor.isSame(base, "day"),
      events: (eventMap.get(key) ?? []).sort((left, right) => {
        if (left.isCompleted !== right.isCompleted) {
          return Number(left.isCompleted) - Number(right.isCompleted);
        }

        return left.atLabel.localeCompare(right.atLabel);
      }),
    });
    cursor = cursor.add(1, "day");
  }

  return {
    monthLabel: base.format("YYYY年M月"),
    days,
  };
}

export function HomeCalendar({ tasks }: { tasks: CalendarTask[] }) {
  const calendar = useMemo(() => buildCalendarDays(tasks), [tasks]);
  const defaultSelectedDayKey =
    calendar.days.find((day) => day.isToday && day.events.length > 0)?.key ??
    calendar.days.find((day) => day.events.length > 0)?.key ??
    calendar.days.find((day) => day.isToday)?.key ??
    calendar.days[0]?.key ??
    null;
  const [selectedDayKey, setSelectedDayKey] = useState(defaultSelectedDayKey);
  const selectedDay = calendar.days.find((day) => day.key === selectedDayKey) ?? null;

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-2xl font-semibold">本月日历</h3>
          <p className="mt-2 text-sm text-[var(--muted)]">把截止日和等待回看日放到同一张月历里，少在列表里来回找。</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
          <span>{calendar.monthLabel}</span>
          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-700">截止日</span>
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-700">回看日</span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-600">已完成</span>
        </div>
      </div>

      <div className="-mx-2 mt-5 overflow-x-auto px-2 pb-2 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="grid min-w-[42rem] grid-cols-7 gap-2 sm:min-w-0">
          {weekdayLabels.map((label) => (
            <div className="px-1 py-1 text-center text-[10px] font-medium text-[var(--muted)] sm:px-2 sm:text-xs" key={label}>
              {label}
            </div>
          ))}
          {calendar.days.map((day) => (
            <div
              className={`min-h-24 cursor-pointer rounded-[18px] border p-2 transition duration-150 ease-out hover:-translate-y-0.5 hover:border-[var(--accent)] active:scale-[0.98] sm:min-h-28 sm:rounded-[20px] sm:p-2 ${
                day.isCurrentMonth ? "border-[var(--line)] bg-white/80" : "border-transparent bg-white/35 text-[var(--muted)]"
              } ${day.isToday ? "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--panel)]" : ""} ${
                selectedDayKey === day.key
                  ? "border-[var(--accent)] bg-[linear-gradient(180deg,rgba(255,243,235,0.98),rgba(255,255,255,0.92))] shadow-[0_14px_30px_rgba(178,75,42,0.12),inset_0_0_0_1px_rgba(178,75,42,0.18)]"
                  : ""
              }`}
              key={day.key}
              onClick={() => setSelectedDayKey(day.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedDayKey(day.key);
                }
              }}
              role="button"
              tabIndex={0}
            >
            {(() => {
              const pendingDeadlineCount = day.events.filter((event) => event.kind === "deadline" && !event.isCompleted).length;
              const followUpCount = day.events.filter((event) => event.kind === "follow_up" && !event.isCompleted).length;
              const completedCount = day.events.filter((event) => event.isCompleted).length;
              const headerMarkers = [
                pendingDeadlineCount > 0 ? "deadline" : null,
                followUpCount > 0 ? "follow_up" : null,
                completedCount > 0 ? "completed" : null,
              ].filter((item): item is "deadline" | "follow_up" | "completed" => Boolean(item));

              return (
                <>
            <div className="flex items-center justify-between">
              <span
                className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-medium transition sm:h-7 sm:min-w-7 sm:text-sm ${
                  selectedDayKey === day.key
                    ? "bg-[var(--accent)] text-white shadow-[0_8px_16px_rgba(178,75,42,0.24)]"
                    : day.isToday
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : ""
                }`}
              >
                {day.label}
              </span>
              {headerMarkers.length > 0 ? (
                <span className="flex items-center gap-1">
                  {headerMarkers.map((marker) => (
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        marker === "deadline"
                          ? "bg-rose-400"
                          : marker === "follow_up"
                            ? "bg-sky-400"
                            : "bg-zinc-400"
                      }`}
                      key={`${day.key}-${marker}`}
                    />
                  ))}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex min-h-10 flex-wrap content-start gap-1 sm:hidden">
              {pendingDeadlineCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                  {pendingDeadlineCount}
                </span>
              ) : null}
              {followUpCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                  <span className="text-[11px] leading-none">↺</span>
                  {followUpCount}
                </span>
              ) : null}
              {completedCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                  <span className="text-[11px] leading-none">✓</span>
                  {completedCount}
                </span>
              ) : null}
            </div>
            <div className="mt-2 hidden space-y-1.5 sm:block">
              {day.events.slice(0, 2).map((event, index) => (
                <Link
                  className={`block rounded-xl px-2 py-1 text-[11px] leading-5 ${
                    event.isCompleted
                      ? "bg-zinc-100 text-zinc-500 line-through decoration-zinc-400"
                      : event.kind === "deadline"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-sky-50 text-sky-700"
                  }`}
                  href={`/tasks/${event.taskId}`}
                  key={`${day.key}-${event.kind}-${event.taskId}-${event.atLabel}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="flex items-center gap-1">
                    <span className="shrink-0">{event.isCompleted ? "✓" : event.atLabel}</span>
                    <span className="block min-w-0 flex-1 truncate">{event.title}</span>
                  </span>
                </Link>
              ))}
              {day.events.length > 2 ? <p className="px-1 text-[11px] text-[var(--muted)]">+{day.events.length - 2} 项</p> : null}
            </div>
                </>
              );
            })()}
            </div>
          ))}
        </div>
      </div>

      {selectedDay ? (
        <div className="mt-5 rounded-[24px] bg-[linear-gradient(180deg,rgba(255,248,241,0.96),rgba(255,255,255,0.88))] p-4 ring-1 ring-[rgba(178,75,42,0.18)] shadow-[0_16px_32px_rgba(178,75,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">当天任务</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h4 className="text-lg font-semibold text-[var(--text)]">{selectedDay.key}</h4>
                {selectedDay.isToday ? (
                  <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white">今天</span>
                ) : null}
              </div>
            </div>
            <span className="rounded-full bg-white/85 px-3 py-1 text-xs text-[var(--muted)] ring-1 ring-[rgba(178,75,42,0.14)]">
              {selectedDay.events.length} 项
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {selectedDay.events.length === 0 ? (
              <p className="rounded-[18px] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">
                这一天当前没有截止项或回看项。
              </p>
            ) : (
              selectedDay.events.map((event) => (
                <Link
                  className="block rounded-[18px] bg-[var(--panel)] px-4 py-3 ring-1 ring-[var(--line)] transition hover:border-[var(--accent)] hover:ring-[var(--accent)]"
                  href={`/tasks/${event.taskId}`}
                  key={`selected-${selectedDay.key}-${event.kind}-${event.taskId}-${event.atLabel}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs ${
                          event.isCompleted
                            ? "bg-zinc-100 text-zinc-600"
                            : event.kind === "deadline"
                              ? "bg-rose-100 text-rose-700"
                              : "bg-sky-100 text-sky-700"
                        }`}
                      >
                        {event.isCompleted ? "已完成" : event.kind === "deadline" ? "截止" : "回看"}
                      </span>
                      <p className={`min-w-0 flex-1 truncate text-sm ${event.isCompleted ? "text-zinc-500 line-through" : "text-[var(--text)]"}`}>
                        {event.title}
                      </p>
                    </div>
                    <span className="text-xs text-[var(--muted)]">{event.isCompleted ? "✓" : event.atLabel}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
