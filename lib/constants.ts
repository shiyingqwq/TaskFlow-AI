export const APP_NAME = "个人 AI 辅助任务决策系统";
export const APP_TIMEZONE = "Asia/Taipei";

export const taskTypeLabels = {
  submission: "提交",
  collection: "收集",
  communication: "沟通",
  offline: "线下办理",
  production: "制作整理",
  followup: "跟进",
} as const;

export const deliveryTypeLabels = {
  electronic: "电子版",
  paper: "纸质版",
  both: "电子 + 纸质",
  unknown: "未明确",
} as const;

export const recurrenceTypeLabels = {
  single: "单次任务",
  daily: "每日",
  weekly: "每周某几天",
  limited: "特定几次",
} as const;

export const recurrenceWeekdayLabels = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  0: "周日",
} as const;

export const statusLabels = {
  blocked: "被阻塞",
  needs_review: "待确认",
  ready: "可执行",
  waiting: "等待中",
  in_progress: "进行中",
  pending_submit: "待提交",
  submitted: "已完成",
  done: "已完成",
  overdue: "已逾期",
  ignored: "已忽略",
} as const;

export const statusTone = {
  blocked: "bg-violet-100 text-violet-900 ring-violet-200",
  needs_review: "bg-amber-100 text-amber-900 ring-amber-200",
  ready: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  waiting: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-sky-100 text-sky-900 ring-sky-200",
  pending_submit: "bg-orange-100 text-orange-900 ring-orange-200",
  submitted: "bg-zinc-100 text-zinc-700 ring-stone-200",
  done: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  overdue: "bg-rose-100 text-rose-900 ring-rose-200",
  ignored: "bg-stone-100 text-stone-500 ring-stone-200",
} as const;

export const dashboardFilterOptions = [
  { value: "all", label: "全部" },
  { value: "actionable", label: "可推进" },
  { value: "review", label: "待确认" },
  { value: "waiting", label: "等待中" },
  { value: "risk", label: "临期/逾期" },
] as const;
