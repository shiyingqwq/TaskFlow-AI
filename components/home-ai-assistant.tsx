"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
  actionSummaries?: string[];
  createdTaskCards?: Array<{
    taskId: string;
    title: string;
    deadlineLabel: string;
    statusLabel: string;
    needsHumanReview: boolean;
  }>;
  hasPendingAction?: boolean;
};

type PendingAction =
  | {
      type: "update_status";
      taskId: string;
      status: "needs_review" | "ready" | "waiting" | "in_progress" | "pending_submit" | "submitted" | "done" | "overdue" | "ignored";
      note?: string;
    }
  | {
      type: "resolve_review";
      taskId: string;
      note?: string;
    }
  | {
      type: "schedule_follow_up";
      taskId: string;
      preset: "tonight" | "tomorrow" | "next_week";
      note?: string;
    }
  | {
      type: "record_progress";
      taskId: string;
      mode: "increment" | "decrement" | "reset";
    }
  | {
      type: "create_task";
      sourceText: string;
    };

const quickPrompts = ["现在最该做什么？", "帮我看待确认队列", "新增任务：明天下午三点去打印材料", "把最紧急那条标记为进行中"];

export function HomeAiAssistant({ databaseReady }: { databaseReady: boolean }) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [isSending, setIsSending] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [lastReferencedTaskId, setLastReferencedTaskId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      role: "assistant",
      content: databaseReady
        ? "我能读首页全部任务，并帮你做常见管理动作。你可以直接问我现在最该做什么，标记任务状态，或者说“新增任务：明天下午三点去打印材料”。"
        : "数据库还没准备好。先初始化数据库，之后我才能读取和管理任务。",
    },
  ]);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [isOpen, messages, isSending]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  async function sendMessage(raw: string) {
    const message = raw.trim();
    if (!message || isSending || isRefreshing) {
      return;
    }

    setIsOpen(true);
    setIsSending(true);
    const nextMessages = [...messages, { role: "user" as const, content: message }];
    setMessages(nextMessages);
    setDraft("");

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          history: nextMessages.slice(-8).map((item) => ({
            role: item.role,
            content: item.content,
          })),
          context: {
            lastReferencedTaskId,
            pendingAction,
          },
        }),
      });

      const payload = (await response.json()) as {
        reply?: string;
        actionResults?: Array<{
          summary: string;
          createdTaskCards?: Array<{
            taskId: string;
            title: string;
            deadlineLabel: string;
            statusLabel: string;
            needsHumanReview: boolean;
          }>;
        }>;
        changedTaskIds?: string[];
        referencedTaskIds?: string[];
        pendingAction?: PendingAction | null;
      };

      if (payload.referencedTaskIds && payload.referencedTaskIds.length > 0) {
        setLastReferencedTaskId(payload.referencedTaskIds[0] || null);
      }
      setPendingAction(payload.pendingAction ?? null);

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: payload.reply || "这次没有拿到有效回复，你可以换个说法再试一次。",
          actionSummaries: payload.actionResults?.map((item) => item.summary) ?? [],
          createdTaskCards: payload.actionResults?.flatMap((item) => item.createdTaskCards ?? []) ?? [],
          hasPendingAction: Boolean(payload.pendingAction),
        },
      ]);

      if ((payload.changedTaskIds?.length ?? 0) > 0) {
        startTransition(() => {
          router.refresh();
        });
      }
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: "这次对话没有成功发出去。你可以稍后再试，或者换个更短的说法。",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      {isOpen ? (
        <button
          aria-label="关闭任务助手"
          className="fixed inset-0 z-40 bg-[rgba(31,27,23,0.18)] backdrop-blur-[1px]"
          onClick={() => setIsOpen(false)}
          type="button"
        />
      ) : null}

      <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
        {isOpen ? (
          <section className="relative flex h-[min(86vh,760px)] w-[min(calc(100vw-16px),430px)] flex-col overflow-hidden rounded-[28px] border border-[rgba(71,53,31,0.14)] bg-[linear-gradient(165deg,rgba(255,252,246,0.98),rgba(248,241,231,0.96))] shadow-[0_26px_70px_rgba(48,35,18,0.18)] sm:h-[min(76vh,760px)] sm:w-[min(calc(100vw-24px),430px)] sm:rounded-[30px]">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -left-8 top-0 h-24 w-24 rounded-full bg-[rgba(178,75,42,0.08)] blur-2xl" />
              <div className="absolute right-0 top-8 h-28 w-28 rounded-full bg-[rgba(40,95,103,0.08)] blur-2xl" />
            </div>

            <div className="relative flex items-start justify-between gap-3 border-b border-[rgba(71,53,31,0.08)] px-4 py-4 sm:px-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[rgba(178,75,42,0.12)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--accent)]">
                    AI Assistant
                  </span>
                  <span className="rounded-full bg-white/88 px-3 py-1 text-[11px] text-[var(--muted)] ring-1 ring-[rgba(71,53,31,0.08)]">
                    读全局任务
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold sm:text-xl">任务悬浮对话窗</h3>
                <p className="mt-1 text-xs leading-6 text-[var(--muted)]">
                  直接问任务、改状态、新增任务，或处理待确认与等待回看。
                </p>
              </div>
              <button
                className="rounded-full border border-[rgba(71,53,31,0.08)] bg-white/88 px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                关闭
              </button>
            </div>

            <div className="relative border-b border-[rgba(71,53,31,0.08)] px-3 py-3 sm:px-4">
              <div className="flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    className="rounded-full border border-[rgba(71,53,31,0.08)] bg-white/88 px-3 py-1.5 text-xs text-[var(--muted)] shadow-[0_6px_14px_rgba(90,67,35,0.04)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:text-[var(--text)] active:scale-[0.98]"
                    key={prompt}
                    onClick={() => {
                      void sendMessage(prompt);
                    }}
                    type="button"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative flex-1 overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
              <div className="h-full space-y-4 overflow-y-auto pr-1" ref={messagesRef}>
                {messages.map((message, index) => (
                  <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`} key={`${message.role}-${index}`}>
                    <div className={`max-w-[94%] sm:max-w-[90%] ${message.role === "user" ? "" : "pr-2 sm:pr-6"}`}>
                      <div
                        className={`mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] ${
                          message.role === "user" ? "justify-end text-[rgba(255,255,255,0.82)]" : "text-[var(--muted)]"
                        }`}
                      >
                        {message.role === "assistant" ? (
                          <>
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(178,75,42,0.14)] text-[10px] font-semibold tracking-normal text-[var(--accent)]">
                              AI
                            </span>
                            <span>任务助手</span>
                          </>
                        ) : (
                          <>
                            <span>你</span>
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(178,75,42,0.88)] text-[10px] font-semibold tracking-normal text-white">
                              我
                            </span>
                          </>
                        )}
                      </div>
                      <div
                        className={`rounded-[24px] px-4 py-3 text-sm leading-7 shadow-sm ${
                          message.role === "user"
                            ? "bg-[linear-gradient(135deg,var(--accent),#c2643e)] text-white shadow-[0_12px_22px_rgba(178,75,42,0.18)]"
                            : "bg-white/94 text-[var(--text)] ring-1 ring-[rgba(71,53,31,0.08)] shadow-[0_10px_24px_rgba(90,67,35,0.05)]"
                        }`}
                      >
                        <p>{message.content}</p>
                        {message.actionSummaries && message.actionSummaries.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {message.actionSummaries.map((summary) => (
                              <span
                                className="rounded-full bg-[rgba(255,250,243,0.96)] px-2.5 py-1 text-xs text-[var(--text)] ring-1 ring-[rgba(71,53,31,0.08)]"
                                key={summary}
                              >
                                {summary}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {message.createdTaskCards && message.createdTaskCards.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {message.createdTaskCards.map((card) => (
                              <div
                                className="rounded-[20px] border border-[rgba(71,53,31,0.08)] bg-[linear-gradient(180deg,rgba(255,253,248,0.96),rgba(250,244,236,0.94))] px-3 py-3 text-[var(--text)]"
                                key={card.taskId}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium">{card.title}</p>
                                  <span className={`rounded-full px-2.5 py-1 text-[11px] ${card.needsHumanReview ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
                                    {card.needsHumanReview ? "待确认" : "已入队"}
                                  </span>
                                </div>
                                <div className="mt-3 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-3">
                                  <div className="rounded-2xl bg-white/85 px-3 py-2">
                                    <p className="text-[10px] uppercase tracking-[0.14em]">截止</p>
                                    <p className="mt-1 text-[var(--text)]">{card.deadlineLabel}</p>
                                  </div>
                                  <div className="rounded-2xl bg-white/85 px-3 py-2">
                                    <p className="text-[10px] uppercase tracking-[0.14em]">状态</p>
                                    <p className="mt-1 text-[var(--text)]">{card.statusLabel}</p>
                                  </div>
                                  <div className="rounded-2xl bg-white/85 px-3 py-2">
                                    <p className="text-[10px] uppercase tracking-[0.14em]">待确认</p>
                                    <p className="mt-1 text-[var(--text)]">{card.needsHumanReview ? "是" : "否"}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {message.hasPendingAction ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white shadow-[0_8px_16px_rgba(178,75,42,0.16)]"
                              onClick={() => {
                                void sendMessage("确认");
                              }}
                              type="button"
                            >
                              确认
                            </button>
                            <button
                              className="rounded-full border border-[rgba(71,53,31,0.12)] bg-white px-3 py-1.5 text-xs text-[var(--muted)]"
                              onClick={() => {
                                void sendMessage("取消");
                              }}
                              type="button"
                            >
                              取消
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}

                {isSending ? (
                  <div className="flex justify-start">
                    <div className="max-w-[88%] pr-6">
                      <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(178,75,42,0.14)] text-[10px] font-semibold tracking-normal text-[var(--accent)]">
                          AI
                        </span>
                        <span>任务助手</span>
                      </div>
                      <div className="rounded-[24px] bg-white/94 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[rgba(71,53,31,0.08)] shadow-[0_10px_24px_rgba(90,67,35,0.05)]">
                        正在读取任务并整理回复...
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <form
              className="relative border-t border-[rgba(71,53,31,0.08)] bg-white/70 px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-4"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage(draft);
              }}
            >
              <textarea
                className="min-h-24 w-full rounded-[22px] border border-[rgba(71,53,31,0.1)] bg-white/92 px-4 py-3 text-sm leading-7 text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:shadow-[0_0_0_4px_rgba(178,75,42,0.08)]"
                disabled={!databaseReady || isSending || isRefreshing}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="例如：新增任务：明天下午三点去打印材料 / 把某条任务标记为进行中"
                value={draft}
              />
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-6 text-[var(--muted)]">
                  当前支持：问任务、新增任务、改状态、确认待确认、安排等待回看、记录重复任务进度。
                </p>
                <button
                  className="rounded-full bg-[linear-gradient(135deg,var(--accent),#c2643e)] px-5 py-2.5 text-sm font-medium text-white shadow-[0_12px_22px_rgba(178,75,42,0.2)] transition hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60"
                  disabled={!databaseReady || isSending || isRefreshing || draft.trim().length === 0}
                  type="submit"
                >
                  {isSending ? "处理中..." : isRefreshing ? "刷新中..." : "发送给 AI"}
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <button
          aria-expanded={isOpen}
          className="group flex items-center gap-3 rounded-full border border-[rgba(71,53,31,0.12)] bg-[linear-gradient(135deg,var(--accent),#c2643e)] px-4 py-3 text-white shadow-[0_16px_34px_rgba(178,75,42,0.28)] transition hover:-translate-y-0.5 active:scale-[0.98]"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/18 text-sm font-semibold ring-1 ring-white/18">
            AI
          </span>
          <span className="text-left">
            <span className="block text-sm font-semibold">{isOpen ? "收起任务助手" : "打开任务助手"}</span>
            <span className="block text-[11px] text-white/82">{databaseReady ? "读任务、改状态、新增任务" : "数据库未就绪"}</span>
          </span>
        </button>
      </div>
    </>
  );
}
