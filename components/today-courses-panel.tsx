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

export function TodayCoursesPanel({ courseSchedule }: { courseSchedule: CourseScheduleItem[] }) {
  const todayCourses = getCoursesForDay(courseSchedule);
  const now = nowInTaipei();
  const nowMinutes = now.hour() * 60 + now.minute();

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">今日课程</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">课程是固定约束，不计入任务完成流转。</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">{todayCourses.length} 节</span>
      </div>

      <div className="mt-4 space-y-3">
        {todayCourses.length === 0 ? (
          <p className="rounded-2xl bg-white/75 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">今天没有课程，任务安排将按可执行时段自动排布。</p>
        ) : (
          todayCourses.map((course) => {
            const state = describeCourseState(course, nowMinutes);
            return (
              <article className="rounded-[20px] bg-white/80 p-4 ring-1 ring-[var(--line)]" key={course.id}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-[var(--ink)]">{course.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {course.startTime} - {course.endTime}
                      {course.location ? ` · ${course.location}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs ring-1 ${state.tone}`}>{state.label}</span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
