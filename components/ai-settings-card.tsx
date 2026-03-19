"use client";

import { useState, useTransition } from "react";

type Props = {
  initialApiKey: string;
  initialBaseUrl: string;
  initialModel: string;
  initialVisionModel: string;
  initialSupportsVision: boolean;
};

export function AiSettingsCard({
  initialApiKey,
  initialBaseUrl,
  initialModel,
  initialVisionModel,
  initialSupportsVision,
}: Props) {
  const [form, setForm] = useState({
    apiKey: initialApiKey,
    baseUrl: initialBaseUrl,
    model: initialModel,
    visionModel: initialVisionModel,
    supportsVision: initialSupportsVision,
  });
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  async function save() {
    const response = await fetch("/api/settings/ai", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        aiApiKey: form.apiKey.trim() || null,
        aiBaseUrl: form.baseUrl.trim() || null,
        aiModel: form.model.trim() || null,
        aiVisionModel: form.visionModel.trim() || null,
        aiSupportsVision: form.supportsVision,
      }),
    });

    if (!response.ok) {
      setMessage("AI 设置保存失败。");
      return;
    }

    setMessage("AI 设置已更新。");
    window.location.reload();
  }

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
      <div>
        <h3 className="text-xl font-semibold">AI 设置</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          在这里设置 API Key、Base URL 和模型。留空时会自动回退到环境变量。
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm text-[var(--muted)]">
          API Key
          <input
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
            placeholder="sk-..."
            type="password"
            value={form.apiKey}
          />
        </label>

        <label className="text-sm text-[var(--muted)]">
          Base URL
          <input
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
            placeholder="https://api.openai.com/v1"
            value={form.baseUrl}
          />
        </label>

        <label className="text-sm text-[var(--muted)]">
          文本模型
          <input
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
            placeholder="gpt-4.1-mini"
            value={form.model}
          />
        </label>

        <label className="text-sm text-[var(--muted)]">
          视觉模型
          <input
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, visionModel: event.target.value }))}
            placeholder="留空则沿用文本模型"
            value={form.visionModel}
          />
        </label>
      </div>

      <label className="mt-4 flex items-center gap-3 text-sm text-[var(--muted)]">
        <input
          checked={form.supportsVision}
          onChange={(event) => setForm((prev) => ({ ...prev, supportsVision: event.target.checked }))}
          type="checkbox"
        />
        启用视觉模型解析图片
      </label>

      <div className="mt-4 flex gap-2">
        <button
          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
          disabled={isPending}
          onClick={() => {
            startTransition(() => {
              save();
            });
          }}
          type="button"
        >
          {isPending ? "保存中..." : "保存 AI 设置"}
        </button>
        <button
          className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)] transition active:scale-[0.98] disabled:opacity-60"
          disabled={isPending}
          onClick={() => {
            setForm({
              apiKey: "",
              baseUrl: "",
              model: "",
              visionModel: "",
              supportsVision: true,
            });
          }}
          type="button"
        >
          清空为环境变量
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-[var(--muted)]">{message}</p> : null}
    </section>
  );
}
