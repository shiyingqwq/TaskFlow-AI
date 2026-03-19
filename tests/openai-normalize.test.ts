import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import { buildTaskExtractionSystemPrompt, buildTaskExtractionUserPrompt, normalizeDeadline } from "@/lib/parser/openai";

describe("openai deadline normalization", () => {
  it("prefers AI structured ISO when text parsing conflicts", () => {
    const base = dayjs.tz("2026-03-18 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const result = normalizeDeadline("2024-03-20T10:00:00.000Z", "3月20号", base);

    expect(result.deadlineISO?.startsWith("2024-03-20")).toBe(true);
    expect(result.deadlineText).toBe("3月20号");
  });

  it("injects active identities into the task extraction prompt", () => {
    const prompt = buildTaskExtractionUserPrompt("班长汇总名单，同学自行提交。", ["班长", "团支书"]);

    expect(prompt).toContain("当前用户身份：班长、团支书");
    expect(prompt).toContain("优先识别这些身份直接需要执行");
  });

  it("asks the model to emit dependencies for chained tasks", () => {
    const prompt = buildTaskExtractionSystemPrompt([]);

    expect(prompt).toContain("顶层字段必须只有 sourceSummary、tasks、dependencies");
    expect(prompt).toContain("如果任务之间存在明确先后");
  });
});
