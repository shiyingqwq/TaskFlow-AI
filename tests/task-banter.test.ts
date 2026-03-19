import { describe, expect, it } from "vitest";

import { buildTaskBanterFallback } from "@/lib/task-banter";

describe("task banter fallback", () => {
  it("mentions waiting reasons when the task is blocked", () => {
    const text = buildTaskBanterFallback({
      id: "1",
      title: "补交材料",
      status: "waiting",
      deadline: null,
      deadlineText: null,
      deliveryType: "unknown",
      requiresSignature: false,
      requiresStamp: false,
      recurrenceType: "single",
      recurrenceTargetCount: 1,
      dependsOnExternal: true,
      waitingReasonText: "等老师回消息",
      nextActionSuggestion: "明天再问一次",
    });

    expect(text).toContain("等老师回消息");
  });

  it("treats paper-and-signature tasks as runaround work", () => {
    const text = buildTaskBanterFallback({
      id: "2",
      title: "提交纸质版申请表",
      status: "ready",
      deadline: null,
      deadlineText: "周五前",
      deliveryType: "paper",
      requiresSignature: true,
      requiresStamp: false,
      recurrenceType: "single",
      recurrenceTargetCount: 1,
      dependsOnExternal: false,
      waitingReasonText: null,
      nextActionSuggestion: "先打印再去找老师签字",
    });

    expect(text).toMatch(/纸质|签字|办公室|线下/);
  });
});
