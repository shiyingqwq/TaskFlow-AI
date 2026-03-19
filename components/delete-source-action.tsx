"use client";

import { useTransition } from "react";

export function DeleteSourceAction({
  sourceId,
  redirectTo = "/",
  compact = false,
}: {
  sourceId: string;
  redirectTo?: string;
  compact?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  async function handleDelete() {
    const confirmed = window.confirm("确认删除这个来源？关联任务也会一起删除，且无法恢复。");
    if (!confirmed) {
      return;
    }

    const response = await fetch(`/api/sources/${sourceId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      return;
    }

    startTransition(() => {
      window.location.assign(redirectTo);
    });
  }

  return (
    <button
      className={
        compact
          ? "rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 transition hover:border-rose-300 active:scale-[0.98] disabled:opacity-60"
          : "rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 transition hover:border-rose-300 active:scale-[0.98] disabled:opacity-60"
      }
      disabled={isPending}
      onClick={handleDelete}
      type="button"
    >
      {isPending ? "删除中..." : compact ? "删除" : "删除来源"}
    </button>
  );
}
