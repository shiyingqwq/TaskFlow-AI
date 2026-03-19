import Link from "next/link";

type SectionValue = "overview" | "today" | "tasks" | "sources" | "settings";

const sectionOptions: Array<{ value: SectionValue; label: string }> = [
  { value: "overview", label: "总览" },
  { value: "today", label: "今日" },
  { value: "tasks", label: "任务" },
  { value: "sources", label: "来源" },
  { value: "settings", label: "设置" },
];

export function TopSectionNav({
  activeSection,
  filter = "all",
  importActive = false,
}: {
  activeSection?: SectionValue;
  filter?: string;
  importActive?: boolean;
}) {
  const buildSectionHref = (nextSection: SectionValue) => ({
    pathname: "/",
    query: {
      section: nextSection,
      filter,
    },
  });

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sectionOptions.map((option) => (
            <Link
              className={`shrink-0 rounded-full border px-4 py-2 text-sm ${
                activeSection === option.value
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-[var(--line)] bg-white text-[var(--muted)]"
              }`}
              href={buildSectionHref(option.value)}
              key={option.value}
            >
              {option.label}
            </Link>
          ))}
        </div>
        <Link
          className={`shrink-0 rounded-full border px-4 py-2 text-sm ${
            importActive
              ? "border-[var(--accent)] bg-[var(--accent)] text-white"
              : "border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          }`}
          href="/import"
        >
          导入通知
        </Link>
      </div>
    </section>
  );
}
