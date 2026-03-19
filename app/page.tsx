import { IdentitySettingCard } from "@/components/identity-setting-card";
import Link from "next/link";

import { AiSettingsCard } from "@/components/ai-settings-card";
import { DeleteSourceAction } from "@/components/delete-source-action";
import { HomeAiAssistant } from "@/components/home-ai-assistant";
import { ReviewQuickActions, TaskReminderActions, TaskStatusShortcutActions, WaitingFollowUpActions } from "@/components/quick-status-actions";
import { dashboardFilterOptions, statusLabels } from "@/lib/constants";
import { buildFocusSummaryFallback } from "@/lib/focus-summary";
import { getAppSettings } from "@/lib/server/app-settings";
import { getDashboardData } from "@/lib/server/tasks";
import { HomeCalendar } from "@/components/home-calendar";
import { TaskCard } from "@/components/task-card";
import { StatusBadge } from "@/components/status-badge";
import { TopSectionNav } from "@/components/top-section-nav";
import { formatDeadline, nowInTaipei } from "@/lib/time";
import { describeWaitingReason } from "@/lib/waiting";
import { TodayScheduleBoard } from "@/components/today-schedule-board";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string; section?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const filter = resolvedSearchParams?.filter ?? "all";
  const section = resolvedSearchParams?.section ?? "overview";
  const {
    tasks,
    currentBestTask,
    topTasksForToday,
    reviewTasks,
    waitingTasks,
    dueWaitingTasks,
    todayMustDoTasks,
    todayReminderTasks,
    todayShouldDoTasks,
    todayCanWaitTasks,
    filteredTasks,
    grouped,
    recentSources,
    databaseReady,
    activeIdentities,
    matchedIdentityTasks,
    blockedTasks,
  } =
    await getDashboardData(filter);
  const focusReviewTask = reviewTasks[0] ?? null;
  const focusWaitingTask = dueWaitingTasks[0] ?? null;
  const focusBlockedTask = blockedTasks[0] ?? null;
  const focusBlockedPredecessor =
    focusBlockedTask?.predecessorLinks.find(
      (item) => item.predecessorTask && !["done", "submitted", "ignored"].includes(item.predecessorTask.status),
    )?.predecessorTask ?? null;

  const focusMode = currentBestTask
    ? "task"
    : focusReviewTask
      ? "review"
      : focusWaitingTask
        ? "waiting"
        : focusBlockedTask
          ? "blocked"
          : "empty";
  const settings = await getAppSettings();
  const focusSummaryText =
    settings.focusSummaryText ||
    buildFocusSummaryFallback({
      databaseReady,
      focusMode,
      totalTaskCount: tasks.length,
      reviewCount: reviewTasks.length,
      dueWaitingCount: dueWaitingTasks.length,
      blockedCount: blockedTasks.length,
      topTaskTitles: topTasksForToday.map((task) => task.title),
      currentBestTask,
      focusReviewTask,
      focusWaitingTask,
      focusBlockedTask,
      tasks,
    });
  const todayLabel = nowInTaipei().format("M月D日 dddd");

  return (
    <main className="space-y-6 pb-10">
      <TopSectionNav activeSection={section as "overview" | "today" | "tasks" | "sources" | "settings"} filter={filter} />

      {section === "overview" ? (
        <>
          <section className="rounded-[32px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_18px_40px_rgba(90,67,35,0.07)]">
            <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">Focus</p>
            <div className="mt-4 rounded-[22px] bg-white/72 px-4 py-4 ring-1 ring-[rgba(71,53,31,0.08)]">
              <p className="text-sm leading-7 text-[var(--ink)]">{focusSummaryText}</p>
            </div>
            <div
              className={`mt-4 rounded-[28px] border p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] ${
                focusMode === "task"
                  ? "border-[rgba(178,75,42,0.22)] bg-[linear-gradient(135deg,rgba(255,244,235,0.96),rgba(255,255,255,0.92))]"
                  : focusMode === "review"
                    ? "border-amber-200 bg-[linear-gradient(135deg,rgba(255,248,224,0.96),rgba(255,255,255,0.92))]"
                    : focusMode === "waiting"
                      ? "border-cyan-200 bg-[linear-gradient(135deg,rgba(235,250,252,0.96),rgba(255,255,255,0.92))]"
                      : focusMode === "blocked"
                        ? "border-violet-200 bg-[linear-gradient(135deg,rgba(246,240,255,0.96),rgba(255,255,255,0.92))]"
                        : "border-[var(--line)] bg-[linear-gradient(135deg,rgba(255,252,246,0.96),rgba(255,255,255,0.92))]"
              }`}
            >
              {focusMode === "task" && currentBestTask ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={currentBestTask.displayStatus ?? currentBestTask.status} />
                    <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-[var(--teal)] ring-1 ring-[rgba(71,53,31,0.08)]">
                      决策分数 {currentBestTask.priorityScore}
                    </span>
                  </div>
                  <p className="mt-4 text-sm font-medium uppercase tracking-[0.18em] text-[var(--accent)]">今天先做这件事</p>
                  <h1 className="mt-2 text-3xl font-semibold leading-tight">{currentBestTask.title}</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">{currentBestTask.priorityReason}</p>
                  <div className="mt-5 flex flex-wrap gap-5 text-sm text-[var(--muted)]">
                    <span>截止：{formatDeadline(currentBestTask.deadline)}</span>
                    <span>下一步：{currentBestTask.nextActionSuggestion}</span>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      className="inline-flex h-12 items-center justify-center rounded-full border border-[rgba(178,75,42,0.14)] bg-[linear-gradient(135deg,var(--accent),#c2643e)] px-5 text-[15px] font-medium leading-none text-white shadow-[0_12px_24px_rgba(178,75,42,0.18)]"
                      href={`/tasks/${currentBestTask.id}`}
                    >
                      现在去做
                    </Link>
                    <Link
                      className="inline-flex h-12 items-center justify-center rounded-full border border-[rgba(71,53,31,0.1)] bg-white/92 px-5 text-[15px] font-medium leading-none text-[var(--muted)] shadow-[0_10px_22px_rgba(90,67,35,0.05)]"
                      href="/import"
                    >
                      导入新来源
                    </Link>
                  </div>
                  <div className="mt-4">
                    <TaskStatusShortcutActions status={currentBestTask.status} taskId={currentBestTask.id} />
                  </div>
                </>
              ) : focusMode === "review" && focusReviewTask ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={focusReviewTask.displayStatus ?? focusReviewTask.status} />
                    <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-amber-800 ring-1 ring-amber-200">高风险确认</span>
                  </div>
                  <p className="mt-4 text-sm font-medium uppercase tracking-[0.18em] text-amber-800">先清掉这个卡点</p>
                  <h1 className="mt-2 text-3xl font-semibold leading-tight">{focusReviewTask.title}</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">{focusReviewTask.priorityReason}</p>
                  <div className="mt-5 flex flex-wrap gap-5 text-sm text-[var(--muted)]">
                    <span>截止：{formatDeadline(focusReviewTask.deadline)}</span>
                    <span>下一步：先确认关键字段，再继续流转</span>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link className="rounded-full bg-amber-700 px-5 py-2.5 text-sm font-medium text-white" href={`/tasks/${focusReviewTask.id}`}>
                      先确认这条
                    </Link>
                    <Link className="rounded-full border border-amber-200 bg-white px-5 py-2.5 text-sm text-amber-900" href={`/?filter=review`}>
                      查看全部待确认
                    </Link>
                  </div>
                  <div className="mt-4">
                    <ReviewQuickActions taskId={focusReviewTask.id} />
                  </div>
                </>
              ) : focusMode === "waiting" && focusWaitingTask ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={focusWaitingTask.displayStatus ?? focusWaitingTask.status} />
                    <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-cyan-800 ring-1 ring-cyan-200">到点回看</span>
                  </div>
                  <p className="mt-4 text-sm font-medium uppercase tracking-[0.18em] text-cyan-800">现在该回看这条</p>
                  <h1 className="mt-2 text-3xl font-semibold leading-tight">{focusWaitingTask.title}</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
                    {describeWaitingReason(focusWaitingTask) || "这条任务之前被挂起了，现在已经到了该重新推进的时候。"}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-5 text-sm text-[var(--muted)]">
                    <span>截止：{formatDeadline(focusWaitingTask.deadline)}</span>
                    <span>下一步：{focusWaitingTask.nextActionSuggestion}</span>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link className="rounded-full bg-cyan-700 px-5 py-2.5 text-sm font-medium text-white" href={`/tasks/${focusWaitingTask.id}`}>
                      去回看这条
                    </Link>
                    <Link className="rounded-full border border-cyan-200 bg-white px-5 py-2.5 text-sm text-cyan-900" href={`/?filter=waiting`}>
                      查看全部等待任务
                    </Link>
                  </div>
                  <div className="mt-4">
                    <WaitingFollowUpActions taskId={focusWaitingTask.id} />
                  </div>
                </>
              ) : focusMode === "blocked" && focusBlockedTask ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={focusBlockedTask.displayStatus ?? focusBlockedTask.status} />
                    <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-violet-900 ring-1 ring-violet-200">先解锁</span>
                  </div>
                  <p className="mt-4 text-sm font-medium uppercase tracking-[0.18em] text-violet-900">先完成前置步骤</p>
                  <h1 className="mt-2 text-3xl font-semibold leading-tight">{focusBlockedTask.title}</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
                    这条任务当前被前置步骤卡住了。先完成 {focusBlockedTask.blockingPredecessorTitles?.join("、") || "前置任务"}，再回来会更顺。
                  </p>
                  <div className="mt-5 flex flex-wrap gap-5 text-sm text-[var(--muted)]">
                    <span>截止：{formatDeadline(focusBlockedTask.deadline)}</span>
                    <span>下一步：先去解锁前置任务</span>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    {focusBlockedPredecessor ? (
                      <Link className="rounded-full border border-violet-300 bg-white px-5 py-2.5 text-sm font-medium text-violet-950" href={`/tasks/${focusBlockedPredecessor.id}`}>
                        先做：{focusBlockedPredecessor.title}
                      </Link>
                    ) : null}
                    <Link className="rounded-full border border-violet-200 bg-white px-5 py-2.5 text-sm text-violet-900" href={`/tasks/${focusBlockedTask.id}`}>
                      查看当前任务
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--accent)]">当前没有明确主线</p>
                  <h1 className="mt-2 text-3xl font-semibold leading-tight">先导入新的通知，或整理现有任务</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
                    {databaseReady
                      ? "当前没有需要立刻推进的任务。你可以继续导入新来源，或回头整理已有任务。"
                      : "数据库还没有初始化完成。先执行 npm run setup 或 npm run db:push，初始化表结构后再回来导入任务。"}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white" href="/import">
                      导入新来源
                    </Link>
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[20px] bg-white/82 px-4 py-3 ring-1 ring-amber-200">
                <p className="text-xs uppercase tracking-[0.18em] text-amber-800">待确认</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold text-amber-900">{reviewTasks.length}</p>
                  <p className="text-sm text-amber-900/75">高风险字段</p>
                </div>
              </div>
              <div className="rounded-[20px] bg-white/82 px-4 py-3 ring-1 ring-cyan-200">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-800">该回看了</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold text-cyan-900">{dueWaitingTasks.length}</p>
                  <p className="text-sm text-cyan-900/75">等待已到点</p>
                </div>
              </div>
              <div className="rounded-[20px] bg-white/82 px-4 py-3 ring-1 ring-violet-200">
                <p className="text-xs uppercase tracking-[0.18em] text-violet-800">被阻塞</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold text-violet-950">{blockedTasks.length}</p>
                  <p className="text-sm text-violet-900/75">先解锁前置</p>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-amber-950">待确认</h3>
                <span className="text-sm text-amber-800">{reviewTasks.length} 条</span>
              </div>
              <div className="mt-4 space-y-3">
                {reviewTasks.length === 0 ? (
                  <p className="rounded-2xl bg-white/80 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">当前没有待确认任务。</p>
                ) : (
                  reviewTasks.slice(0, 3).map((task) => (
                    <div className="rounded-[22px] bg-white/85 p-4 ring-1 ring-amber-200 hover:ring-[var(--accent)]" key={task.id}>
                      <Link className="block" href={`/tasks/${task.id}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{task.title}</p>
                          <StatusBadge status={task.status} />
                        </div>
                        <p className="mt-2 text-sm text-amber-900">{task.priorityReason}</p>
                      </Link>
                      <div className="mt-3">
                        <ReviewQuickActions compact taskId={task.id} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">该回看了</h3>
                <span className="text-sm text-[var(--muted)]">{dueWaitingTasks.length} 条</span>
              </div>
              <div className="mt-4 space-y-3">
                {dueWaitingTasks.length === 0 ? (
                  <p className="rounded-2xl bg-white/70 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">当前没有到点需要回看的等待任务。</p>
                ) : (
                  dueWaitingTasks.slice(0, 3).map((task) => (
                    <div className="rounded-[22px] bg-white/75 p-4 ring-1 ring-[var(--line)]" key={task.id}>
                      <div className="flex items-center justify-between gap-3">
                        <Link className="font-medium hover:text-[var(--accent)]" href={`/tasks/${task.id}`}>
                          {task.title}
                        </Link>
                        <StatusBadge status={task.status} />
                      </div>
                  <p className="mt-2 text-sm text-amber-700">现在该回看这条任务了。</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">延迟原因：{describeWaitingReason(task) || "等待外部反馈"}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">截止：{formatDeadline(task.deadline)}</p>
                  <div className="mt-3">
                    <WaitingFollowUpActions compact taskId={task.id} />
                  </div>
                </div>
              ))
            )}
              </div>
            </section>

            <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">今天推进</h3>
                <span className="text-sm text-[var(--muted)]">最多 3 条</span>
              </div>
              <div className="mt-4 space-y-3">
                {topTasksForToday.length === 0 ? (
                  <p className="rounded-2xl bg-white/70 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">当前没有紧急推进项。</p>
                ) : (
                  topTasksForToday.slice(0, 3).map((task) => (
                    <div className="rounded-[22px] bg-white/75 p-4 ring-1 ring-[var(--line)] hover:ring-[var(--accent)]" key={task.id}>
                      <Link className="block" href={`/tasks/${task.id}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{task.title}</p>
                          <span className="text-sm text-[var(--teal)]">{task.priorityScore}</span>
                        </div>
                        <p className="mt-2 text-sm text-[var(--muted)]">截止：{formatDeadline(task.deadline)}</p>
                      </Link>
                      <div className="mt-3">
                        <TaskStatusShortcutActions compact status={task.status} taskId={task.id} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </section>

          {blockedTasks.length > 0 ? (
            <section className="rounded-[28px] border border-violet-200 bg-violet-50 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-violet-950">先解锁这些任务</h3>
                  <p className="mt-1 text-sm text-violet-900/80">这些任务现在还不能直接做，先完成前置步骤会更顺。</p>
                </div>
                <span className="text-sm text-violet-800">{blockedTasks.length} 条</span>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {blockedTasks.slice(0, 4).map((task) => {
                  const firstBlockingPredecessor =
                    task.predecessorLinks.find(
                      (item) =>
                        item.predecessorTask &&
                        !["done", "submitted", "ignored"].includes(item.predecessorTask.status),
                    )?.predecessorTask ?? null;

                  return (
                    <div className="rounded-[22px] bg-white/85 p-4 ring-1 ring-violet-200" key={task.id}>
                      <div className="flex items-center justify-between gap-3">
                        <StatusBadge status={task.displayStatus ?? task.status} />
                        <span className="text-sm text-[var(--teal)]">{task.priorityScore}</span>
                      </div>
                      <h4 className="mt-3 text-base font-semibold text-violet-950">{task.title}</h4>
                      <p className="mt-2 text-sm text-violet-900/80">
                        先完成：{task.blockingPredecessorTitles?.join("、") || "前置任务"}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">截止：{formatDeadline(task.deadline)}</p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        {firstBlockingPredecessor ? (
                          <Link
                            className="rounded-full border border-violet-300 bg-white px-4 py-2 text-sm font-medium text-violet-950 hover:bg-violet-100"
                            href={`/tasks/${firstBlockingPredecessor.id}`}
                          >
                            先做：{firstBlockingPredecessor.title}
                          </Link>
                        ) : null}
                        <Link
                          className="rounded-full border border-violet-200 bg-white px-4 py-2 text-sm text-violet-900"
                          href={`/tasks/${task.id}`}
                        >
                          查看当前任务
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {section === "today" ? (
        <>
          <section className="rounded-[32px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_18px_40px_rgba(90,67,35,0.07)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">Today</p>
                <h2 className="mt-2 text-3xl font-semibold">{todayLabel}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--muted)]">
                  今天这页只回答三件事：现在必须处理什么、哪些可以顺手推进、哪些先挪到今晚或明早再提醒。
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="rounded-full bg-rose-50 px-3 py-1.5 text-rose-700 ring-1 ring-rose-200">必须做 {todayMustDoTasks.length}</span>
                <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-cyan-800 ring-1 ring-cyan-200">今晚回看 {todayReminderTasks.length}</span>
                <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-800 ring-1 ring-amber-200">顺手推进 {todayShouldDoTasks.length}</span>
                <span className="rounded-full bg-white px-3 py-1.5 text-[var(--muted)] ring-1 ring-[var(--line)]">可放一放 {todayCanWaitTasks.length}</span>
              </div>
            </div>
          </section>

          <TodayScheduleBoard
            mustDoTasks={todayMustDoTasks}
            shouldDoTasks={todayShouldDoTasks}
            reminderTasks={todayReminderTasks}
            canWaitTasks={todayCanWaitTasks}
          />

          <section className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-[28px] border border-rose-200 bg-rose-50 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-rose-950">今天必须做</h3>
                  <p className="mt-1 text-sm text-rose-900/80">今天到期、已经逾期，或今天不处理就容易翻车的事项。</p>
                </div>
                <span className="text-sm text-rose-700">{todayMustDoTasks.length} 条</span>
              </div>
              <div className="mt-4 space-y-3">
                {todayMustDoTasks.length === 0 ? (
                  <p className="rounded-2xl bg-white/80 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">今天没有必须立刻处理的硬截止项。</p>
                ) : (
                  todayMustDoTasks.slice(0, 6).map((task) => (
                    <div className="rounded-[22px] bg-white/85 p-4 ring-1 ring-rose-200" key={task.id}>
                      <Link className="block" href={`/tasks/${task.id}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{task.title}</p>
                          <StatusBadge status={task.displayStatus ?? task.status} />
                        </div>
                        <p className="mt-2 text-sm text-rose-900">截止：{formatDeadline(task.deadline)}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">{task.priorityReason}</p>
                      </Link>
                      <div className="mt-3 flex flex-col gap-2">
                        {task.needsHumanReview ? <ReviewQuickActions compact taskId={task.id} /> : <TaskStatusShortcutActions compact status={task.status} taskId={task.id} />}
                        {!task.needsHumanReview ? <TaskReminderActions compact taskId={task.id} /> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-cyan-200 bg-cyan-50 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-cyan-950">今晚该回看</h3>
                  <p className="mt-1 text-sm text-cyan-900/80">等回复、等公示、等材料的任务，今天到点就把它们重新捞出来。</p>
                </div>
                <span className="text-sm text-cyan-800">{todayReminderTasks.length} 条</span>
              </div>
              <div className="mt-4 space-y-3">
                {todayReminderTasks.length === 0 ? (
                  <p className="rounded-2xl bg-white/80 px-4 py-3 text-sm text-cyan-900 ring-1 ring-cyan-200">今天没有到点要回看的等待任务。</p>
                ) : (
                  todayReminderTasks.slice(0, 6).map((task) => (
                    <div className="rounded-[22px] bg-white/85 p-4 ring-1 ring-cyan-200" key={task.id}>
                      <Link className="block" href={`/tasks/${task.id}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{task.title}</p>
                          <StatusBadge status={task.displayStatus ?? task.status} />
                        </div>
                        <p className="mt-2 text-sm text-cyan-900">{describeWaitingReason(task) || "这条等待任务已经到了回看时间。"}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">截止：{formatDeadline(task.deadline)}</p>
                      </Link>
                      <div className="mt-3">
                        <WaitingFollowUpActions compact taskId={task.id} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-amber-950">今天顺手推进</h3>
                  <p className="mt-1 text-sm text-amber-900/80">不一定今天到期，但今天推进收益高，做了会明显减轻后面压力。</p>
                </div>
                <span className="text-sm text-amber-800">{todayShouldDoTasks.length} 条</span>
              </div>
              <div className="mt-4 space-y-3">
                {todayShouldDoTasks.length === 0 ? (
                  <p className="rounded-2xl bg-white/80 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">今天没有额外需要顺手推进的高收益任务。</p>
                ) : (
                  todayShouldDoTasks.map((task) => (
                    <div className="rounded-[22px] bg-white/85 p-4 ring-1 ring-amber-200" key={task.id}>
                      <Link className="block" href={`/tasks/${task.id}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{task.title}</p>
                          <span className="text-sm text-[var(--teal)]">{task.priorityScore}</span>
                        </div>
                        <p className="mt-2 text-sm text-[var(--muted)]">截止：{formatDeadline(task.deadline)}</p>
                        <p className="mt-1 text-sm text-amber-900">{task.priorityReason}</p>
                      </Link>
                      <div className="mt-3 flex flex-col gap-2">
                        <TaskStatusShortcutActions compact status={task.status} taskId={task.id} />
                        <TaskReminderActions compact taskId={task.id} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold">可以放一放</h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">这些不是今天的主线，必要时可以直接挪到今晚或明早再提醒。</p>
                </div>
                <span className="text-sm text-[var(--muted)]">{todayCanWaitTasks.length} 条</span>
              </div>
              <div className="mt-4 space-y-3">
                {todayCanWaitTasks.length === 0 ? (
                  <p className="rounded-2xl bg-white/75 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">当前没有明显可以后置的可执行任务。</p>
                ) : (
                  todayCanWaitTasks.map((task) => (
                    <div className="rounded-[22px] bg-white/75 p-4 ring-1 ring-[var(--line)]" key={task.id}>
                      <Link className="block" href={`/tasks/${task.id}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{task.title}</p>
                          <StatusBadge status={task.displayStatus ?? task.status} />
                        </div>
                        <p className="mt-2 text-sm text-[var(--muted)]">截止：{formatDeadline(task.deadline)}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">{task.nextActionSuggestion}</p>
                      </Link>
                      <div className="mt-3 flex flex-col gap-2">
                        <TaskStatusShortcutActions compact status={task.status} taskId={task.id} />
                        <TaskReminderActions compact taskId={task.id} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </section>
        </>
      ) : null}

      {section === "tasks" ? (
        <>
          <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
            <div className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
              <h3 className="text-xl font-semibold">任务视角</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">在这一栏专门看日历和任务列表，不再和总览信息混在一起。</p>
            </div>

            <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xl font-semibold">筛选</h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">只在任务分栏里切换列表视角。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {dashboardFilterOptions.map((option) => (
                    <Link
                      className={`rounded-full border px-4 py-2 text-sm ${
                        filter === option.value
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--line)] bg-white text-[var(--muted)]"
                      }`}
                      href={`/?section=tasks&filter=${option.value}`}
                      key={option.value}
                    >
                      {option.label}
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          </section>

          <HomeCalendar tasks={tasks} />

          <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-2xl font-semibold">全部任务</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">按状态分组快速扫一遍，不把主页做成第二个详情页。</p>
              </div>
              <p className="text-sm text-[var(--muted)]">当前视角下共 {filteredTasks.length} 条。</p>
            </div>
            <div className="mt-6 space-y-6">
              {Object.entries(grouped).length === 0 ? (
                <div className="rounded-[24px] bg-white/75 px-4 py-5 text-sm leading-6 text-[var(--muted)] ring-1 ring-[var(--line)]">
                  {databaseReady
                    ? "当前还没有任务。可以先去导入页添加通知，或者在导入页点击“导入 demo 数据”体验完整流程。"
                    : "数据库表还不存在。请先运行 npm run setup 或 npm run db:push，完成初始化后这里会正常显示空任务状态。"}
                </div>
              ) : (
                Object.entries(grouped).map(([status, tasks]) => (
                  <section key={status}>
                    <div className="mb-3 flex items-center gap-3 border-b border-[rgba(71,53,31,0.08)] pb-2">
                      <StatusBadge status={status as keyof typeof statusLabels} />
                      <span className="text-sm text-[var(--muted)]">{tasks.length} 条</span>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {tasks.map((task) => (
                        <TaskCard compact key={task.id} task={task} />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}

      {section === "sources" ? (
        <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-semibold">最近导入的来源</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">把来源追溯单独放一栏，不再挤在任务页下面。</p>
            </div>
            <Link className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)]" href="/import">
              继续导入
            </Link>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {recentSources.length === 0 ? (
              <div className="rounded-[24px] bg-white/75 p-4 text-sm leading-6 text-[var(--muted)] ring-1 ring-[var(--line)]">
                {databaseReady
                  ? "还没有任何来源记录。先去导入一条通知，或在导入页手动加载 demo 数据。"
                  : "数据库尚未初始化完成，来源列表暂不可用。"}
              </div>
            ) : (
              recentSources.map((source) => (
                <div className="rounded-[20px] bg-white/65 p-4 ring-1 ring-[rgba(71,53,31,0.08)] transition hover:ring-[var(--accent)]" key={source.id}>
                  <div className="flex items-start justify-between gap-3">
                    <Link className="min-w-0 flex-1" href={`/sources/${source.id}`}>
                      <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                        <span className="uppercase tracking-[0.2em]">{source.type}</span>
                        <span>·</span>
                        <span>{source.tasks.length} 条任务</span>
                      </div>
                      <h4 className="mt-2 text-base font-semibold">{source.title || source.originalFilename || "未命名来源"}</h4>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{source.summary || "暂无摘要"}</p>
                    </Link>
                    <DeleteSourceAction compact sourceId={source.id} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {section === "settings" ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <IdentitySettingCard initialIdentities={activeIdentities} matchedCount={matchedIdentityTasks.length} />
          <AiSettingsCard
            initialApiKey={settings.aiApiKey ?? ""}
            initialBaseUrl={settings.aiBaseUrl ?? ""}
            initialModel={settings.aiModel ?? ""}
            initialSupportsVision={settings.aiSupportsVision}
            initialVisionModel={settings.aiVisionModel ?? ""}
          />
        </section>
      ) : null}

      <HomeAiAssistant databaseReady={databaseReady} />
    </main>
  );
}
