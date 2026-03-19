import { describe, expect, it } from "vitest";

import { inferTaskStatus, normalizeSubmittedStatus, resolveRecalculatedStatus } from "@/lib/task-status";

describe("task status rules", () => {
  it("restores a computed non-overdue status when an overdue task is moved back into the future", () => {
    const result = resolveRecalculatedStatus(
      {
        status: "overdue",
        confidence: 0.9,
        deadline: "2026-03-20T10:00:00.000Z",
        deadlineText: "3月20日18:00前",
        taskType: "submission",
        deliveryType: "electronic",
        dependsOnExternal: false,
        waitingFor: null,
      },
      undefined,
    );

    expect(result).toBe("pending_submit");
  });

  it("keeps waiting tasks from being auto-overwritten to overdue", () => {
    const result = resolveRecalculatedStatus(
      {
        status: "waiting",
        confidence: 0.9,
        deadline: "2026-03-18T10:00:00.000Z",
        deadlineText: "明天 18:00",
        taskType: "submission",
        deliveryType: "paper",
        dependsOnExternal: true,
        waitingFor: "等辅导员确认名单",
      },
      "overdue",
    );

    expect(result).toBe("waiting");
  });

  it("marks ambiguous deadlines as needs_review", () => {
    const result = inferTaskStatus({
      confidence: 0.9,
      deadline: null,
      deadlineText: "尽快提交，具体时间待定",
      taskType: "submission",
      deliveryType: "unknown",
      dependsOnExternal: false,
      waitingFor: null,
    });

    expect(result).toBe("needs_review");
  });

  it("marks tasks with a structured waiting reason as waiting", () => {
    const result = inferTaskStatus({
      confidence: 0.9,
      deadline: "2026-03-20T10:00:00.000Z",
      deadlineText: "3月20日",
      taskType: "offline",
      deliveryType: "paper",
      dependsOnExternal: false,
      waitingFor: null,
      waitingReasonType: "printing_blocked",
      waitingReasonText: "今天不方便打印",
      nextCheckAt: "2026-03-19T01:00:00.000Z",
    });

    expect(result).toBe("waiting");
  });

  it("defaults actionable non-submission tasks to in_progress", () => {
    const result = inferTaskStatus({
      confidence: 0.9,
      deadline: "2026-03-20T10:00:00.000Z",
      deadlineText: "3月20日",
      taskType: "followup",
      deliveryType: "unknown",
      dependsOnExternal: false,
      waitingFor: null,
    });

    expect(result).toBe("in_progress");
  });

  it("upgrades legacy ready tasks to the new default status during recalculation", () => {
    const result = resolveRecalculatedStatus(
      {
        status: "ready",
        confidence: 0.9,
        deadline: "2026-03-20T10:00:00.000Z",
        deadlineText: "3月20日",
        taskType: "followup",
        deliveryType: "unknown",
        dependsOnExternal: false,
        waitingFor: null,
      },
      undefined,
    );

    expect(result).toBe("in_progress");
  });

  it("normalizes legacy submitted tasks to done when there is no pending wait", () => {
    const result = normalizeSubmittedStatus({
      confidence: 0.9,
      deadline: "2026-03-20T10:00:00.000Z",
      deadlineText: "3月20日",
      taskType: "submission",
      deliveryType: "electronic",
      dependsOnExternal: false,
      waitingFor: null,
    });

    expect(result).toBe("done");
  });

  it("normalizes legacy submitted tasks to waiting when follow-up is still pending", () => {
    const result = normalizeSubmittedStatus({
      confidence: 0.9,
      deadline: "2026-03-20T10:00:00.000Z",
      deadlineText: "3月20日",
      taskType: "submission",
      deliveryType: "electronic",
      dependsOnExternal: true,
      waitingFor: "等老师公示结果",
    });

    expect(result).toBe("waiting");
  });
});
