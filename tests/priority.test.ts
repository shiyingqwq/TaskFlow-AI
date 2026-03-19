import { describe, expect, it } from "vitest";

import { calculatePriority } from "@/lib/scoring/priority";

describe("priority scoring", () => {
  it("pushes overdue offline tasks to the top", () => {
    const result = calculatePriority({
      id: "1",
      title: "送交纸质材料",
      status: "ready",
      deadline: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      taskType: "offline",
      deliveryType: "paper",
      requiresSignature: true,
      requiresStamp: true,
      dependsOnExternal: false,
      waitingFor: null,
      nextActionSuggestion: "马上联系办公室并送交",
      successorCount: 1,
    });

    expect(result.priorityScore).toBeGreaterThanOrEqual(180);
    expect(result.priorityReason).toContain("已逾期");
  });

  it("does not keep overdue wording after the deadline is moved back into the future", () => {
    const result = calculatePriority({
      id: "2",
      title: "补录表格",
      status: "overdue",
      deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      taskType: "followup",
      deliveryType: "unknown",
      requiresSignature: false,
      requiresStamp: false,
      dependsOnExternal: false,
      waitingFor: null,
      nextActionSuggestion: "现在开始补录",
      successorCount: 0,
    });

    expect(result.priorityReason).not.toContain("任务已被标记为逾期");
    expect(result.priorityReason).not.toContain("已逾期，截止时间是");
  });
});
