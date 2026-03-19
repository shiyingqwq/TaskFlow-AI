import { NextResponse } from "next/server";

import { importDemoData } from "@/lib/server/seed";

function isDatabaseNotReadyError(error: unknown) {
  return error instanceof Error && /no such table|SQLITE_ERROR/i.test(error.message);
}

export async function POST() {
  try {
    const result = await importDemoData();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Demo import failed:", error);
    return NextResponse.json(
      {
        error: isDatabaseNotReadyError(error)
          ? "数据库尚未初始化完成，请先运行 npm run setup 或 npm run db:push。"
          : error instanceof Error
            ? error.message
            : "导入 demo 数据失败。",
      },
      { status: 500 },
    );
  }
}
