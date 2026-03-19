import { describe, expect, it } from "vitest";

import { buildTodayBuckets } from "@/lib/today-view";

describe("today view buckets", () => {
  const base = new Date("2026-03-19T02:00:00.000Z");

  it("separates must-do, reminder, should-do, and can-wait tasks", () => {
    const buckets = buildTodayBuckets(
      [
        {
          id: "must-do",
          status: "in_progress",
          deadline: "2026-03-19T09:00:00.000Z",
          nextCheckAt: null,
          priorityScore: 90,
          needsHumanReview: false,
          isBlockedByPredecessor: false,
        },
        {
          id: "reminder",
          status: "waiting",
          deadline: "2026-03-22T09:00:00.000Z",
          nextCheckAt: "2026-03-19T11:00:00.000Z",
          priorityScore: 30,
          needsHumanReview: false,
          isBlockedByPredecessor: false,
        },
        {
          id: "should-do",
          status: "in_progress",
          deadline: "2026-03-21T09:00:00.000Z",
          nextCheckAt: null,
          priorityScore: 48,
          needsHumanReview: false,
          isBlockedByPredecessor: false,
        },
        {
          id: "can-wait",
          status: "in_progress",
          deadline: "2026-03-25T09:00:00.000Z",
          nextCheckAt: null,
          priorityScore: 18,
          needsHumanReview: false,
          isBlockedByPredecessor: false,
        },
      ],
      base,
    );

    expect(buckets.mustDo.map((task) => task.id)).toEqual(["must-do"]);
    expect(buckets.reminderQueue.map((task) => task.id)).toEqual(["reminder"]);
    expect(buckets.shouldDo.map((task) => task.id)).toEqual(["should-do"]);
    expect(buckets.canWait.map((task) => task.id)).toEqual(["can-wait"]);
  });

  it("keeps blocked and completed tasks out of the actionable today queues", () => {
    const buckets = buildTodayBuckets(
      [
        {
          id: "blocked",
          status: "in_progress",
          deadline: "2026-03-19T09:00:00.000Z",
          nextCheckAt: null,
          priorityScore: 80,
          needsHumanReview: false,
          isBlockedByPredecessor: true,
        },
        {
          id: "done",
          status: "done",
          deadline: "2026-03-19T09:00:00.000Z",
          nextCheckAt: null,
          priorityScore: 80,
          needsHumanReview: false,
          isBlockedByPredecessor: false,
        },
      ],
      base,
    );

    expect(buckets.mustDo).toHaveLength(0);
    expect(buckets.shouldDo).toHaveLength(0);
    expect(buckets.canWait).toHaveLength(0);
  });
});
