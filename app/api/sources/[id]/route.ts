import { NextResponse } from "next/server";

import { deleteSource } from "@/lib/server/tasks";

export const runtime = "nodejs";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = await deleteSource(id);

  return NextResponse.json({
    id: deleted.id,
  });
}
