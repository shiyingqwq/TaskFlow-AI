import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import { buildReviewState, normalizeReviewReasons } from "@/lib/task-review";

describe("task review rules", () => {
  it("only blocks on high-risk review items", () => {
    const base = dayjs.tz("2026-03-18 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const result = buildReviewState(
      {
        taskType: "submission",
        deliveryType: "paper",
        deadline: "2027-03-01T10:00:00.000Z",
        deadlineText: "3月1号",
        submitTo: null,
        submitChannel: null,
        requiresSignature: false,
        requiresStamp: false,
        materials: [],
        dependsOnExternal: true,
        waitingFor: null,
        confidence: 0.9,
        description: "",
      },
      base,
    );

    expect(result.needsHumanReview).toBe(true);
    expect(result.reviewReasons).toContain("请确认截止时间");
    expect(result.reviewReasons).toContain("请确认是否需要签字或盖章");
    expect(result.reviewReasons).toContain("请确认是否需要线下提交");
    expect(result.reviewReasons).toContain("请确认是否依赖他人配合");
    expect(result.lowRiskItems.map((item) => item.label)).toContain("提交对象还不够明确，可顺手补充");
  });

  it("normalizes review reasons from json-like values", () => {
    expect(normalizeReviewReasons(["a", " b ", 1])).toEqual(["a", "b", "1"]);
    expect(normalizeReviewReasons(null)).toEqual([]);
  });

  it("keeps low-risk issues out of the blocking queue", () => {
    const result = buildReviewState({
      taskType: "submission",
      deliveryType: "electronic",
      deadline: "2026-03-20T10:00:00.000Z",
      deadlineText: "3月20日",
      submitTo: null,
      submitChannel: "线上",
      requiresSignature: false,
      requiresStamp: false,
      materials: [],
      dependsOnExternal: false,
      waitingFor: null,
      confidence: 0.6,
      description: "",
    });

    expect(result.needsHumanReview).toBe(false);
    expect(result.highRiskItems).toHaveLength(0);
    expect(result.lowRiskItems.length).toBeGreaterThan(0);
  });
});
