import { CourseScheduleItem, getCoursesForDay } from "@/lib/course-schedule";
import { nowInTaipei } from "@/lib/time";

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function describeCourseState(course: CourseScheduleItem, nowMinutes: number) {
  const start = timeToMinutes(course.startTime);
  const end = timeToMinutes(course.endTime);

  if (nowMinutes >= start && nowMinutes < end) {
    return { label: "进行中", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" };
  }

  if (nowMinutes < start) {
    return { label: "即将开始", tone: "bg-amber-50 text-amber-900 ring-amber-200" };
  }

  return { label: "已结束", tone: "bg-white text-[var(--muted)] ring-[var(--line)]" };
}

function formatClock(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function TodayCoursesPanel({ courseSchedule }: { courseSchedule: CourseScheduleItem[] }) {
  const todayCourses = getCoursesForDay(courseSchedule);
  const now = nowInTaipei();
  const nowMinutes = now.hour() * 60 + now.minute();
  const nextCourse = todayCourses.find((course) => timeToMinutes(course.startTime) > nowMinutes) ?? null;
  const remainToNext = nextCourse ? timeToMinutes(nextCourse.startTime) - nowMinutes : null;

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[linear-gradient(160deg,rgba(255,252,246,0.92),rgba(255,255,255,0.9))] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">今日课程</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">课程是固定约束，不计入任务完成流转。</p>
        </div>
        <div className="rounded-xl bg-white/90 px-3 py-2 text-right ring-1 ring-[var(--line)]">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">当前时间</p>
          <p className="text-sm font-semibold text-[var(--ink)]">{formatClock(nowMinutes)}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-xl bg-white/85 px-3 py-2 ring-1 ring-[var(--line)]">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">今日课程</p>
          <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{todayCourses.length} 节</p>
        </div>
        <div className="rounded-xl bg-white/85 px-3 py-2 ring-1 ring-[var(--line)]">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">下一节</p>
          <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
            {nextCourse ? `${nextCourse.title} · ${remainToNext} 分钟后` : "今日课程已结束"}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {todayCourses.length === 0 ? (
          <p className="rounded-2xl bg-white/75 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">今天没有课程，任务安排将按可执行时段自动排布。</p>
        ) : (
          todayCourses.map((course) => {
            const state = describeCourseState(course, nowMinutes);
            return (
              <article className="rounded-[18px] bg-white/85 p-3 ring-1 ring-[var(--line)]" key={course.id}>
                <div className="grid gap-2 sm:grid-cols-[120px_1fr_auto] sm:items-center">
                  <div className="rounded-lg bg-[var(--panel)] px-2.5 py-2 text-xs text-[var(--muted)] ring-1 ring-[var(--line)]">
                    <p className="font-medium text-[var(--ink)]">{course.startTime}</p>
                    <p className="mt-0.5">至 {course.endTime}</p>
                  </div>
                  <div>
                    <p className="text-base font-semibold text-[var(--ink)]">{course.title}</p>
                    <p className="mt-0.5 text-sm text-[var(--muted)]">{course.location ? `${course.location}` : "地点未标注"}</p>
                  </div>
                  <span className={`justify-self-start rounded-full px-3 py-1 text-xs ring-1 sm:justify-self-end ${state.tone}`}>{state.label}</span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
