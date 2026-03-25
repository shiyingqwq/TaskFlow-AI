import { describe, expect, it } from "vitest";

import { inferWeeklyRecurrenceDaysFromText } from "@/lib/server/tasks";

describe("assistant recurrence hint", () => {
  it("extracts explicit weekly weekday from text", () => {
    expect(inferWeeklyRecurrenceDaysFromText("请添加每周三重复任务：复习当天核医学课程")).toEqual([3]);
    expect(inferWeeklyRecurrenceDaysFromText("每星期二和星期四晚上复习病例")).toEqual([2, 4]);
  });

  it("does not force weekly recurrence without explicit weekly marker", () => {
    expect(inferWeeklyRecurrenceDaysFromText("周三下午三点去打印材料")).toBeNull();
    expect(inferWeeklyRecurrenceDaysFromText("明天复习核医学课程")).toBeNull();
  });
});

