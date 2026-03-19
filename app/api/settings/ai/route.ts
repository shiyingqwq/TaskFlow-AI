import { NextResponse } from "next/server";
import { z } from "zod";

import { getAppSettings, updateAiSettings } from "@/lib/server/app-settings";
import { refreshDashboardFocusSummary } from "@/lib/server/tasks";

const schema = z.object({
  aiApiKey: z.string().nullable().optional(),
  aiBaseUrl: z.string().nullable().optional(),
  aiModel: z.string().nullable().optional(),
  aiVisionModel: z.string().nullable().optional(),
  aiSupportsVision: z.boolean().optional(),
});

export async function GET() {
  const settings = await getAppSettings();
  return NextResponse.json({
    aiApiKey: settings.aiApiKey ?? "",
    aiBaseUrl: settings.aiBaseUrl ?? "",
    aiModel: settings.aiModel ?? "",
    aiVisionModel: settings.aiVisionModel ?? "",
    aiSupportsVision: settings.aiSupportsVision,
  });
}

export async function PATCH(request: Request) {
  const body = schema.parse(await request.json());
  const settings = await updateAiSettings({
    aiApiKey: body.aiApiKey?.trim() || null,
    aiBaseUrl: body.aiBaseUrl?.trim() || null,
    aiModel: body.aiModel?.trim() || null,
    aiVisionModel: body.aiVisionModel?.trim() || null,
    aiSupportsVision: body.aiSupportsVision ?? true,
  });
  await refreshDashboardFocusSummary();

  return NextResponse.json({
    aiApiKey: settings.aiApiKey ?? "",
    aiBaseUrl: settings.aiBaseUrl ?? "",
    aiModel: settings.aiModel ?? "",
    aiVisionModel: settings.aiVisionModel ?? "",
    aiSupportsVision: settings.aiSupportsVision,
  });
}
