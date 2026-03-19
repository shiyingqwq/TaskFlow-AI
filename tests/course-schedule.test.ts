import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import {
  getCourseOverlapMinutes,
  getCoursesForDay,
  normalizeCourseSchedule,
  normalizeCourseTableConfig,
  parseCourseScheduleText,
  resolveCourseDayWindow,
} from "@/lib/course-schedule";

describe("course schedule", () => {
  it("parses editable text lines into normalized schedule items", () => {
    const parsed = parseCourseScheduleText("周一 08:00-09:40 内科学 @一教201\n周三 10:10-11:50 病理学");
    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({
      weekday: 1,
      startTime: "08:00",
      endTime: "09:40",
      title: "内科学",
      location: "一教201",
    });
  });

  it("filters courses by today's weekday", () => {
    const schedule = normalizeCourseSchedule([
      { id: "a", title: "A", weekday: 1, startTime: "08:00", endTime: "09:00" },
      { id: "b", title: "B", weekday: 2, startTime: "10:00", endTime: "11:00" },
    ]);

    const monday = dayjs.tz("2026-03-23 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei").toDate();
    const result = getCoursesForDay(schedule, monday);
    expect(result.map((item) => item.id)).toEqual(["a"]);
  });

  it("calculates overlap minutes between course and schedule slot", () => {
    const overlap = getCourseOverlapMinutes(
      { startTime: "08:30", endTime: "10:00" },
      { startTime: "09:00", endTime: "11:30" },
    );
    expect(overlap).toBe(60);
  });

  it("normalizes term config and resolves day window", () => {
    const config = normalizeCourseTableConfig({
      currentTerm: "autumn",
      autumn: { dayStart: "08:30", dayEnd: "21:30" },
      slotMinutes: 30,
    });

    const window = resolveCourseDayWindow(config);
    expect(window.start).toBe(510);
    expect(window.end).toBe(1290);
    expect(window.slotMinutes).toBe(30);
  });
});
