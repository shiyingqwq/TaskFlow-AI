import { describe, expect, it } from "vitest";

import { describeIdentityScope, matchesActiveIdentities, matchesActiveIdentity, normalizeApplicableIdentities } from "@/lib/identity";

describe("identity helpers", () => {
  it("normalizes identity lists from loose input", () => {
    expect(normalizeApplicableIdentities("班长、团支书、班长")).toEqual(["班长", "团支书"]);
  });

  it("matches tasks against the active identity", () => {
    expect(matchesActiveIdentity({ applicableIdentities: ["班长", "团支书"] }, "团支书")).toBe(true);
    expect(matchesActiveIdentity({ applicableIdentities: ["班长", "团支书"] }, "申请人")).toBe(false);
  });

  it("matches tasks against any of multiple active identities", () => {
    expect(matchesActiveIdentities({ applicableIdentities: ["班长", "团支书"] }, ["申请人", "团支书"])).toBe(true);
    expect(matchesActiveIdentities({ applicableIdentities: ["班长", "团支书"] }, ["申请人", "负责人"])).toBe(false);
  });

  it("describes unrestricted tasks gracefully", () => {
    expect(describeIdentityScope({ applicableIdentities: [], identityHint: null })).toBe("未限定身份");
  });
});
