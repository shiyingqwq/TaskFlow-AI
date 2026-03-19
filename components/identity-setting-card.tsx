"use client";

import { useState, useTransition } from "react";

export function IdentitySettingCard({
  initialIdentities,
  matchedCount,
}: {
  initialIdentities: string[];
  matchedCount: number;
}) {
  const [activeIdentityInput, setActiveIdentityInput] = useState(initialIdentities.join("、"));
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  async function saveIdentity() {
    const activeIdentities = activeIdentityInput
      .split(/[、,，]/)
      .map((item) => item.trim())
      .filter(Boolean);

    const response = await fetch("/api/settings/identity", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        activeIdentities,
      }),
    });

    if (!response.ok) {
      setMessage("身份保存失败。");
      return;
    }

    setMessage(activeIdentities.length > 0 ? "当前身份组已更新。" : "已清除身份过滤。");
    window.location.reload();
  }

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold">当前使用身份</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            可同时填写多个身份，例如：班长、团支书。系统不会隐藏任务，只会在推荐“现在该做什么”时优先参考这些身份。
          </p>
        </div>
        {initialIdentities.length > 0 ? <span className="text-sm text-amber-700">当前有 {matchedCount} 条任务命中这些身份</span> : null}
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          className="min-w-0 flex-1 rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          onChange={(event) => setActiveIdentityInput(event.target.value)}
          placeholder="例如：班长、团支书"
          value={activeIdentityInput}
        />
        <div className="flex gap-2">
          <button
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
            disabled={isPending}
            onClick={() => {
              startTransition(() => {
                saveIdentity();
              });
            }}
            type="button"
          >
            {isPending ? "保存中..." : "保存身份"}
          </button>
          <button
            className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)] transition active:scale-[0.98] disabled:opacity-60"
            disabled={isPending || !activeIdentityInput}
            onClick={() => {
              setActiveIdentityInput("");
              startTransition(() => {
                fetch("/api/settings/identity", {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ activeIdentities: [] }),
                }).then(() => window.location.reload());
              });
            }}
            type="button"
          >
            清除
          </button>
        </div>
      </div>
      {message ? <p className="mt-3 text-sm text-[var(--muted)]">{message}</p> : null}
    </section>
  );
}
