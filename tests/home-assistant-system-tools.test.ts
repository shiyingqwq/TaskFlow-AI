import { describe, expect, it } from "vitest";

import { handleHomeAssistantMessage } from "@/lib/home-assistant";

describe("home assistant system tools", () => {
  it("uses get_current_time tool for time queries", async () => {
    const result = await handleHomeAssistantMessage({
      message: "您能读取现在的时间吗",
      history: [],
    });

    expect(result.mode).toBe("local");
    expect(result.reply).toContain("当前时间是");
    expect(result.trace?.[0]?.actions).toEqual(["get_current_time"]);
    expect(result.trace?.[0]?.planner).toBe("local");
  });
});
