import { CourseScheduleItem, CourseTableConfig, normalizeCourseTableConfig, resolveCourseDayWindow } from "@/lib/course-schedule";

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function toMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function formatSlot(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function roundDownBy(value: number, unit: number) {
  return Math.floor(value / unit) * unit;
}

function roundUpBy(value: number, unit: number) {
  return Math.ceil(value / unit) * unit;
}

function calcTimeBounds(courses: CourseScheduleItem[], config: CourseTableConfig) {
  const window = resolveCourseDayWindow(config);
  if (courses.length === 0) {
    return window;
  }

  const minStart = Math.min(...courses.map((course) => toMinutes(course.startTime)));
  const maxEnd = Math.max(...courses.map((course) => toMinutes(course.endTime)));
  return {
    start: Math.min(window.start, roundDownBy(minStart, window.slotMinutes)),
    end: Math.max(window.end, roundUpBy(maxEnd, window.slotMinutes)),
    slotMinutes: window.slotMinutes,
  };
}

type CellRender =
  | { type: "skip" }
  | {
      type: "course";
      rowSpan: number;
      item: CourseScheduleItem;
    }
  | { type: "empty" };

function buildColumnRender(courses: CourseScheduleItem[], slotStartList: number[], slotMinutes: number): CellRender[] {
  const renders: CellRender[] = [];
  let skipRemaining = 0;

  for (const slotStart of slotStartList) {
    if (skipRemaining > 0) {
      renders.push({ type: "skip" });
      skipRemaining -= 1;
      continue;
    }

    const startsNow = courses.find((course) => toMinutes(course.startTime) === slotStart);
    if (!startsNow) {
      renders.push({ type: "empty" });
      continue;
    }

    const courseStart = toMinutes(startsNow.startTime);
    const courseEnd = toMinutes(startsNow.endTime);
    const duration = Math.max(slotMinutes, courseEnd - courseStart);
    const rowSpan = Math.max(1, Math.ceil(duration / slotMinutes));
    skipRemaining = rowSpan - 1;
    renders.push({
      type: "course",
      rowSpan,
      item: startsNow,
    });
  }

  return renders;
}

export function CourseWeekTable({
  courseSchedule,
  tableConfig,
}: {
  courseSchedule: CourseScheduleItem[];
  tableConfig: CourseTableConfig;
}) {
  const config = normalizeCourseTableConfig(tableConfig);
  const sorted = [...courseSchedule].sort((a, b) => (a.weekday !== b.weekday ? a.weekday - b.weekday : toMinutes(a.startTime) - toMinutes(b.startTime)));
  const bounds = calcTimeBounds(sorted, config);
  const slotStartList: number[] = [];
  for (let m = bounds.start; m < bounds.end; m += bounds.slotMinutes) {
    slotStartList.push(m);
  }

  const byWeekday = new Map<number, CourseScheduleItem[]>();
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    byWeekday.set(weekday, sorted.filter((course) => course.weekday === weekday));
  }
  const columnRender = new Map<number, CellRender[]>();
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    columnRender.set(weekday, buildColumnRender(byWeekday.get(weekday) ?? [], slotStartList, bounds.slotMinutes));
  }

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5" id="weekly-courses">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">课程表（周视图）</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            以课程块展示本周安排。当前学期：{config.currentTerm === "spring" ? "春季" : "秋季"}，粒度 {config.slotMinutes} 分钟。
          </p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-white/75 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">还没有课程数据。先到设置页导入或手动填写课表。</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[860px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2 text-left text-xs text-[var(--muted)]">时间</th>
                {weekdayLabels.map((label) => (
                  <th className="bg-[var(--panel)] px-3 py-2 text-left text-xs text-[var(--muted)]" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slotStartList.map((slotStart, rowIndex) => (
                <tr key={slotStart}>
                  <td className="sticky left-0 z-10 border-t border-[var(--line)] bg-white/90 px-3 py-2 text-xs text-[var(--muted)]">{formatSlot(slotStart)}</td>
                  {weekdayLabels.map((_, weekday) => {
                    const cell = columnRender.get(weekday)?.[rowIndex] ?? { type: "empty" as const };
                    if (cell.type === "skip") {
                      return null;
                    }
                    if (cell.type === "empty") {
                      return <td className="border-t border-l border-[var(--line)] bg-white/65 px-2 py-2 align-top" key={`${slotStart}-${weekday}`} />;
                    }

                    return (
                      <td
                        className="border-t border-l border-[var(--line)] bg-white/75 px-2 py-2 align-top"
                        key={`${slotStart}-${weekday}`}
                        rowSpan={cell.rowSpan}
                      >
                        <div className="rounded-lg bg-[var(--panel)] px-2 py-2 text-xs text-[var(--ink)] ring-1 ring-[var(--line)]">
                          <p className="font-medium">{cell.item.title}</p>
                          <p className="text-[var(--muted)]">
                            {cell.item.startTime}-{cell.item.endTime}
                            {cell.item.location ? ` · ${cell.item.location}` : ""}
                          </p>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
