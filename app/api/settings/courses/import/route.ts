import { NextResponse } from "next/server";

import { importCoursesFromImage, importCoursesFromText } from "@/lib/server/course-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const text = String(formData.get("text") || "").trim();
    const file = formData.get("file");

    if (!text && !(file instanceof File)) {
      return NextResponse.json({ error: "请提供课表图片或文本。" }, { status: 400 });
    }

    if (file instanceof File) {
      const mime = file.type || "";
      if (!mime.startsWith("image/")) {
        return NextResponse.json({ error: "仅支持图片文件。" }, { status: 400 });
      }
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
      const result = await importCoursesFromImage(dataUrl, file.name);
      return NextResponse.json(result);
    }

    const result = await importCoursesFromText(text);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "课表导入失败。" },
      { status: 500 },
    );
  }
}
