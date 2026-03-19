import { describe, expect, it } from "vitest";

import { buildDependenciesForTest } from "@/lib/parser";
import type { ExtractedTaskInput } from "@/lib/parser/schema";

function createTask(overrides: Partial<ExtractedTaskInput>): ExtractedTaskInput {
  return {
    title: "待办事项",
    description: "",
    taskType: "followup",
    recurrenceType: "single",
    recurrenceDays: [],
    recurrenceTargetCount: 1,
    recurrenceLimit: null,
    deadlineISO: null,
    deadlineText: null,
    submitTo: null,
    submitChannel: null,
    applicableIdentities: [],
    identityHint: null,
    deliveryType: "unknown",
    requiresSignature: false,
    requiresStamp: false,
    materials: [],
    dependsOnExternal: false,
    waitingFor: null,
    waitingReasonType: null,
    waitingReasonText: null,
    nextCheckAt: null,
    confidence: 0.8,
    evidenceSnippet: "证据片段",
    nextActionSuggestion: "先推进最小可执行的一步。",
    ...overrides,
  };
}

describe("parser dependencies", () => {
  it("keeps AI-provided dependencies", () => {
    const tasks = [createTask({ title: "先填写名单" }), createTask({ title: "再加入群" })];
    const dependencies = buildDependenciesForTest(tasks, [
      {
        predecessorIndex: 0,
        successorIndex: 1,
        relationType: "sequence",
      },
    ]);

    expect(dependencies).toEqual([
      {
        predecessorIndex: 0,
        successorIndex: 1,
        relationType: "sequence",
      },
    ]);
  });

  it("infers adjacent sequence dependencies from explicit order cues", () => {
    const tasks = [
      createTask({
        title: "公示入党积极分子名单",
        description: "先完成名单公示。",
        evidenceSnippet: "公示完本期入党积极分子名单后",
      }),
      createTask({
        title: "加入本期入党积极分子群",
        description: "公示后再入群。",
        evidenceSnippet: "公示后加入QQ群",
      }),
    ];

    const dependencies = buildDependenciesForTest(tasks);

    expect(dependencies).toContainEqual({
      predecessorIndex: 0,
      successorIndex: 1,
      relationType: "sequence",
    });
  });
});
