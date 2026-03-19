"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const quickStatuses = [
  { value: "in_progress", label: "标记进行中" },
  { value: "waiting", label: "标记等待中" },
  { value: "pending_submit", label: "标记待提交" },
  { value: "done", label: "标记已完成" },
  { value: "ignored", label: "忽略任务" },
] as const;

const statusShortcutMap = {
  ready: [
    { value: "in_progress", label: "继续推进" },
    { value: "waiting", label: "先等待" },
    { value: "done", label: "已完成" },
  ],
  in_progress: [
    { value: "pending_submit", label: "转待提交" },
    { value: "waiting", label: "先等待" },
    { value: "done", label: "已完成" },
  ],
  pending_submit: [
    { value: "done", label: "已完成" },
    { value: "in_progress", label: "继续处理" },
    { value: "waiting", label: "先等待" },
  ],
  waiting: [
    { value: "in_progress", label: "恢复推进" },
    { value: "pending_submit", label: "转待提交" },
    { value: "done", label: "已完成" },
  ],
  overdue: [
    { value: "in_progress", label: "现在处理" },
    { value: "pending_submit", label: "转待提交" },
    { value: "done", label: "已完成" },
  ],
} as const satisfies Partial<
  Record<string, Array<{ value: (typeof quickStatuses)[number]["value"]; label: string }>>
>;

type ShortcutStatusKey = keyof typeof statusShortcutMap;

function isShortcutStatusKey(status: string): status is ShortcutStatusKey {
  return status in statusShortcutMap;
}

function focusShortcutClass(
  tone: "primary" | "success" | "neutral",
  compact: boolean,
) {
  if (compact) {
    if (tone === "primary") {
      return "rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white shadow-[0_10px_20px_rgba(178,75,42,0.14)]";
    }
    if (tone === "success") {
      return "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700";
    }
    return "rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--muted)]";
  }

  if (tone === "primary") {
    return "inline-flex h-12 items-center justify-center rounded-full border border-[rgba(178,75,42,0.14)] bg-[linear-gradient(135deg,var(--accent),#c2643e)] px-5 text-[15px] font-medium leading-none text-white shadow-[0_12px_24px_rgba(178,75,42,0.18)]";
  }
  if (tone === "success") {
    return "inline-flex h-12 items-center justify-center rounded-full border border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,1),rgba(220,252,231,0.92))] px-5 text-[15px] font-medium leading-none text-emerald-700 shadow-[0_10px_20px_rgba(16,185,129,0.08)]";
  }
  return "inline-flex h-12 items-center justify-center rounded-full border border-[rgba(71,53,31,0.1)] bg-white/92 px-5 text-[15px] font-medium leading-none text-[var(--muted)] shadow-[0_10px_22px_rgba(90,67,35,0.05)]";
}

async function patchTaskStatus(taskId: string, status: (typeof quickStatuses)[number]["value"], note?: string) {
  await fetch(`/api/tasks/${taskId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(note ? { status, note } : { status }),
  });
}

export function QuickStatusActions({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  async function updateStatus(status: (typeof quickStatuses)[number]["value"]) {
    setPendingLabel(quickStatuses.find((item) => item.value === status)?.label ?? "处理中");
    await patchTaskStatus(taskId, status);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-4"}`}>
      {quickStatuses.map((status) => (
        <button
          className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] active:scale-[0.98] disabled:opacity-60"
          disabled={isPending}
          key={status.value}
          onClick={() => updateStatus(status.value)}
          type="button"
        >
          {isPending && pendingLabel === status.label ? "处理中..." : status.label}
        </button>
      ))}
    </div>
  );
}

