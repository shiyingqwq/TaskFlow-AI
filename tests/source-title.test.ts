import { describe, expect, it } from "vitest";

import { deriveSourceTitle } from "@/lib/source-title";

describe("source title derivation", () => {
  it("uses the explicit title when the user provides one", () => {
    expect(
      deriveSourceTitle({
        explicitTitle: "  奖学金申请通知  ",
        filename: "notice.pdf",
        text: "第一行标题\n第二行内容",
      }),
    ).toBe("奖学金申请通知");
  });

  it("falls back to the filename before the text body", () => {
    expect(
      deriveSourceTitle({
        filename: "团支书填写入党积极分子名单表.pdf",
        text: "群通知标题\n详细内容",
      }),
    ).toBe("团支书填写入党积极分子名单表");
  });

  it("uses the first non-empty text line when there is no filename", () => {
    expect(
      deriveSourceTitle({
        text: "\n  奖学金申请通知：请于周五前提交材料  \n第二行说明",
      }),
    ).toBe("奖学金申请通知：请于周五前提交材料");
  });

  it("treats low-signal filenames as fallback-only and prefers the text body", () => {
    expect(
      deriveSourceTitle({
        filename: "IMG_1234.PNG",
        text: "奖学金申请通知\n第二行说明",
      }),
    ).toBe("奖学金申请通知");
  });

  it("prefers the parsed summary over a low-signal filename when there is no text", () => {
    expect(
      deriveSourceTitle({
        filename: "Screenshot_20260318-112233.png",
        summary: "辅导员通知：本周五前提交纸质版申请表",
      }),
    ).toBe("辅导员通知：本周五前提交纸质版申请表");
  });
});
