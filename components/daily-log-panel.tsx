"use client";

import { useEffect, useMemo, useState } from "react";

type DailyLogMode = "brief" | "full";
type PolishStyle = "formal" | "casual" | "report";

type DailyLogResponse = {
  date: string;
  mode: DailyLogMode;
  source: "saved" | "generated";
  text: string;
  meta: {
    actionCount: number;
    touchedTaskCount: number;
    riskCount: number;
    waitingOrBlockedCount: number;
  };
};

function todayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchDailyLog(date: string, mode: DailyLogMode) {
  const response = await fetch(`/api/logs/daily?date=${date}&mode=${mode}`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as DailyLogResponse | { error?: string };
  if (!response.ok) {
    throw new Error(payload && "error" in payload && payload.error ? payload.error : "生成失败，请稍后重试。");
  }
  return payload as DailyLogResponse;
}

async function refreshDailyLog(date: string, mode: DailyLogMode) {
  const response = await fetch(`/api/logs/daily?date=${date}&mode=${mode}&refresh=1`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as DailyLogResponse | { error?: string };
  if (!response.ok) {
    throw new Error(payload && "error" in payload && payload.error ? payload.error : "刷新失败，请稍后重试。");
  }
  return payload as DailyLogResponse;
}

async function saveDailyLog(input: { date: string; mode: DailyLogMode; text: string; meta: DailyLogResponse["meta"] }) {
  const response = await fetch("/api/logs/daily", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "保存失败，请稍后重试。");
  }
}

async function polishDailyLog(input: { text: string; style: PolishStyle }) {
  const response = await fetch("/api/logs/daily/polish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as { error?: string; polishedText?: string };
  if (!response.ok || !payload.polishedText) {
    throw new Error(payload.error || "AI 润色失败，请稍后重试。");
  }
  return payload.polishedText;
}

export function DailyLogPanel() {
  const [date, setDate] = useState(todayInputValue());
  const [mode, setMode] = useState<DailyLogMode>("brief");
  const [isLoading, setIsLoading] = useState(false);
  const [text, setText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [source, setSource] = useState<DailyLogResponse["source"] | null>(null);
  const [meta, setMeta] = useState<DailyLogResponse["meta"] | null>(null);
  const [originalText, setOriginalText] = useState("");
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishStyle, setPolishStyle] = useState<PolishStyle>("report");

  async function generateLog() {
    setIsLoading(true);
    setErrorText("");
    setCopied(false);
    setSaved(false);
    try {
      const result = await fetchDailyLog(date, mode);
      setText(result.text);
      setOriginalText(result.text);
      setMeta(result.meta);
      setSource(result.source);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "生成失败，请稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }

  async function regenerateLog() {
    setIsLoading(true);
    setErrorText("");
    setCopied(false);
    setSaved(false);
    try {
      const result = await refreshDailyLog(date, mode);
      setText(result.text);
      setOriginalText(result.text);
      setMeta(result.meta);
      setSource(result.source);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "刷新失败，请稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void generateLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyText() {
    if (!text.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setErrorText("复制失败，请手动复制文本。");
    }
  }

  async function saveText() {
    if (!text.trim() || !meta) {
      return;
    }
    setErrorText("");
    setSaved(false);
    try {
      await saveDailyLog({ date, mode, text, meta });
      setSaved(true);
      setSource("saved");
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    }
  }

  async function runAiPolish() {
    if (!text.trim()) {
      return;
    }
    setIsPolishing(true);
    setErrorText("");
    setSaved(false);
    try {
      if (!originalText) {
        setOriginalText(text);
      }
      const polished = await polishDailyLog({
        text,
        style: polishStyle,
      });
      setText(polished);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "AI 润色失败，请稍后重试。");
    } finally {
      setIsPolishing(false);
    }
  }

  function restoreOriginal() {
    if (!originalText) {
      return;
    }
    setText(originalText);
  }

  const modeDescription = useMemo(
    () =>
      mode === "brief" ? "简版：适合发群同步（8-12 行）" : "详版：适合归档或发上级（14-24 行）",
    [mode],
  );

  return (
    <section className="space-y-4">
      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">生成某日日志</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">按日期提取系统记录，自动生成可发送的工作日志。你可以先生成，再按实际情况微调。</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[180px_180px_1fr]">
          <label className="flex flex-col gap-1 text-sm text-[var(--muted)]">
            日期
            <input
              className="rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)]"
              onChange={(event) => setDate(event.target.value)}
              type="date"
              value={date}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-[var(--muted)]">
            模板
            <select
              className="rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)]"
              onChange={(event) => setMode(event.target.value as DailyLogMode)}
              value={mode}
            >
              <option value="brief">简版</option>
              <option value="full">详版</option>
            </select>
          </label>
          <div className="flex items-end">
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-11 items-center justify-center rounded-full border border-[rgba(178,75,42,0.14)] bg-[linear-gradient(135deg,var(--accent),#c2643e)] px-5 text-sm font-medium text-white shadow-[0_12px_24px_rgba(178,75,42,0.18)] disabled:opacity-60"
                disabled={isLoading}
                onClick={() => void generateLog()}
                type="button"
              >
                {isLoading ? "加载中..." : "读取日志"}
              </button>
              <button
                className="inline-flex h-11 items-center justify-center rounded-full border border-[var(--line)] bg-white px-4 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
                disabled={isLoading}
                onClick={() => void regenerateLog()}
                type="button"
              >
                强制重生成
              </button>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-[var(--muted)]">{modeDescription}</p>
        {meta ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            统计：动作 {meta.actionCount} 条 · 涉及任务 {meta.touchedTaskCount} 条 · 风险 {meta.riskCount} 条 · 等待/阻塞 {meta.waitingOrBlockedCount} 条
          </p>
        ) : null}
        {source ? <p className="mt-1 text-xs text-[var(--muted)]">来源：{source === "saved" ? "已保存版本" : "实时生成版本"}</p> : null}
        {errorText ? <p className="mt-2 text-xs text-rose-700">{errorText}</p> : null}
      </section>

      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-semibold">日志预览（可编辑）</h3>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-full border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--muted)]"
              onChange={(event) => setPolishStyle(event.target.value as PolishStyle)}
              value={polishStyle}
            >
              <option value="report">汇报风格</option>
              <option value="formal">正式风格</option>
              <option value="casual">日常风格</option>
            </select>
            <button
              className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
              disabled={!text.trim() || isPolishing}
              onClick={() => void runAiPolish()}
              type="button"
            >
              {isPolishing ? "润色中..." : "AI润色"}
            </button>
            <button
              className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
              disabled={!originalText.trim()}
              onClick={restoreOriginal}
              type="button"
            >
              恢复原文
            </button>
            <button
              className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
              disabled={!text.trim() || !meta}
              onClick={() => void saveText()}
              type="button"
            >
              {saved ? "已保存" : "保存日志"}
            </button>
            <button
              className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
              disabled={!text.trim()}
              onClick={() => void copyText()}
              type="button"
            >
              {copied ? "已复制" : "复制文本"}
            </button>
          </div>
        </div>

        <textarea
          className="mt-4 min-h-[360px] w-full rounded-[20px] border border-[var(--line)] bg-white px-4 py-3 text-sm leading-7 text-[var(--text)]"
          onChange={(event) => setText(event.target.value)}
          value={text}
        />
      </section>
    </section>
  );
}
