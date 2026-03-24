"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
type TaskActionStatus =
  | "needs_review"
  | "ready"
  | "waiting"
  | "in_progress"
  | "pending_submit"
  | "submitted"
  | "done"
  | "overdue"
  | "ignored";

const actionStatusLabels: Record<TaskActionStatus, string> = {
  needs_review: "待确认",
  ready: "待处理",
  waiting: "等待中",
  in_progress: "进行中",
  pending_submit: "待提交",
  submitted: "已提交",
  done: "已完成",
  overdue: "已逾期",
  ignored: "已忽略",
};

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

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `请求失败（${response.status}）`;
    throw new Error(message);
  }

  return payload as T;
}

async function patchTaskStatus(taskId: string, status: (typeof quickStatuses)[number]["value"], note?: string) {
  const payload = await requestJson<{ id: string; status: TaskActionStatus }>(`/api/tasks/${taskId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(note ? { status, note } : { status }),
  });
  return payload.status;
}

export function QuickStatusActions({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const [isPending, setIsPending] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function updateStatus(status: (typeof quickStatuses)[number]["value"]) {
    const label = quickStatuses.find((item) => item.value === status)?.label ?? "处理中";
    setPendingLabel(label);
    setIsPending(true);
    setErrorText(null);
    try {
      const nextStatus = await patchTaskStatus(taskId, status);
      setFeedback(`已更新为${actionStatusLabels[nextStatus]}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "状态更新失败，请重试。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={compact ? "" : "mt-4"}>
      <div className="flex flex-wrap gap-2">
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
      {feedback ? <p className="mt-2 text-xs text-emerald-700">{feedback}</p> : null}
      {errorText ? <p className="mt-2 text-xs text-rose-700">{errorText}</p> : null}
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
  const [isPending, setIsPending] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [optimisticStatus, setOptimisticStatus] = useState(status);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const actions = isShortcutStatusKey(optimisticStatus) ? statusShortcutMap[optimisticStatus] : statusShortcutMap.ready;

  useEffect(() => {
    setOptimisticStatus(status);
  }, [status]);

  async function updateStatus(nextStatus: (typeof quickStatuses)[number]["value"], label: string) {
    const previousStatus = optimisticStatus;
    setPendingLabel(label);
    setIsPending(true);
    setErrorText(null);
    setOptimisticStatus(nextStatus);
    try {
      const committedStatus = await patchTaskStatus(taskId, nextStatus);
      setOptimisticStatus(committedStatus);
      setFeedback(`已更新为${actionStatusLabels[committedStatus]}`);
    } catch (error) {
      setOptimisticStatus(previousStatus);
      setErrorText(error instanceof Error ? error.message : "状态更新失败，请重试。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={compact ? "" : "mt-4"}>
      <div className="flex flex-wrap gap-2">
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
      {feedback ? <p className="mt-2 text-xs text-emerald-700">{feedback}</p> : null}
      {errorText ? <p className="mt-2 text-xs text-rose-700">{errorText}</p> : null}
    </div>
  );
}

export function ReviewQuickActions({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function confirmReview() {
    setPendingAction("确认");
    setIsPending(true);
    setErrorText(null);
    try {
      const payload = await requestJson<{ id: string; status: TaskActionStatus; needsHumanReview: boolean }>(`/api/tasks/${taskId}/review`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      setFeedback(payload.needsHumanReview ? "已记录，本任务仍需继续确认。" : `已放行，状态更新为${actionStatusLabels[payload.status]}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "确认失败，请重试。");
    } finally {
      setIsPending(false);
    }
  }

  function jumpTo(anchor: "deadline-section" | "requirements-section") {
    setPendingAction(anchor);
    router.push(`/tasks/${taskId}#${anchor}`);
  }

  async function markAsNotTask() {
    setPendingAction("ignore");
    setIsPending(true);
    setErrorText(null);
    try {
      await patchTaskStatus(taskId, "ignored", "用户标记为非任务");
      setFeedback("已标记为非任务。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={compact ? "" : "mt-4"}>
      <div className="flex flex-wrap gap-2">
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
      {feedback ? <p className="mt-2 text-xs text-emerald-700">{feedback}</p> : null}
      {errorText ? <p className="mt-2 text-xs text-rose-700">{errorText}</p> : null}
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
  const [isPending, setIsPending] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function scheduleFollowUp(preset: (typeof waitingPresets)[number]["value"]) {
    setPendingLabel(waitingPresets.find((item) => item.value === preset)?.label ?? "处理中");
    setIsPending(true);
    setErrorText(null);
    try {
      const payload = await requestJson<{ id: string; status: TaskActionStatus; nextCheckAt: string | null }>(`/api/tasks/${taskId}/waiting`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ preset }),
      });
      setFeedback(payload.nextCheckAt ? "已安排回看时间。" : `已更新为${actionStatusLabels[payload.status]}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "安排失败，请重试。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={compact ? "" : "mt-4"}>
      <div className="flex flex-wrap gap-2">
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
      {feedback ? <p className="mt-2 text-xs text-emerald-700">{feedback}</p> : null}
      {errorText ? <p className="mt-2 text-xs text-rose-700">{errorText}</p> : null}
    </div>
  );
}

export function TaskReminderActions({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const [isPending, setIsPending] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function scheduleFollowUp(preset: (typeof reminderPresets)[number]["value"]) {
    setPendingLabel(reminderPresets.find((item) => item.value === preset)?.label ?? "处理中");
    setIsPending(true);
    setErrorText(null);
    try {
      await requestJson<{ id: string; status: TaskActionStatus; nextCheckAt: string | null }>(`/api/tasks/${taskId}/waiting`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ preset }),
      });
      setFeedback("提醒时间已更新。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "提醒更新失败，请重试。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={compact ? "" : "mt-4"}>
      <div className="flex flex-wrap gap-2">
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
      {feedback ? <p className="mt-2 text-xs text-emerald-700">{feedback}</p> : null}
      {errorText ? <p className="mt-2 text-xs text-rose-700">{errorText}</p> : null}
    </div>
  );
}

export { ReviewQuickActions as ReviewResolveAction };
