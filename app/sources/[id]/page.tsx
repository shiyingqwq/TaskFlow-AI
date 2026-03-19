import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteSourceAction } from "@/components/delete-source-action";
import { DetailPageNav } from "@/components/detail-page-nav";
import { TaskCard } from "@/components/task-card";
import { getSourceById } from "@/lib/server/tasks";

export default async function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await getSourceById(id);
  if (!source) {
    notFound();
  }

  return (
    <main className="space-y-4 pb-10">
      <DetailPageNav
        items={[
          { label: "总览", href: "/" },
          { label: "来源", href: "/?section=sources&filter=all" },
          { label: source.title || source.originalFilename || "未命名来源" },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="space-y-6">
        <div className="rounded-[30px] border border-[var(--line)] bg-[var(--panel)] p-6">
          <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">{source.type}</p>
          <h1 className="mt-3 text-3xl font-semibold">{source.title || source.originalFilename || "未命名来源"}</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{source.summary || "暂无解析摘要"}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <DeleteSourceAction sourceId={source.id} />
          </div>

          {source.type === "image" && source.filePath ? (
            <div className="mt-5 overflow-hidden rounded-[24px] ring-1 ring-[var(--line)]">
              <Image alt={source.title || "来源截图"} className="h-auto w-full object-cover" height={1200} src={source.filePath} width={900} />
            </div>
          ) : null}

          <div className="mt-5 rounded-[24px] bg-white/75 p-4 ring-1 ring-[var(--line)]">
            <p className="text-sm font-medium">原始文本</p>
            <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--muted)]">{source.rawText || "无可提取文本"}</pre>
          </div>
        </div>
      </section>

      <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel)] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">关联任务</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">点击任务可继续查看证据片段、依赖关系和状态流转。</p>
          </div>
          <span className="text-sm text-[var(--muted)]">{source.tasks.length} 条</span>
        </div>
        <div className="mt-5 space-y-4">
          {source.tasks.length === 0 ? (
            <p className="rounded-[24px] bg-white/75 px-4 py-3 text-sm text-[var(--muted)] ring-1 ring-[var(--line)]">
              该来源暂未生成任务，可能是图片 fallback 或 PDF 文本提取失败。
            </p>
          ) : (
            source.tasks.map((task) => <TaskCard key={task.id} task={{ ...task, source }} />)
          )}
        </div>
      </section>
      </div>
    </main>
  );
}