export function TaskStatusShortcutActions({
  taskId,
  status,
  compact = false,
}: {
  taskId: string;
  status: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const actions = isShortcutStatusKey(status) ? statusShortcutMap[status] : statusShortcutMap.ready;

  async function updateStatus(nextStatus: (typeof quickStatuses)[number]["value"], label: string) {
    setPendingLabel(label);
    await patchTaskStatus(taskId, nextStatus);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-4"}`}>
      {actions.map((action: (typeof actions)[number]) => (
        <button
          className={`${focusShortcutClass(
            action.value === "done" ? "success" : action.value === "in_progress" ? "primary" : "neutral",
            compact,
          )} transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:text-[var(--text)] active:scale-[0.98] disabled:opacity-60`}
          disabled={isPending}
          key={action.value}
          onClick={() => updateStatus(action.value, action.label)}
          type="button"
        >
          {isPending && pendingLabel === action.label ? "处理中..." : action.label}
        </button>
      ))}
    </div>
  );
}

export function ReviewQuickActions({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function confirmReview() {
    setPendingAction("确认");
    await fetch(`/api/tasks/${taskId}/review`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    startTransition(() => {
      router.refresh();
    });
  }

  function jumpTo(anchor: "deadline-section" | "requirements-section") {
    setPendingAction(anchor);
    startTransition(() => {
      router.push(`/tasks/${taskId}#${anchor}`);
    });
  }

  async function markAsNotTask() {
    setPendingAction("ignore");
    await patchTaskStatus(taskId, "ignored", "用户标记为非任务");
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-4"}`}>
      <button
        className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white shadow-[0_10px_20px_rgba(178,75,42,0.18)] transition active:scale-[0.98] disabled:opacity-60"
        disabled={isPending}
        onClick={confirmReview}
        type="button"
      >
        {isPending && pendingAction === "确认" ? "正在确认..." : "这条解析没问题"}
      </button>
      <button
        className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] active:scale-[0.98] disabled:opacity-60"
        disabled={isPending}
        onClick={() => jumpTo("deadline-section")}
        type="button"
      >
        {isPending && pendingAction === "deadline-section" ? "正在跳转..." : "只修正时间"}
      </button>
      <button
        className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] active:scale-[0.98] disabled:opacity-60"
        disabled={isPending}
        onClick={() => jumpTo("requirements-section")}
        type="button"
      >
        {isPending && pendingAction === "requirements-section" ? "正在跳转..." : "只修正要求"}
      </button>
      <button
        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 transition hover:border-rose-300 active:scale-[0.98] disabled:opacity-60"
        disabled={isPending}
        onClick={markAsNotTask}
        type="button"
      >
        {isPending && pendingAction === "ignore" ? "正在处理..." : "不是任务"}
      </button>
    </div>
  );
}

const waitingPresets = [
  { value: "tonight", label: "已跟进，今晚再看" },
  { value: "tomorrow", label: "已跟进，明早再看" },
  { value: "next_week", label: "已跟进，下周再看" },
] as const;

const reminderPresets = [
  { value: "tonight", label: "今晚提醒我" },
  { value: "tomorrow", label: "明早提醒我" },
  { value: "next_week", label: "下周再看" },
] as const;

export function WaitingFollowUpActions({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  async function scheduleFollowUp(preset: (typeof waitingPresets)[number]["value"]) {
    setPendingLabel(waitingPresets.find((item) => item.value === preset)?.label ?? "处理中");
    await fetch(`/api/tasks/${taskId}/waiting`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ preset }),
    });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-4"}`}>
      {waitingPresets.map((preset) => (
        <button
          className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] active:scale-[0.98] disabled:opacity-60"
          disabled={isPending}
          key={preset.value}
          onClick={() => scheduleFollowUp(preset.value)}
          type="button"
        >
          {isPending && pendingLabel === preset.label ? "已记录..." : preset.label}
        </button>
      ))}
    </div>
  );
}

export function TaskReminderActions({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  async function scheduleFollowUp(preset: (typeof reminderPresets)[number]["value"]) {
    setPendingLabel(reminderPresets.find((item) => item.value === preset)?.label ?? "处理中");
    await fetch(`/api/tasks/${taskId}/waiting`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ preset }),
    });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-4"}`}>
      {reminderPresets.map((preset) => (
        <button
          className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] active:scale-[0.98] disabled:opacity-60"
          disabled={isPending}
          key={preset.value}
          onClick={() => scheduleFollowUp(preset.value)}
          type="button"
        >
          {isPending && pendingLabel === preset.label ? "已安排..." : preset.label}
        </button>
      ))}
    </div>
  );
}

export { ReviewQuickActions as ReviewResolveAction };
