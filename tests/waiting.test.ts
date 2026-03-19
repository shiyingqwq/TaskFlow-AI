import { afterEach, describe, expect, it, vi } from "vitest";

import { isWaitingFollowUpDue, resolveWaitingFollowUpPreset } from "@/lib/waiting";

describe("waiting follow-up rules", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects waiting tasks whose next check time has arrived", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-18T04:00:00.000Z"));

    expect(isWaitingFollowUpDue({ nextCheckAt: "2026-03-18T03:00:00.000Z" })).toBe(true);
    expect(isWaitingFollowUpDue({ nextCheckAt: "2026-03-18T05:00:00.000Z" })).toBe(false);
  });

  it("builds consistent preset follow-up times", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-18T04:00:00.000Z"));

    expect(resolveWaitingFollowUpPreset("tonight").toISOString()).toBe("2026-03-18T12:00:00.000Z");
    expect(resolveWaitingFollowUpPreset("tomorrow").toISOString()).toBe("2026-03-19T02:00:00.000Z");
    expect(resolveWaitingFollowUpPreset("next_week").toISOString()).toBe("2026-03-25T02:00:00.000Z");
  });
});
