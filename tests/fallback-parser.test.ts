import { describe, expect, it } from "vitest";

import { buildFallbackExtraction } from "@/lib/parser/fallback";

describe("fallback parser", () => {
  it("splits a notification into multiple chained tasks", () => {
    const result = buildFallbackExtraction(
      "今晚23:00前交电子版，明天中午前交纸质版两份，需要辅导员签字并到学院办公室盖章后送到学工办。",
    );

    expect(result.tasks.length).toBeGreaterThanOrEqual(4);
    expect(result.tasks.some((task) => task.requiresSignature)).toBe(true);
    expect(result.tasks.some((task) => task.requiresStamp)).toBe(true);
    expect(result.tasks.some((task) => task.deliveryType === "paper")).toBe(true);
  });
});
