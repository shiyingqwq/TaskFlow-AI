"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deliveryTypeLabels, recurrenceTypeLabels, recurrenceWeekdayLabels, statusLabels, taskTypeLabels } from "@/lib/constants";
import { waitingReasonTypeLabels } from "@/lib/waiting";

const editableStatusEntries = Object.entries(statusLabels).filter(([value]) => value !== "submitted");

type Props = {
  task: {
    id: string;
    title: string;
    description: string;
    submitTo: string | null;
    submitChannel: string | null;
    applicableIdentities: string[];
    identityHint: string | null;
    recurrenceType: keyof typeof recurrenceTypeLabels;
    recurrenceDays: number[];
    recurrenceTargetCount: number;
    recurrenceLimit: number | null;
    deadlineText: string | null;
    deadlineISO: string | null;
    deliveryType: keyof typeof deliveryTypeLabels;
    requiresSignature: boolean;
    requiresStamp: boolean;
    dependsOnExternal: boolean;
    waitingFor: string | null;
    waitingReasonType: string | null;
    waitingReasonText: string | null;
    nextCheckAt: string | null;
    nextActionSuggestion: string;
    status: keyof typeof statusLabels;
    materials: string[];
    taskType: keyof typeof taskTypeLabels;
  };
};

function isoToLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TaskEditForm({ task }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    title: task.title,
    description: task.description,
    submitTo: task.submitTo ?? "",
    submitChannel: task.submitChannel ?? "",
    applicableIdentities: task.applicableIdentities.join("、"),
    identityHint: task.identityHint ?? "",
    recurrenceType: task.recurrenceType,
    recurrenceDays: task.recurrenceDays,
    recurrenceTargetCount: task.recurrenceTargetCount,
    recurrenceLimit: task.recurrenceLimit ?? null,
    deadlineText: task.deadlineText ?? "",
    deadlineISO: isoToLocal(task.deadlineISO),
    deliveryType: task.deliveryType,
    requiresSignature: task.requiresSignature,
    requiresStamp: task.requiresStamp,
    dependsOnExternal: task.dependsOnExternal,
    waitingFor: task.waitingFor ?? "",
    waitingReasonType: task.waitingReasonType ?? "",
    waitingReasonText: task.waitingReasonText ?? task.waitingFor ?? "",
    nextCheckAt: isoToLocal(task.nextCheckAt),
    nextActionSuggestion: task.nextActionSuggestion,
    status: task.status === "submitted" ? "done" : task.status,
    materials: task.materials.join("、"),
    taskType: task.taskType,
  });
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...form,
        applicableIdentities: form.applicableIdentities
          .split(/[、,，]/)
          .map((item) => item.trim())
          .filter(Boolean),
        identityHint: form.identityHint || null,
        recurrenceLimit: form.recurrenceType === "limited" ? Number(form.recurrenceLimit || 1) : null,
        deadlineISO: form.deadlineISO ? new Date(form.deadlineISO).toISOString() : null,
        nextCheckAt: form.nextCheckAt ? new Date(form.nextCheckAt).toISOString() : null,
        waitingFor: form.waitingReasonText || form.waitingFor || null,
        recurrenceTargetCount: Number(form.recurrenceTargetCount || 1),
        materials: form.materials
          .split(/[、,，]/)
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    });

    if (!response.ok) {
      setMessage("保存失败，请稍后重试。");
      return;
    }

    setMessage("已保存。");
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <form className="space-y-4 rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>任务标题</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            value={form.title}
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>任务类型</span>
          <select
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, taskType: event.target.value as Props["task"]["taskType"] }))}
            value={form.taskType}
          >
            {Object.entries(taskTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>重复类型</span>
          <select
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, recurrenceType: event.target.value as Props["task"]["recurrenceType"] }))}
            value={form.recurrenceType}
          >
            {Object.entries(recurrenceTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>每次目标次数</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            min={1}
            onChange={(event) => setForm((prev) => ({ ...prev, recurrenceTargetCount: Number(event.target.value || 1) }))}
            type="number"
            value={form.recurrenceTargetCount}
          />
        </label>
        {form.recurrenceType === "limited" ? (
          <label className="space-y-1 text-sm text-[var(--muted)]">
            <span>总共重复几次</span>
            <input
              className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
              min={1}
              onChange={(event) => setForm((prev) => ({ ...prev, recurrenceLimit: Number(event.target.value || 1) }))}
              type="number"
              value={form.recurrenceLimit ?? 1}
            />
          </label>
        ) : null}
      </div>

      {form.recurrenceType === "weekly" ? (
        <div className="rounded-[20px] border border-[var(--line)] bg-white/70 p-4">
          <p className="text-sm font-medium text-[var(--text)]">每周重复日</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(recurrenceWeekdayLabels).map(([value, label]) => {
              const day = Number(value);
              const active = form.recurrenceDays.includes(day);
              return (
                <button
                  className={`rounded-full px-3 py-1.5 text-xs transition ${
                    active ? "bg-[var(--accent)] text-white" : "border border-[var(--line)] bg-white text-[var(--muted)]"
                  }`}
                  key={value}
                  onClick={(event) => {
                    event.preventDefault();
                    setForm((prev) => ({
                      ...prev,
                      recurrenceDays: active ? prev.recurrenceDays.filter((item) => item !== day) : [...prev.recurrenceDays, day],
                    }));
                  }}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 scroll-mt-24" id="deadline-section">
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>截止时间</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, deadlineISO: event.target.value }))}
            type="datetime-local"
            value={form.deadlineISO}
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>原始时间表达</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, deadlineText: event.target.value }))}
            value={form.deadlineText}
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2 scroll-mt-24" id="requirements-section">
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>提交对象</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, submitTo: event.target.value }))}
            value={form.submitTo}
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>提交方式</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, submitChannel: event.target.value }))}
            value={form.submitChannel}
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>适用身份</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, applicableIdentities: event.target.value }))}
            placeholder="例如：班长、团支书、申请人"
            value={form.applicableIdentities}
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>身份提示</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, identityHint: event.target.value }))}
            placeholder="例如：通知同时提到多个对象，这条是其中哪一侧"
            value={form.identityHint}
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>交付形式</span>
          <select
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, deliveryType: event.target.value as Props["task"]["deliveryType"] }))}
            value={form.deliveryType}
          >
            {Object.entries(deliveryTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>是否依赖他人</span>
          <select
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, dependsOnExternal: event.target.value === "true" }))}
            value={String(form.dependsOnExternal)}
          >
            <option value="false">不依赖</option>
            <option value="true">依赖他人</option>
          </select>
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--muted)]">
          <input
            checked={form.requiresSignature}
            onChange={(event) => setForm((prev) => ({ ...prev, requiresSignature: event.target.checked }))}
            type="checkbox"
          />
          <span>需要签字</span>
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--muted)]">
          <input
            checked={form.requiresStamp}
            onChange={(event) => setForm((prev) => ({ ...prev, requiresStamp: event.target.checked }))}
            type="checkbox"
          />
          <span>需要盖章</span>
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>当前状态</span>
          <select
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as typeof prev.status }))}
            value={form.status}
          >
            {editableStatusEntries.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>延迟原因类型</span>
          <select
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, waitingReasonType: event.target.value }))}
            value={form.waitingReasonType}
          >
            <option value="">未设置</option>
            {Object.entries(waitingReasonTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>延迟原因说明</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, waitingReasonText: event.target.value, waitingFor: event.target.value }))
            }
            value={form.waitingReasonText}
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>下次检查时间</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, nextCheckAt: event.target.value }))}
            type="datetime-local"
            value={form.nextCheckAt}
          />
        </label>
        <label className="space-y-1 text-sm text-[var(--muted)]">
          <span>材料</span>
          <input
            className="w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            onChange={(event) => setForm((prev) => ({ ...prev, materials: event.target.value }))}
            value={form.materials}
          />
        </label>
      </div>

      <label className="block space-y-1 text-sm text-[var(--muted)]">
        <span>描述</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          value={form.description}
        />
      </label>

      <label className="block space-y-1 text-sm text-[var(--muted)]">
        <span>下一步建议</span>
        <textarea
          className="min-h-20 w-full rounded-2xl border border-[var(--line)] bg-white px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          onChange={(event) => setForm((prev) => ({ ...prev, nextActionSuggestion: event.target.value }))}
          value={form.nextActionSuggestion}
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-[0_10px_24px_rgba(178,75,42,0.18)] transition active:scale-[0.98] disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? (
            <>
              <span className="ui-spinner h-4 w-4 rounded-full border-2 border-white/35 border-t-white" />
              保存中
            </>
          ) : (
            "保存修改"
          )}
        </button>
        {message ? <span className="text-sm text-[var(--muted)]">{message}</span> : null}
      </div>
    </form>
  );
}
