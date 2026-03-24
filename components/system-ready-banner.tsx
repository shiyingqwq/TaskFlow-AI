import Link from "next/link";

export function SystemReadyBanner({ unresolvedCount }: { unresolvedCount: number }) {
  if (unresolvedCount <= 0) {
    return null;
  }

  return (
    <section className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-amber-900">
          系统仍有 <span className="font-semibold">{unresolvedCount}</span> 项未就绪，可能影响导入和识别结果。
        </p>
        <Link
          className="inline-flex rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          href="/?section=settings"
        >
          去设置页修复
        </Link>
      </div>
    </section>
  );
}
