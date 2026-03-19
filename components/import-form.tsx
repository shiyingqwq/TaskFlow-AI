"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { statusLabels, statusTone } from "@/lib/constants";
import { deriveSourceTitle } from "@/lib/source-title";
import { formatDeadline } from "@/lib/time";

type ImportDependency = {
  predecessorIndex: number;
  successorIndex: number;
  relationType: "sequence" | "prerequisite" | "blocks";
};

type ImportSummary = {
  createdTaskCount: number;
  urgentTasks: Array<{
    id?: string;
    title: string;
    status: string;
    priorityScore: number;
  }>;
  reviewTasks: Array<{
    id?: string;
    title: string;
  }>;
  dependencyPairs: Array<{
    predecessorIndex: number;
    successorIndex: number;
    predecessorTitle: string;
    successorTitle: string;
    relationType: "sequence" | "prerequisite" | "blocks";
  }>;
};

type PreviewTask = {
  index: number;
  title: string;
  description: string;
  taskType: string;
  recurrenceType: string;
  recurrenceDays: number[];
  recurrenceTargetCount: number;
  recurrenceLimit: number | null;
  deadlineISO: string | null;
  deadlineText: string | null;
  submitTo: string | null;
  submitChannel: string | null;
  applicableIdentities: string[];
  identityHint: string | null;
  deliveryType: string;
  requiresSignature: boolean;
  requiresStamp: boolean;
  materials: string[];
  dependsOnExternal: boolean;
  waitingFor: string | null;
  waitingReasonType: string | null;
  waitingReasonText: string | null;
  nextCheckAt: string | null;
  confidence: number;
  evidenceSnippet: string;
  nextActionSuggestion: string;
  status: string;
  displayStatus: string;
  priorityScore: number;
  priorityReason: string;
  needsHumanReview: boolean;
  reviewReasons: string[];
  blockingPredecessorTitles: string[];
  successorTitles: string[];
  included?: boolean;
};

type ImportPreviewResponse = {
  stage: "preview";
  mode: "openai" | "fallback";
  sourceSummary: string;
  tasks: PreviewTask[];
  dependencies: ImportDependency[];
  summary: ImportSummary;
};

type ImportCommittedResponse = {
  stage: "committed";
  mode: "openai" | "fallback";
  sourceId: string;
  sourceSummary: string;
  summary: ImportSummary;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    deadline: string | null;
    needsHumanReview: boolean;
    priorityScore: number;
    priorityReason: string;
    nextActionSuggestion: string;
  }>;
};

type ParsedImportResponse = (ImportPreviewResponse | ImportCommittedResponse) & { error?: string };

function isPreviewResponse(value: ParsedImportResponse | { error: string } | null): value is ImportPreviewResponse {
  return Boolean(value && "stage" in value && value.stage === "preview");
}

function isCommittedResponse(value: ParsedImportResponse | { error: string } | null): value is ImportCommittedResponse {
  return Boolean(value && "stage" in value && value.stage === "committed");
}

const previewPhases = [
  "正在整理输入内容",
  "正在提取文本与时间信息",
  "正在等待 AI 解析任务",
  "正在生成导入预览",
];

const commitPhases = [
  "正在整理确认后的内容",
  "正在上传并保存文件",
  "正在写入任务和来源",
  "正在重算状态、依赖与优先级",
];

function stripPreviewTask(task: PreviewTask) {
  return {
    title: task.title,
    description: task.description,
    taskType: task.taskType,
    recurrenceType: task.recurrenceType,
    recurrenceDays: task.recurrenceDays,
    recurrenceTargetCount: task.recurrenceTargetCount,
    recurrenceLimit: task.recurrenceLimit,
    deadlineISO: task.deadlineISO,
    deadlineText: task.deadlineText,
    submitTo: task.submitTo,
    submitChannel: task.submitChannel,
    applicableIdentities: task.applicableIdentities,
    identityHint: task.identityHint,
    deliveryType: task.deliveryType,
    requiresSignature: task.requiresSignature,
    requiresStamp: task.requiresStamp,
    materials: task.materials,
    dependsOnExternal: task.dependsOnExternal,
    waitingFor: task.waitingFor,
    waitingReasonType: task.waitingReasonType,
    waitingReasonText: task.waitingReasonText,
    nextCheckAt: task.nextCheckAt,
    confidence: task.confidence,
    evidenceSnippet: task.evidenceSnippet,
    nextActionSuggestion: task.nextActionSuggestion,
  };
}

