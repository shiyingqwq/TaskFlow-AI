"use client";

import { useEffect, useState, useTransition } from "react";

export function TaskBanterPanel({
  taskId,
  initialText,
  initialMode,
}: {
  taskId: string;
  initialText: string;
  initialMode: "ai" | "fallback";
}) {
  const [banter, setBanter] = useState(initialText);
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function loadBanter() {
    setError("");

    const response = await fetch(`/api/tasks/${taskId}/banter`, {
      method: "GET",
      cache: "no-store",
    });
    const json = (await response.json()) as { text?: string; mode?: "ai" | "fallback"; error?: string };

    if (!response.ok || !json.text || !json.mode) {
      throw new Error(json.error || "吐槽生成失败。");
    }

    setBanter(json.text);
    setMode(json.mode);
  }

  useEffect(() => {
    startTransition(() => {
      loadBanter().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "吐槽生成失败。");
      });
    });
  }, [taskId]);

  return (
    <section className="rounded-[24px] border border-[var(--line)] bg-[rgba(255,247,233,0.92)] p-4">
      <div>
        <div>
          <h2 className="font-medium text-[var(--text)]">AI 吐槽</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {isPending
              ? "正在生成一次 AI 吐槽"
              : mode === "ai"
                ? "已生成一次 AI 吐槽"
                : "当前使用本地降级吐槽"}
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-7 text-[var(--text)]">{banter}</p>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
    </section>
  );
}
