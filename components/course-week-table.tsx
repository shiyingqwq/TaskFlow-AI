import { CourseScheduleItem, CourseTableConfig, normalizeCourseTableConfig } from "@/lib/course-schedule";
import { nowInTaipei } from "@/lib/time";

const displayWeekdays = [1, 2, 3, 4, 5, 6, 0] as const;
const weekdayLabels: Record<(typeof displayWeekdays)[number], string> = {
  0: "日",
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六",
};

function toMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function formatSlot(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function hashText(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getCourseTone(course: CourseScheduleItem) {
  const seed = hashText(`${course.title}-${course.location ?? ""}`);
  const hue = seed % 360;
  const saturation = 72;
  return {
    backgroundColor: `hsl(${hue} ${saturation}% 93%)`,
    borderColor: `hsl(${hue} ${saturation - 16}% 82%)`,
    color: `hsl(${hue} ${saturation - 28}% 33%)`,
  };
}

function getCurrentWeekDates() {
  const now = nowInTaipei();
  const day = now.day();
  const monday = now.add(day === 0 ? -6 : 1 - day, "day").startOf("day");
  return displayWeekdays.map((weekday, offset) => ({
    weekday,
    label: weekdayLabels[weekday],
    dateText: monday.add(offset, "day").format("D"),
    isToday: monday.add(offset, "day").isSame(now, "day"),
  }));
}

type CellRender =
  | { type: "skip" }
  | {
      type: "course";
      rowSpan: number;
      item: CourseScheduleItem;
    }
  | { type: "empty" };

function formatRange(start: number, slotMinutes: number) {
  return `${formatSlot(start)}-${formatSlot(start + slotMinutes)}`;
}

type PeriodSlot = {
  period: number;
  start: number;
  end: number;
};

const fixedPeriodSlots: PeriodSlot[] = [
  { period: 1, start: toMinutes("08:00"), end: toMinutes("08:40") },
  { period: 2, start: toMinutes("08:50"), end: toMinutes("09:30") },
  { period: 3, start: toMinutes("09:40"), end: toMinutes("10:20") },
  { period: 4, start: toMinutes("10:30"), end: toMinutes("11:10") },
  { period: 5, start: toMinutes("11:20"), end: toMinutes("12:00") },
  { period: 6, start: toMinutes("14:30"), end: toMinutes("15:10") },
  { period: 7, start: toMinutes("15:20"), end: toMinutes("16:00") },
  { period: 8, start: toMinutes("16:10"), end: toMinutes("16:50") },
  { period: 9, start: toMinutes("17:00"), end: toMinutes("17:40") },
  { period: 10, start: toMinutes("19:00"), end: toMinutes("19:40") },
];

function buildColumnRenderByPeriods(courses: CourseScheduleItem[], periods: PeriodSlot[]): CellRender[] {
  const renders: CellRender[] = periods.map(() => ({ type: "empty" }));
  for (const course of courses) {
    const courseStart = toMinutes(course.startTime);
    const courseEnd = toMinutes(course.endTime);
    const overlapIndexes = periods
      .map((period, index) => ({ index, overlap: Math.min(courseEnd, period.end) - Math.max(courseStart, period.start) }))
      .filter((item) => item.overlap > 0)
      .map((item) => item.index);
    if (overlapIndexes.length === 0) {
      continue;
    }
    const startIndex = overlapIndexes[0];
    const endIndex = overlapIndexes[overlapIndexes.length - 1];
    const rowSpan = endIndex - startIndex + 1;
    if (renders[startIndex].type !== "empty") {
      continue;
    }
    renders[startIndex] = {
      type: "course",
      rowSpan,
      item: course,
    };
    for (let index = startIndex + 1; index <= endIndex; index += 1) {
      renders[index] = { type: "skip" };
    }
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
  const periodSlots = fixedPeriodSlots;

  const byWeekday = new Map<number, CourseScheduleItem[]>();
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    byWeekday.set(weekday, sorted.filter((course) => course.weekday === weekday));
  }
  const columnRender = new Map<number, CellRender[]>();
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    columnRender.set(weekday, buildColumnRenderByPeriods(byWeekday.get(weekday) ?? [], periodSlots));
  }
  const weekDates = getCurrentWeekDates();
  const today = nowInTaipei();

  return (
    <section
      className="rounded-[30px] border border-[rgba(71,53,31,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(255,250,244,0.9))] p-5 shadow-[0_14px_34px_rgba(90,67,35,0.08)]"
      id="weekly-courses"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs text-[var(--muted)] ring-1 ring-[rgba(71,53,31,0.12)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400" />
            本周课表
          </div>
          <h3 className="mt-2 text-xl font-semibold">课程表</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {today.format("YYYY年M月")} · {config.currentTerm === "spring" ? "春季学期" : "秋季学期"} · 固定 10 节时间划分
          </p>
        </div>
        <span className="rounded-full bg-white/90 px-3 py-1 text-xs text-[var(--muted)] ring-1 ring-[rgba(71,53,31,0.12)]">
          {sorted.length} 节课
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-white/75 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">还没有课程数据。先到设置页导入或手动填写课表。</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="mx-auto table-fixed w-max min-w-[668px] border-separate border-spacing-0 text-sm">
            <colgroup>
              <col style={{ width: "74px" }} />
              {displayWeekdays.map((weekday) => (
                <col key={`col-${weekday}`} style={{ width: "84px" }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-[linear-gradient(180deg,rgba(255,253,250,1),rgba(255,249,241,1))] px-2 py-2 text-left text-xs text-[var(--muted)]">
                  节次
                </th>
                {weekDates.map((day) => (
                  <th className="bg-transparent px-1 py-2 text-center" key={`${day.weekday}-${day.dateText}`}>
                    <p className={`text-xs ${day.isToday ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"}`}>周{day.label}</p>
                    <p className={`text-sm ${day.isToday ? "font-semibold text-[var(--accent)]" : "text-[var(--ink)]"}`}>{day.dateText}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periodSlots.map((slot, rowIndex) => (
                <tr key={slot.period}>
                  <td className="sticky left-0 z-10 border-t border-[rgba(71,53,31,0.08)] bg-[linear-gradient(180deg,rgba(255,253,250,0.98),rgba(255,249,241,0.98))] px-2 py-2">
                    <p className="text-xs font-semibold text-[var(--ink)]">{slot.period}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--muted)]">{formatRange(slot.start, slot.end - slot.start)}</p>
                  </td>
                  {displayWeekdays.map((weekday) => {
                    const cell = columnRender.get(weekday)?.[rowIndex] ?? { type: "empty" as const };
                    if (cell.type === "skip") {
                      return null;
                    }
                    if (cell.type === "empty") {
                      return (
                        <td className="border-t border-l border-[rgba(71,53,31,0.06)] bg-white/55 px-1.5 py-1.5 align-top" key={`${slot.period}-${weekday}`}>
                          <div className="h-11 rounded-lg bg-white/45" />
                        </td>
                      );
                    }

                    const tone = getCourseTone(cell.item);
                    const blockMinHeight = Math.max(44, cell.rowSpan * 52 - 8);
                    return (
                      <td
                        className="border-t border-l border-[rgba(71,53,31,0.06)] bg-white/58 px-1.5 py-1.5 align-top"
                        key={`${slot.period}-${weekday}`}
                        rowSpan={cell.rowSpan}
                      >
                        <div
                          className="h-full rounded-xl border px-2 py-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
                          style={{ ...tone, minHeight: `${blockMinHeight}px` }}
                        >
                          <p className="font-semibold leading-5">{cell.item.title}</p>
                          <p className="mt-0.5 leading-4 opacity-90">
                            {cell.item.location ? `${cell.item.location}` : `${cell.item.startTime}-${cell.item.endTime}`}
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
