import { ImportForm } from "@/components/import-form";
import { TopSectionNav } from "@/components/top-section-nav";
import Link from "next/link";
import { getAppSettings, resolveAiRuntimeConfigFromSources } from "@/lib/server/app-settings";

export default async function ImportPage() {
  const settings = await getAppSettings();
  const aiRuntime = resolveAiRuntimeConfigFromSources(settings);
  const aiReady = Boolean(aiRuntime);
  const visionReady = Boolean(aiRuntime?.supportsVision);

  return (
    <main className="space-y-6 pb-10">
      <TopSectionNav importActive />
      {!aiReady || !visionReady ? (
        <section className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-amber-900">
              导入前检查：AI Key {aiReady ? "已配置" : "未配置"}，视觉模型 {visionReady ? "已启用" : "未启用"}。
            </p>
            <Link
              className="inline-flex rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
              href="/?section=settings"
            >
              去设置页修复
            </Link>
          </div>
        </section>
      ) : null}
      <ImportForm />
    </main>
  );
}
