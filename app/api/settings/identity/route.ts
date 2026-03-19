import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizeActiveIdentities } from "@/lib/identity";
import { getAppSettings, updateActiveIdentities } from "@/lib/server/app-settings";
import { refreshDashboardFocusSummary } from "@/lib/server/tasks";

const schema = z.object({
  activeIdentity: z.string().nullable().optional(),
  activeIdentities: z.array(z.string()).optional(),
});

export async function GET() {
  const settings = await getAppSettings();
  const activeIdentities = normalizeActiveIdentities(
    Array.isArray(settings.activeIdentities) && settings.activeIdentities.length > 0
      ? settings.activeIdentities
      : settings.activeIdentity
        ? [settings.activeIdentity]
        : [],
  );
  return NextResponse.json({
    activeIdentity: activeIdentities[0] ?? null,
    activeIdentities,
  });
}

export async function PATCH(request: Request) {
  const body = schema.parse(await request.json());
  const activeIdentities = normalizeActiveIdentities(body.activeIdentities ?? (body.activeIdentity ? [body.activeIdentity] : []));
  const settings = await updateActiveIdentities(activeIdentities);
  await refreshDashboardFocusSummary();
  return NextResponse.json({
    activeIdentity: settings.activeIdentity,
    activeIdentities,
  });
}