function buildDraftFromPreview(preview: ImportPreviewResponse) {
  const includedTasks = preview.tasks.filter((task) => task.included !== false);
  const nextIndexMap = new Map<number, number>();
  includedTasks.forEach((task, nextIndex) => {
    nextIndexMap.set(task.index, nextIndex);
  });

  return {
    mode: preview.mode,
    sourceSummary: preview.sourceSummary,
    tasks: includedTasks.map(stripPreviewTask),
    dependencies: preview.dependencies.flatMap((dependency) => {
      const predecessorIndex = nextIndexMap.get(dependency.predecessorIndex);
      const successorIndex = nextIndexMap.get(dependency.successorIndex);
      if (predecessorIndex === undefined || successorIndex === undefined) {
        return [];
      }

      return [
        {
          predecessorIndex,
          successorIndex,
          relationType: dependency.relationType,
        },
      ];
    }),
  };
}

function buildClientSummary(preview: ImportPreviewResponse): ImportSummary {
  const includedTasks = preview.tasks.filter((task) => task.included !== false);
  const nextIndexMap = new Map<number, number>();
  includedTasks.forEach((task, nextIndex) => {
    nextIndexMap.set(task.index, nextIndex);
  });

  const dependencyPairs = preview.dependencies.flatMap((dependency) => {
    const predecessorTask = preview.tasks.find((task) => task.index === dependency.predecessorIndex && task.included !== false);
    const successorTask = preview.tasks.find((task) => task.index === dependency.successorIndex && task.included !== false);

    if (!predecessorTask || !successorTask) {
      return [];
    }

    return [
      {
        predecessorIndex: nextIndexMap.get(predecessorTask.index) ?? dependency.predecessorIndex,
        successorIndex: nextIndexMap.get(successorTask.index) ?? dependency.successorIndex,
        predecessorTitle: predecessorTask.title,
        successorTitle: successorTask.title,
        relationType: dependency.relationType,
      },
    ];
  });

  return {
    createdTaskCount: includedTasks.length,
    urgentTasks: [...includedTasks]
      .sort((left, right) => right.priorityScore - left.priorityScore)
      .slice(0, 3)
      .map((task) => ({
        title: task.title,
        status: task.displayStatus,
        priorityScore: task.priorityScore,
      })),
    reviewTasks: includedTasks.filter((task) => task.needsHumanReview).slice(0, 3).map((task) => ({ title: task.title })),
    dependencyPairs,
  };
}

function relationLabel(relationType: ImportDependency["relationType"]) {
  if (relationType === "prerequisite") {
    return "前置条件";
  }
  if (relationType === "blocks") {
    return "阻塞关系";
  }
  return "先后顺序";
}

