import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import {
  buildDeadlineAuditRecord,
  describeDeadlineAudit,
  extractDeadlineFromText,
  formatDeadline,
  normalizeDeadlineInput,
  parseDeadlineWithAudit,
  readDeadlineAuditRecord,
} from "@/lib/time";

describe("time parsing", () => {
  it("parses slash dates into the current year instead of a historical date", () => {
    const base = dayjs.tz("2026-03-17 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const result = extractDeadlineFromText("3/20 截止", base);

    expect(result.deadlineISO).not.toBeNull();
    expect(result.deadlineISO?.startsWith("2026-03-20")).toBe(true);
  });

  it("shows the year when the deadline is not in the current year", () => {
    const base = dayjs.tz("2026-03-18 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei");

    expect(formatDeadline("2024-03-20T10:00:00.000Z", base)).toBe("2024年3月20日 18:00");
  });

  it("returns auditable rule metadata for implicit-year dates", () => {
    const base = dayjs.tz("2026-03-18 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const audit = parseDeadlineWithAudit("3月20号", base);

    expect(audit.inferenceType).toBe("implicit_current_year");
    expect(audit.usedCurrentYear).toBe(true);
    expect(audit.deadlineISO?.startsWith("2026-03-20")).toBe(true);
    expect(describeDeadlineAudit(audit)).toContain("按当前年份 2026 解析");
  });

  it("rolls implicit-year dates to next year when the current-year date has passed", () => {
    const base = dayjs.tz("2026-03-18 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const audit = parseDeadlineWithAudit("3月1号", base);

    expect(audit.inferenceType).toBe("rolled_to_next_year");
    expect(audit.rolledToNextYear).toBe(true);
    expect(audit.deadlineISO?.startsWith("2027-03-01")).toBe(true);
  });

  it("converts audit results to storable fields and can read them back", () => {
    const record = buildDeadlineAuditRecord({
      deadline: "2027-03-01T10:00:00.000Z",
      deadlineText: "3月1号",
    });
    const audit = readDeadlineAuditRecord(record);

    expect(record.deadlineInferenceType).toBe("rolled_to_next_year");
    expect(record.deadlineRolledToNextYear).toBe(true);
    expect(audit?.inferenceType).toBe("rolled_to_next_year");
  });

  it("normalizes manual input through the text rule engine before persistence", () => {
    const base = dayjs.tz("2026-03-18 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const result = normalizeDeadlineInput(
      {
        deadlineISO: "2024-03-20T10:00:00.000Z",
        deadlineText: "3月20号",
      },
      base,
    );

    expect(result.deadlineISO?.startsWith("2026-03-20")).toBe(true);
    expect(result.deadlineText).toBe("3月20号");
    expect(result.auditRecord.deadlineInferenceType).toBe("implicit_current_year");
  });

  it("can prefer structured deadline when requested", () => {
    const base = dayjs.tz("2026-03-18 10:00", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const result = normalizeDeadlineInput(
      {
        deadlineISO: "2024-03-20T10:00:00.000Z",
        deadlineText: "3月20号",
      },
      base,
      { preferStructuredDeadline: true },
    );

    expect(result.deadlineISO?.startsWith("2024-03-20")).toBe(true);
    expect(result.deadlineText).toBe("3月20号");
    expect(result.auditRecord.deadlineInferenceType).toBe("manual_datetime");
  });

  it("parses tonight deadlines with explicit hour instead of falling back to 23:00", () => {
    const base = dayjs.tz("2026-03-18 19:41", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const audit = parseDeadlineWithAudit("请于今晚10点前私聊老师", base);

    expect(audit.inferenceType).toBe("tonight");
    expect(audit.deadlineISO?.startsWith("2026-03-18T14:00:00")).toBe(true);
    expect(audit.reason).toContain("22:00");
  });

  it("parses today evening deadlines with explicit hour instead of falling back to 18:00", () => {
    const base = dayjs.tz("2026-03-18 19:41", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const audit = parseDeadlineWithAudit("如果未公示，今天晚上10点前私聊老师", base);

    expect(audit.inferenceType).toBe("today");
    expect(audit.deadlineISO?.startsWith("2026-03-18T14:00:00")).toBe(true);
    expect(audit.reason).toContain("22:00");
  });

  it("parses tomorrow evening deadlines with explicit chinese half-hour text", () => {
    const base = dayjs.tz("2026-03-18 19:41", "YYYY-MM-DD HH:mm", "Asia/Taipei");
    const audit = parseDeadlineWithAudit("明晚8点半前提交", base);

    expect(audit.inferenceType).toBe("tomorrow_evening");
    expect(audit.deadlineISO?.startsWith("2026-03-19T12:30:00")).toBe(true);
  });
});
