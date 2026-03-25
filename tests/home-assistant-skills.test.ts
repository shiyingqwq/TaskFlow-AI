import { describe, expect, it } from "vitest";

import { detectAssistantSkill, getSkillToolCatalog } from "@/lib/home-assistant-skills";

describe("home assistant skills", () => {
  it("routes course-related queries to course_reader skill", () => {
    expect(detectAssistantSkill("今天课表和空档是什么")).toBe("course_reader");
  });

  it("routes schedule-adjustment queries to schedule_ops skill", () => {
    expect(detectAssistantSkill("把今日日程安排调整一下")).toBe("schedule_ops");
  });

  it("provides tool catalog for schedule skill", () => {
    expect(getSkillToolCatalog("schedule_ops")).toContain("get_today_schedule_summary");
    expect(getSkillToolCatalog("schedule_ops")).toContain("update_task_core(startAtISO/estimatedMinutes/snoozeUntilISO/status)");
  });
});
