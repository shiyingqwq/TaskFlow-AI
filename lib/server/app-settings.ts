import { prisma } from "@/lib/server/db";

export type AppSettingsRecord = {
  id: string;
  activeIdentity: string | null;
  activeIdentities: unknown;
  courseSchedule: unknown;
  courseTableConfig: unknown;
  aiApiKey: string | null;
  aiBaseUrl: string | null;
  aiModel: string | null;
  aiVisionModel: string | null;
  aiSupportsVision: boolean;
  focusSummaryText: string | null;
  focusSummaryMode: string | null;
  focusSummaryUpdatedAt: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

function isDatabaseNotReadyError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /no such table/i.test(error.message) || /SQLITE_ERROR/i.test(error.message);
}

async function sanitizeAppSettingJsonColumns() {
  await prisma.$executeRawUnsafe(`
    UPDATE AppSetting
    SET
      activeIdentities = CASE WHEN activeIdentities IS NULL OR TRIM(activeIdentities) = '' THEN '[]' ELSE activeIdentities END,
      courseSchedule = CASE WHEN courseSchedule IS NULL OR TRIM(courseSchedule) = '' THEN '[]' ELSE courseSchedule END,
      courseTableConfig = CASE WHEN courseTableConfig IS NULL OR TRIM(courseTableConfig) = '' THEN '{}' ELSE courseTableConfig END
    WHERE
      activeIdentities IS NULL OR TRIM(activeIdentities) = '' OR
      courseSchedule IS NULL OR TRIM(courseSchedule) = '' OR
      courseTableConfig IS NULL OR TRIM(courseTableConfig) = ''
  `);
}

async function ensureAppSettingsRow() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO AppSetting (
      id, activeIdentity, activeIdentities, courseSchedule, courseTableConfig, aiApiKey, aiBaseUrl, aiModel, aiVisionModel, aiSupportsVision, focusSummaryText, focusSummaryMode, focusSummaryUpdatedAt, createdAt, updatedAt
    )
    SELECT 'default', NULL, '[]', '[]', '{}', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (SELECT 1 FROM AppSetting WHERE id = 'default')
  `);
}

export async function readAppSettingsRecord(): Promise<AppSettingsRecord> {
  await ensureAppSettingsRow();
  await sanitizeAppSettingJsonColumns();

  const rows = (await prisma.$queryRawUnsafe(`
    SELECT id, activeIdentity, activeIdentities, courseSchedule, courseTableConfig, aiApiKey, aiBaseUrl, aiModel, aiVisionModel, aiSupportsVision, focusSummaryText, focusSummaryMode, focusSummaryUpdatedAt, createdAt, updatedAt
    FROM AppSetting
    WHERE id = 'default'
    LIMIT 1
  `)) as AppSettingsRecord[];

  return (
    rows[0] ?? {
      id: "default",
      activeIdentity: null,
      activeIdentities: [],
      courseSchedule: [],
      courseTableConfig: {},
      aiApiKey: null,
      aiBaseUrl: null,
      aiModel: null,
      aiVisionModel: null,
      aiSupportsVision: true,
      focusSummaryText: null,
      focusSummaryMode: null,
      focusSummaryUpdatedAt: null,
    }
  );
}

export async function getAppSettings() {
  try {
    return await readAppSettingsRecord();
  } catch (error) {
    if (isDatabaseNotReadyError(error)) {
      return {
        id: "default",
        activeIdentity: null,
        activeIdentities: [],
        courseSchedule: [],
        courseTableConfig: {},
        aiApiKey: null,
        aiBaseUrl: null,
        aiModel: null,
        aiVisionModel: null,
        aiSupportsVision: true,
        focusSummaryText: null,
        focusSummaryMode: null,
        focusSummaryUpdatedAt: null,
      } satisfies AppSettingsRecord;
    }
    throw error;
  }
}

export async function updateActiveIdentities(activeIdentities: string[]) {
  await ensureAppSettingsRow();
  await prisma.$executeRawUnsafe(
    `
      UPDATE AppSetting
      SET activeIdentity = ?, activeIdentities = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = 'default'
    `,
    activeIdentities[0] ?? null,
    JSON.stringify(activeIdentities),
  );

  return readAppSettingsRecord();
}

export async function updateAiSettings(input: {
  aiApiKey: string | null;
  aiBaseUrl: string | null;
  aiModel: string | null;
  aiVisionModel: string | null;
  aiSupportsVision: boolean;
}) {
  await ensureAppSettingsRow();
  await prisma.$executeRawUnsafe(
    `
      UPDATE AppSetting
      SET
        aiApiKey = ?,
        aiBaseUrl = ?,
        aiModel = ?,
        aiVisionModel = ?,
        aiSupportsVision = ?,
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = 'default'
    `,
    input.aiApiKey,
    input.aiBaseUrl,
    input.aiModel,
    input.aiVisionModel,
    input.aiSupportsVision ? 1 : 0,
  );

  return readAppSettingsRecord();
}

export async function updateCourseSchedule(input: { courseSchedule: unknown[]; courseTableConfig?: unknown }) {
  await ensureAppSettingsRow();
  const shouldUpdateTableConfig = input.courseTableConfig !== undefined;
  await prisma.$executeRawUnsafe(
    shouldUpdateTableConfig
      ? `
      UPDATE AppSetting
      SET courseSchedule = ?, courseTableConfig = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = 'default'
    `
      : `
      UPDATE AppSetting
      SET courseSchedule = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = 'default'
    `,
    JSON.stringify(input.courseSchedule),
    ...(shouldUpdateTableConfig ? [JSON.stringify(input.courseTableConfig)] : []),
  );

  return readAppSettingsRecord();
}

export async function updateFocusSummarySnapshot(input: {
  focusSummaryText: string | null;
  focusSummaryMode: string | null;
}) {
  await ensureAppSettingsRow();
  await prisma.$executeRawUnsafe(
    `
      UPDATE AppSetting
      SET
        focusSummaryText = ?,
        focusSummaryMode = ?,
        focusSummaryUpdatedAt = CURRENT_TIMESTAMP,
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = 'default'
    `,
    input.focusSummaryText,
    input.focusSummaryMode,
  );

  return readAppSettingsRecord();
}

type AiConfigSource = {
  aiApiKey?: string | null;
  aiBaseUrl?: string | null;
  aiModel?: string | null;
  aiVisionModel?: string | null;
  aiSupportsVision?: boolean | null;
};

export function resolveAiRuntimeConfigFromSources(stored: AiConfigSource, env = process.env) {
  const apiKey = stored.aiApiKey?.trim() || env.AI_API_KEY || env.OPENAI_API_KEY || null;
  if (!apiKey) {
    return null;
  }

  const model = stored.aiModel?.trim() || env.AI_MODEL || env.OPENAI_MODEL || "gpt-4.1-mini";
  const baseURL = stored.aiBaseUrl?.trim() || env.AI_BASE_URL || env.OPENAI_BASE_URL || undefined;
  const visionModel = stored.aiVisionModel?.trim() || model;
  const supportsVision =
    typeof stored.aiSupportsVision === "boolean"
      ? stored.aiSupportsVision
      : (env.AI_SUPPORTS_VISION || "true").toLowerCase() !== "false";

  return {
    apiKey,
    baseURL,
    model,
    visionModel,
    supportsVision,
  };
}

export async function getAiRuntimeConfig() {
  const settings = await getAppSettings();
  return resolveAiRuntimeConfigFromSources(settings);
}
