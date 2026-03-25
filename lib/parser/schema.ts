import { z } from "zod";

export const taskExtractionSchema = z.object({
  sourceSummary: z.string(),
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().default(""),
      taskType: z.enum(["submission", "collection", "communication", "offline", "production", "followup"]),
      recurrenceType: z.enum(["single", "daily", "weekly", "limited"]).default("single"),
      recurrenceDays: z.array(z.number().int().min(0).max(6)).default([]),
      recurrenceTargetCount: z.number().int().min(1).default(1),
      recurrenceLimit: z.number().int().min(1).nullable().default(null),
      recurrenceStartISO: z.string().datetime().nullable().default(null),
      recurrenceUntilISO: z.string().datetime().nullable().default(null),
      recurrenceMaxOccurrences: z.number().int().min(1).nullable().default(null),
      deadlineISO: z.string().datetime().nullable(),
      deadlineText: z.string().nullable(),
      startAtISO: z.string().datetime().nullable().default(null),
      snoozeUntilISO: z.string().datetime().nullable().default(null),
      timezone: z.string().trim().min(1).max(64).default("Asia/Shanghai"),
      submitTo: z.string().nullable(),
      submitChannel: z.string().nullable(),
      applicableIdentities: z.array(z.string()).default([]),
      identityHint: z.string().nullable().default(null),
      deliveryType: z.enum(["electronic", "paper", "both", "unknown"]),
      requiresSignature: z.boolean(),
      requiresStamp: z.boolean(),
      materials: z.array(z.string()),
      dependsOnExternal: z.boolean(),
      waitingFor: z.string().nullable(),
      waitingReasonType: z.string().nullable().optional(),
      waitingReasonText: z.string().nullable().optional(),
      nextCheckAt: z.string().datetime().nullable().optional(),
      confidence: z.number().min(0).max(1),
      evidenceSnippet: z.string().min(1),
      nextActionSuggestion: z.string().min(1),
      estimatedMinutes: z.number().int().min(10).max(480).nullable().optional().default(null),
    }),
  ),
  dependencies: z
    .array(
      z.object({
        predecessorIndex: z.number().int().min(0),
        successorIndex: z.number().int().min(0),
        relationType: z.enum(["sequence", "prerequisite", "blocks"]).default("sequence"),
      }),
    )
    .default([]),
});

export type TaskExtractionResult = z.infer<typeof taskExtractionSchema>;
export type ExtractedTaskInput = TaskExtractionResult["tasks"][number];