function SummaryCards({ summary }: { summary: ImportSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-[22px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">新增任务</p>
        <p className="mt-2 text-2xl font-semibold text-[var(--text)]">{summary.createdTaskCount}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">本次确认后会落库的任务数量</p>
      </div>
      <div className="rounded-[22px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">最急的任务</p>
        <p className="mt-2 text-2xl font-semibold text-[var(--text)]">{summary.urgentTasks.length}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {summary.urgentTasks.length > 0 ? summary.urgentTasks.map((task) => task.title).join("、") : "当前没有明显紧急项"}
        </p>
      </div>
      <div className="rounded-[22px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">进入待确认</p>
        <p className="mt-2 text-2xl font-semibold text-[var(--text)]">{summary.reviewTasks.length}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {summary.reviewTasks.length > 0 ? summary.reviewTasks.map((task) => task.title).join("、") : "当前没有高风险待确认项"}
        </p>
      </div>
      <div className="rounded-[22px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">前后依赖</p>
        <p className="mt-2 text-2xl font-semibold text-[var(--text)]">{summary.dependencyPairs.length}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {summary.dependencyPairs.length > 0 ? summary.dependencyPairs.map((pair) => `${pair.predecessorTitle} → ${pair.successorTitle}`).join("；") : "当前没有识别出明确依赖"}
        </p>
      </div>
    </div>
  );
}

export function ImportForm() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportCommittedResponse | null>(null);
  const [error, setError] = useState("");
  const [submitStage, setSubmitStage] = useState<null | "preview" | "commit">(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhaseIndex, setUploadPhaseIndex] = useState(0);
  const [progressPhases, setProgressPhases] = useState(previewPhases);
  const [activeIdentities, setActiveIdentities] = useState<string[]>([]);
  const progressTimerRef = useRef<number | null>(null);
  const autoTitlePreview = deriveSourceTitle({
    explicitTitle: title,
    filename: file?.name ?? null,
    text,
  });
  const previewSummary = preview ? buildClientSummary(preview) : null;

  function stopProgressFeedback() {
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function startProgressFeedback(phases: string[]) {
    stopProgressFeedback();
    setProgressPhases(phases);
    setUploadProgress(8);
    setUploadPhaseIndex(0);
    progressTimerRef.current = window.setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 92) {
          return prev;
        }
        return Math.min(prev + (prev < 40 ? 12 : prev < 70 ? 7 : 3), 92);
      });
      setUploadPhaseIndex((prev) => (prev < phases.length - 1 ? prev + 1 : prev));
    }, 900);
  }

  useEffect(() => () => stopProgressFeedback(), []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/settings/identity", {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as { activeIdentities?: string[] };
        setActiveIdentities(Array.isArray(json.activeIdentities) ? json.activeIdentities : []);
      } catch {
        setActiveIdentities([]);
      }
    })();
  }, []);

  async function parseResponse(response: Response) {
    const raw = await response.text();
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as ParsedImportResponse;
    } catch {
      return {
        error: raw.slice(0, 160) || "服务端返回了无法解析的响应。",
      };
    }
  }

  function buildBaseFormData(intent: "preview" | "commit") {
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("title", title);
    if (text.trim()) {
      formData.set("text", text.trim());
    }
    if (file) {
      formData.set("file", file);
    }
    return formData;
  }

  async function handlePreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setSubmitStage("preview");
    startProgressFeedback(previewPhases);

    try {
      const response = await fetch("/api/import", {
        method: "POST",
        body: buildBaseFormData("preview"),
      });

      const json = await parseResponse(response);
      if (!response.ok) {
        stopProgressFeedback();
        setUploadProgress(0);
        setSubmitStage(null);
        setError(json?.error || "解析预览失败，请检查服务端日志。");
        return;
      }

      if (!isPreviewResponse(json)) {
        stopProgressFeedback();
        setUploadProgress(0);
        setSubmitStage(null);
        setError("服务端返回为空或预览格式不正确。");
        return;
      }

      stopProgressFeedback();
      setUploadProgress(100);
      setUploadPhaseIndex(previewPhases.length - 1);
      setPreview({
        ...json,
        tasks: json.tasks.map((task) => ({
          ...task,
          included: true,
        })),
      });
      setSubmitStage(null);
    } catch (submitError) {
      stopProgressFeedback();
      setUploadProgress(0);
      setSubmitStage(null);
      setError(submitError instanceof Error ? submitError.message : "解析预览失败，请稍后重试。");
    }
  }

  async function handleConfirmImport() {
    if (!preview) {
      return;
    }

    setError("");
    setSubmitStage("commit");
    startProgressFeedback(commitPhases);

    const formData = buildBaseFormData("commit");
    formData.set("draft", JSON.stringify(buildDraftFromPreview(preview)));

    try {
      const response = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });

      const json = await parseResponse(response);
      if (!response.ok) {
        stopProgressFeedback();
        setUploadProgress(0);
        setSubmitStage(null);
        setError(json?.error || "正式导入失败，请检查服务端日志。");
        return;
      }

      if (!isCommittedResponse(json)) {
        stopProgressFeedback();
        setUploadProgress(0);
        setSubmitStage(null);
        setError("服务端返回为空或导入结果格式不正确。");
        return;
      }

      stopProgressFeedback();
      setUploadProgress(100);
      setUploadPhaseIndex(commitPhases.length - 1);
      setResult(json);
      setPreview(null);
      setSubmitStage(null);
    } catch (submitError) {
      stopProgressFeedback();
      setUploadProgress(0);
      setSubmitStage(null);
      setError(submitError instanceof Error ? submitError.message : "正式导入失败，请稍后重试。");
    }
  }

  function updatePreviewTask(taskIndex: number, patch: Partial<PreviewTask>) {
    setPreview((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        tasks: current.tasks.map((task) => (task.index === taskIndex ? { ...task, ...patch } : task)),
      };
    });
  }

  async function resetDemo() {
    setError("");
    const response = await fetch("/api/demo-reset", {
      method: "POST",
    });
    const json = await parseResponse(response);
    if (!response.ok) {
      setError(json?.error || "导入 demo 数据失败。");
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <form className="space-y-4 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5" onSubmit={handlePreview}>
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Import</p>
          <h2 className="mt-2 text-2xl font-semibold">先解析预览，再确认导入</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            导入前会先给你一版任务草稿。你可以删掉多余任务、改标题和截止时间，再正式写入数据库。
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            {activeIdentities.length > 0
              ? `当前导入会参考身份：${activeIdentities.join("、")}`
              : "当前未设置身份，导入会按一般用户视角抽取任务。"}
          </p>
        </div>

        <label className="block space-y-1 text-sm text-[var(--muted)]">
          <span>来源标题（可选）</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="不填也可以，系统会自动取标题"
            value={title}
          />
          <p className="text-xs leading-5 text-[var(--muted)]">
            默认会优先使用文件名，其次使用正文首行。当前将使用：
            <span className="ml-1 font-medium text-[var(--text)]">{autoTitlePreview}</span>
          </p>
        </label>

        <label className="block space-y-1 text-sm text-[var(--muted)]">
          <span>粘贴文本</span>
          <textarea
            className="min-h-52 w-full rounded-3xl border border-[var(--line)] bg-white px-4 py-3 leading-6 outline-none focus:border-[var(--accent)]"
            onChange={(event) => setText(event.target.value)}
            placeholder="把群通知、聊天记录、课程要求贴在这里。若上传 PDF 或截图，可留空。"
            value={text}
          />
        </label>

        <label className="block space-y-1 text-sm text-[var(--muted)]">
          <span>上传图片或 PDF</span>
          <input
            accept="image/*,.pdf"
            className="block w-full rounded-2xl border border-dashed border-[var(--line)] bg-white px-3 py-3 text-sm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>

        {file ? (
          <div className="rounded-[20px] bg-white/70 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">
            已选择文件：<span className="font-medium text-[var(--text)]">{file.name}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_rgba(178,75,42,0.18)] transition active:scale-[0.98] disabled:opacity-60"
            disabled={submitStage !== null}
            type="submit"
          >
            {submitStage === "preview" ? (
              <>
                <span className="ui-spinner h-4 w-4 rounded-full border-2 border-white/35 border-t-white" />
                正在生成预览
              </>
            ) : (
              "先解析预览"
            )}
          </button>
          <button
            className="rounded-full border border-[var(--line)] bg-white px-5 py-2.5 text-sm text-[var(--muted)] transition active:scale-[0.98] disabled:opacity-60"
            disabled={submitStage !== null}
            onClick={resetDemo}
            type="button"
          >
            导入 demo 数据
          </button>
        </div>

        {(submitStage !== null || uploadProgress > 0) && !error ? (
          <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--text)]">{progressPhases[uploadPhaseIndex]}</p>
              <span className="text-xs text-[var(--muted)]">{uploadProgress}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(178,75,42,0.12)]">
              <div
                className="relative h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
                style={{ width: `${uploadProgress}%` }}
              >
                <span className="ui-progress-glow absolute inset-y-0 left-0 w-12 rounded-full bg-white/35" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
              {progressPhases.map((phase, index) => (
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    index < uploadPhaseIndex
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : index === uploadPhaseIndex
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[rgba(71,53,31,0.06)]"
                  }`}
                  key={phase}
                >
                  {phase}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      </form>

      <section className="space-y-4 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">
            {result ? "Import Result" : preview ? "Preview" : "Result"}
          </p>
          <h2 className="mt-2 text-2xl font-semibold">{result ? "导入结果面板" : preview ? "确认后再导入" : "解析结果摘要"}</h2>
        </div>

        {!preview && !result ? (
          <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-white/60 p-4 text-sm leading-6 text-[var(--muted)]">
            {submitStage === "preview" ? "系统正在生成导入预览。稍后你可以先删改任务，再决定正式导入。" : "这里会先出现导入预览。确认无误后，再正式写入来源、任务、依赖和待确认信息。"}
          </div>
        ) : null}

        {preview ? (
          <div className="space-y-4">
            <SummaryCards summary={previewSummary ?? preview.summary} />

            <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                {preview.mode === "openai" ? "AI provider preview" : "Fallback preview"}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{preview.sourceSummary}</p>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                下面的修改会在正式导入时重新计算状态、待确认和优先级。当前看到的分数与状态，代表本轮解析草稿的初步判断。
              </p>
            </div>

            <div className="space-y-3">
              {preview.tasks.map((task) => {
                const currentStatus = task.displayStatus in statusLabels ? task.displayStatus : task.status;
                const tone = currentStatus in statusTone ? statusTone[currentStatus as keyof typeof statusTone] : "bg-stone-100 text-stone-700 ring-stone-200";
                return (
                  <div
                    className={`rounded-[24px] p-4 ring-1 ${
                      task.included === false ? "bg-stone-50/80 ring-stone-200 opacity-75" : "bg-white/80 ring-[var(--line)]"
                    }`}
                    key={task.index}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className={`rounded-full px-3 py-1.5 text-xs font-medium transition active:scale-[0.98] ${
                            task.included === false
                              ? "bg-white text-[var(--muted)] ring-1 ring-[var(--line)]"
                              : "bg-[var(--accent-soft)] text-[var(--accent)]"
                          }`}
                          onClick={() => updatePreviewTask(task.index, { included: task.included === false })}
                          type="button"
                        >
                          {task.included === false ? "恢复导入" : "不导入这条"}
                        </button>
                        <span className={`rounded-full px-2.5 py-1 text-xs ring-1 ${tone}`}>
                          {statusLabels[currentStatus as keyof typeof statusLabels] ?? task.displayStatus}
                        </span>
                        {task.needsHumanReview ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900 ring-1 ring-amber-200">
                            待确认
                          </span>
                        ) : null}
                      </div>
                      <span className="text-sm font-medium text-[var(--teal)]">分数 {task.priorityScore}</span>
                    </div>

                    <div className="mt-3 grid gap-3">
                      <label className="space-y-1 text-sm text-[var(--muted)]">
                        <span>任务标题</span>
                        <input
                          className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
                          disabled={task.included === false}
                          onChange={(event) => updatePreviewTask(task.index, { title: event.target.value })}
                          value={task.title}
                        />
                      </label>

                      <label className="space-y-1 text-sm text-[var(--muted)]">
                        <span>任务说明</span>
                        <textarea
                          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 leading-6 outline-none focus:border-[var(--accent)]"
                          disabled={task.included === false}
                          onChange={(event) => updatePreviewTask(task.index, { description: event.target.value })}
                          value={task.description}
                        />
                      </label>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="space-y-1 text-sm text-[var(--muted)]">
                          <span>截止时间原文</span>
                          <input
                            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
                            disabled={task.included === false}
                            onChange={(event) => updatePreviewTask(task.index, { deadlineText: event.target.value || null })}
                            placeholder="例如：今晚10点前"
                            value={task.deadlineText ?? ""}
                          />
                        </label>
                        <label className="space-y-1 text-sm text-[var(--muted)]">
                          <span>提交对象</span>
                          <input
                            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
                            disabled={task.included === false}
                            onChange={(event) => updatePreviewTask(task.index, { submitTo: event.target.value || null })}
                            value={task.submitTo ?? ""}
                          />
                        </label>
                        <label className="space-y-1 text-sm text-[var(--muted)]">
                          <span>提交方式</span>
                          <input
                            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
                            disabled={task.included === false}
                            onChange={(event) => updatePreviewTask(task.index, { submitChannel: event.target.value || null })}
                            value={task.submitChannel ?? ""}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                      <p>当前识别的截止：{task.deadlineISO ? formatDeadline(task.deadlineISO) : task.deadlineText ?? "未明确"}</p>
                      <p>{task.priorityReason}</p>
                      {task.reviewReasons.length > 0 ? <p>待确认原因：{task.reviewReasons.join("；")}</p> : null}
                      {task.blockingPredecessorTitles.length > 0 ? <p>前置任务：{task.blockingPredecessorTitles.join("、")}</p> : null}
                      {task.successorTitles.length > 0 ? <p>后续任务：{task.successorTitles.join("、")}</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {previewSummary && previewSummary.dependencyPairs.length > 0 ? (
              <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">识别出的前后依赖</p>
                <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                  {previewSummary.dependencyPairs.map((pair) => (
                    <p key={`${pair.predecessorTitle}-${pair.successorTitle}`}>
                      {pair.predecessorTitle} → {pair.successorTitle}
                      <span className="ml-2 text-xs text-[var(--muted)]">({relationLabel(pair.relationType)})</span>
                    </p>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-full bg-[var(--teal)] px-5 py-2.5 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
                disabled={submitStage !== null}
                onClick={handleConfirmImport}
                type="button"
              >
                {submitStage === "commit" ? (
                  <>
                    <span className="ui-spinner h-4 w-4 rounded-full border-2 border-white/35 border-t-white" />
                    正在正式导入
                  </>
                ) : (
                  `确认导入 ${previewSummary?.createdTaskCount ?? preview.tasks.length} 条任务`
                )}
              </button>
              <button
                className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)]"
                disabled={submitStage !== null}
                onClick={() => {
                  setPreview(null);
                  setResult(null);
                  setUploadProgress(0);
                }}
                type="button"
              >
                丢弃预览，重新解析
              </button>
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="space-y-4">
            <SummaryCards summary={result.summary} />

            <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                {result.mode === "openai" ? "AI provider mode" : "Fallback mode"}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{result.sourceSummary}</p>
            </div>

            {result.summary.urgentTasks.length > 0 ? (
              <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
                <p className="text-sm font-medium text-[var(--text)]">这次最急的几条</p>
                <div className="mt-3 space-y-2">
                  {result.summary.urgentTasks.map((task) => (
                    <div className="flex items-center justify-between gap-3 text-sm" key={`${task.id ?? task.title}-urgent`}>
                      <span className="text-[var(--text)]">{task.title}</span>
                      <span className="text-[var(--teal)]">分数 {task.priorityScore}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {result.summary.reviewTasks.length > 0 ? (
              <div className="rounded-[24px] bg-amber-50/80 p-4 ring-1 ring-amber-200">
                <p className="text-sm font-medium text-amber-900">这些任务进入待确认</p>
                <div className="mt-3 space-y-2 text-sm text-amber-900/90">
                  {result.summary.reviewTasks.map((task) => (
                    <p key={`${task.id ?? task.title}-review`}>{task.title}</p>
                  ))}
                </div>
              </div>
            ) : null}

            {result.summary.dependencyPairs.length > 0 ? (
              <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
                <p className="text-sm font-medium text-[var(--text)]">识别出的前后依赖</p>
                <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                  {result.summary.dependencyPairs.map((pair) => (
                    <p key={`${pair.predecessorTitle}-${pair.successorTitle}-result`}>
                      {pair.predecessorTitle} → {pair.successorTitle}
                      <span className="ml-2 text-xs">({relationLabel(pair.relationType)})</span>
                    </p>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              {result.tasks.length === 0 ? (
                <div className="rounded-[24px] bg-white/75 p-4 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">
                  本次没有新增任务，但来源已经成功导入。若是图片导入且未配置视觉解析，这是预期行为。
                </div>
              ) : (
                result.tasks.map((task) => (
                  <div className="rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]" key={task.id}>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-medium">{task.title}</h3>
                      <span className="text-sm text-[var(--teal)]">分数 {task.priorityScore}</span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      {task.deadline ? `截止 ${formatDeadline(task.deadline)}；` : ""}
                      {statusLabels[task.status as keyof typeof statusLabels] ?? task.status}
                      {task.needsHumanReview ? "；已进入待确认" : ""}
                    </p>
                    <p className="mt-2 text-sm text-[var(--muted)]">{task.nextActionSuggestion}</p>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-3">
              <Link className="rounded-full bg-[var(--teal)] px-4 py-2 text-sm font-medium text-white" href={`/sources/${result.sourceId}`}>
                查看来源详情
              </Link>
              <Link className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)]" href="/">
                返回仪表盘
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
