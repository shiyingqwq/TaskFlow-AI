import { promises as fs } from "fs";
import path from "path";

import pdfParse from "pdf-parse";
import { NextResponse } from "next/server";

import { normalizeActiveIdentities } from "@/lib/identity";
import { taskExtractionSchema } from "@/lib/parser/schema";
import { getAppSettings } from "@/lib/server/app-settings";
import { createSourceAndTasks, createSourceAndTasksFromDraft, previewSourceTasks } from "@/lib/server/tasks";

export const runtime = "nodejs";

function isDatabaseNotReadyError(error: unknown) {
  return error instanceof Error && /no such table|SQLITE_ERROR/i.test(error.message);
}

async function saveUpload(file: File) {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const safeName = `${Date.now()}-${file.name.replace(/[^\w.-]+/g, "-")}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(uploadDir, { recursive: true });
  const outputPath = path.join(uploadDir, safeName);
  await fs.writeFile(outputPath, buffer);

  return {
    buffer,
    publicPath: `/uploads/${safeName}`,
  };
}

async function buildImportPayload(formData: FormData, options: { persistUpload: boolean }) {
  const title = String(formData.get("title") || "").trim() || null;
  const text = String(formData.get("text") || "").trim();
  const file = formData.get("file");
  const settings = await getAppSettings();
  const activeIdentities = normalizeActiveIdentities(
    Array.isArray(settings.activeIdentities) && settings.activeIdentities.length > 0
      ? settings.activeIdentities
      : settings.activeIdentity
        ? [settings.activeIdentity]
        : [],
  );

  if (!text && !(file instanceof File)) {
    throw new Error("请至少提供文本或上传一个文件。");
  }

  if (!(file instanceof File)) {
    return {
      payload: {
        type: "text" as const,
        title,
        rawText: text,
        activeIdentities,
      },
    };
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const mime = file.type || "";
  const publicPath = options.persistUpload ? (await saveUpload(file)).publicPath : undefined;

  if (mime.startsWith("image/")) {
    return {
      payload: {
        type: "image" as const,
        title,
        rawText: text,
        originalFilename: file.name,
        filePath: publicPath,
        imageDataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
        activeIdentities,
      },
    };
  }

  if (mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    let rawText = text;
    let extractedText = "";
    try {
      const parsed = await pdfParse(buffer);
      extractedText = parsed.text.trim();
    } catch {
      extractedText = "";
    }

    if (extractedText) {
      rawText = `${text ? `${text}\n\n` : ""}${extractedText}`.trim();
    }

    return {
      payload: {
        type: "pdf" as const,
        title,
        rawText: rawText || "PDF 已上传，但当前未能提取出文本内容。",
        originalFilename: file.name,
        filePath: publicPath,
        activeIdentities,
      },
    };
  }

  throw new Error("仅支持图片和 PDF 文件。");
}

function parseConfirmedDraft(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("缺少确认后的导入草稿。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("确认草稿不是合法 JSON。");
  }

  const sourceSummary = parsed && typeof parsed === "object" && "sourceSummary" in parsed ? parsed.sourceSummary : "";
  const tasks = parsed && typeof parsed === "object" && "tasks" in parsed ? parsed.tasks : [];
  const dependencies = parsed && typeof parsed === "object" && "dependencies" in parsed ? parsed.dependencies : [];
  const mode: "openai" | "fallback" =
    parsed && typeof parsed === "object" && "mode" in parsed && parsed.mode === "openai"
      ? "openai"
      : "fallback";
  const normalized = taskExtractionSchema.safeParse({
    sourceSummary,
    tasks,
    dependencies,
  });

  if (!normalized.success) {
    throw new Error("确认草稿格式不正确，请重新解析后再导入。");
  }

  return {
    mode,
    sourceSummary: normalized.data.sourceSummary,
    tasks: normalized.data.tasks,
    dependencies: normalized.data.dependencies,
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "").trim().toLowerCase();
    const shouldPersistUpload = intent === "commit" || !intent;
    const { payload } = await buildImportPayload(formData, { persistUpload: shouldPersistUpload });

    if (intent === "preview") {
      const preview = await previewSourceTasks(payload);
      return NextResponse.json({
        stage: "preview",
        mode: preview.mode,
        sourceSummary: preview.sourceSummary,
        tasks: preview.tasks,
        dependencies: preview.dependencies,
        summary: preview.summary,
      });
    }

    const result =
      intent === "commit"
        ? await createSourceAndTasksFromDraft(payload, parseConfirmedDraft(formData.get("draft")))
        : await createSourceAndTasks(payload);

    return NextResponse.json({
      stage: "committed",
      mode: result.mode,
      sourceId: result.source.id,
      sourceSummary: result.sourceSummary,
      summary: result.summary,
      tasks: result.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        deadline: task.deadline,
        needsHumanReview: task.needsHumanReview,
        priorityScore: task.priorityScore,
        priorityReason: task.priorityReason,
        nextActionSuggestion: task.nextActionSuggestion,
      })),
    });
  } catch (error) {
    console.error("Import route failed:", error);
    return NextResponse.json(
      {
        error: isDatabaseNotReadyError(error)
          ? "数据库尚未初始化完成，请先运行 npm run setup 或 npm run db:push。"
          : error instanceof Error
            ? error.message
            : "导入失败，服务端出现异常。",
      },
      { status: error instanceof Error && /请至少提供文本|仅支持图片和 PDF|缺少确认后的导入草稿|确认草稿/.test(error.message) ? 400 : 500 },
    );
  }
}
