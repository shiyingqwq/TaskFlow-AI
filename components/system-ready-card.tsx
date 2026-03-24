type ReadinessItem = {
  key: string;
  title: string;
  ready: boolean;
  statusText: string;
  description: string;
  href: string;
  actionLabel: string;
  tone: "ok" | "warn";
};

export function SystemReadyCard({
  databaseReady,
  aiReady,
  visionReady,
  identityReady,
}: {
  databaseReady: boolean;
  aiReady: boolean;
  visionReady: boolean;
  identityReady: boolean;
}) {
  const items: ReadinessItem[] = [
    {
      key: "database",
      title: "数据库",
      ready: databaseReady,
      statusText: databaseReady ? "已就绪" : "未初始化",
      description: databaseReady ? "任务与来源数据可正常读写。" : "先在终端执行 npm run setup 或 npm run db:push。",
      href: "/import",
      actionLabel: databaseReady ? "去导入来源" : "去导入页查看提示",
      tone: databaseReady ? "ok" : "warn",
    },
    {
      key: "ai",
      title: "AI Key",
      ready: aiReady,
      statusText: aiReady ? "已配置" : "未配置",
      description: aiReady ? "文本抽取会优先走 AI Provider。" : "当前仅能使用 fallback 抽取，建议补上 API Key。",
      href: "/?section=settings",
      actionLabel: aiReady ? "调整 AI 设置" : "去配置 AI",
      tone: aiReady ? "ok" : "warn",
    },
    {
      key: "vision",
      title: "视觉模型",
      ready: visionReady,
      statusText: visionReady ? "已启用" : "未启用",
      description: visionReady ? "图片导入可走视觉模型解析。" : "图片会退回 fallback，建议在设置里启用视觉能力。",
      href: "/?section=settings",
      actionLabel: visionReady ? "查看视觉配置" : "去开启视觉",
      tone: visionReady ? "ok" : "warn",
    },
    {
      key: "identity",
      title: "身份配置",
      ready: identityReady,
      statusText: identityReady ? "已配置" : "未配置",
      description: identityReady ? "导入时会按你的身份过滤任务。" : "建议先设置身份，减少无关任务噪音。",
      href: "/?section=settings",
      actionLabel: identityReady ? "调整身份" : "去设置身份",
      tone: identityReady ? "ok" : "warn",
    },
  ];

  const readyCount = items.filter((item) => item.ready).length;

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">System Health</p>
          <h2 className="mt-1 text-xl font-semibold">系统就绪卡</h2>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">
          {readyCount}/{items.length} 已就绪
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {items.map((item) => (
          <div className="rounded-[22px] bg-white/80 p-4 ring-1 ring-[var(--line)]" key={item.key}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-[var(--text)]">{item.title}</p>
              <span
                className={`rounded-full px-2.5 py-1 text-xs ring-1 ${
                  item.tone === "ok"
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                    : "bg-amber-50 text-amber-800 ring-amber-200"
                }`}
              >
                {item.statusText}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.description}</p>
            <a
              className="mt-3 inline-flex rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              href={item.href}
            >
              {item.actionLabel}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
