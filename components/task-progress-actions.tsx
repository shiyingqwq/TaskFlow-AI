"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function TaskProgressActions({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"increment" | "decrement" | "reset" | null>(null);

  async function updateProgress(action: "increment" | "decrement" | "reset") {
    setPendingAction(action);
    await fetch(`/api/tasks/${taskId}/progress`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-4"}`}>
      <button
        className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        disabled={isPending}
        onClick={() => updateProgress("increment")}
        type="button"
      >
        {isPending && pendingAction === "increment" ? "记录中..." : "+1 次"}
      </button>
      <button
        className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-60"
        disabled={isPending}
        onClick={() => updateProgress("decrement")}
        type="button"
      >
        {isPending && pendingAction === "decrement" ? "撤回中..." : "撤回 1 次"}
      </button>
      <button
        className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-60"
        disabled={isPending}
        onClick={() => updateProgress("reset")}
        type="button"
      >
        {isPending && pendingAction === "reset" ? "重置中..." : "重置本轮"}
      </button>
    </div>
  );
}
