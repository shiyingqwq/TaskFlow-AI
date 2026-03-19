"use client";

import { useMemo, useState, useTransition } from "react";

import { CourseScheduleItem, CourseTableConfig, normalizeCourseTableConfig, parseCourseScheduleText, toCourseScheduleText } from "@/lib/course-schedule";

type Props = {
  initialCourses: CourseScheduleItem[];
  initialTableConfig: CourseTableConfig;
};

export function CourseScheduleSettingCard({ initialCourses, initialTableConfig }: Props) {
  const normalizedInitialConfig = normalizeCourseTableConfig(initialTableConfig);
  const [editorValue, setEditorValue] = useState(toCourseScheduleText(initialCourses));
  const [tableConfig, setTableConfig] = useState<CourseTableConfig>(normalizedInitialConfig);
  const [message, setMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsed = useMemo(() => parseCourseScheduleText(editorValue), [editorValue]);

  async function save() {
    if (parsed.errors.length > 0) {
      setMessage("课表格式有误，请先修正再保存。");
      return;
    }

    const response = await fetch("/api/settings/courses", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        courseSchedule: parsed.items,
        courseTableConfig: tableConfig,
      }),
    });

    if (!response.ok) {
      setMessage("课表保存失败。");
      return;
    }

    setMessage("课表已更新，今日日程会自动避开上课时段。");
    window.location.reload();
  }

  async function importWithAi() {
    if (!selectedFile) {
      setMessage("请先选择课表图片。");
      return;
    }

    setIsImporting(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const response = await fetch("/api/settings/courses/import", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { courses?: CourseScheduleItem[]; warnings?: string[]; error?: string; mode?: string };
      if (!response.ok) {
        setMessage(data.error || "AI 导入失败。");
        return;
      }

      const imported = Array.isArray(data.courses) ? data.courses : [];
      setEditorValue(toCourseScheduleText(imported));
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      setMessage(
        imported.length > 0
          ? `已识别 ${imported.length} 条课程（${data.mode === "openai" ? "AI" : "规则"}）。${warnings.length > 0 ? ` 注意：${warnings[0]}` : ""}`
          : `未识别到课程。${warnings.length > 0 ? warnings[0] : "请更换更清晰的课表图。"}`
      );
    } catch {
      setMessage("AI 导入失败。");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
      <div>
        <h3 className="text-xl font-semibold">课程课表（MVP）</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          每行一节课，格式：`周X HH:mm-HH:mm 课程名 @地点`。例如：`周一 08:00-09:40 内科学 @一教201`
        </p>
      </div>

      <textarea
        className="mt-4 min-h-48 w-full rounded-2xl border border-[var(--line)] bg-white p-3 text-sm leading-6 text-[var(--text)] outline-none focus:border-[var(--accent)]"
        onChange={(event) => setEditorValue(event.target.value)}
        placeholder={"周一 08:00-09:40 内科学 @一教201\n周三 10:10-11:50 病理学 @二教305"}
        value={editorValue}
      />

      <div className="mt-3 grid gap-3 rounded-2xl bg-white/70 p-3 ring-1 ring-[var(--line)] md:grid-cols-[1fr_auto] md:items-center">
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--ink)]">AI 导入课表图片</p>
          <input
            accept="image/*"
            className="block w-full text-sm text-[var(--muted)] file:mr-3 file:rounded-full file:border file:border-[var(--line)] file:bg-white file:px-3 file:py-1.5 file:text-sm"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </div>
        <button
          className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)] transition active:scale-[0.98] disabled:opacity-60"
          disabled={isImporting}
          onClick={() => {
            void importWithAi();
          }}
          type="button"
        >
          {isImporting ? "识别中..." : "AI 识别图片"}
        </button>
      </div>

      <div className="mt-3 rounded-2xl bg-white/70 p-3 ring-1 ring-[var(--line)]">
        <p className="text-sm font-medium text-[var(--ink)]">课程表时间配置</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm text-[var(--muted)]">
            当前学期
            <select
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
              onChange={(event) =>
                setTableConfig((prev) => ({
                  ...prev,
                  currentTerm: event.target.value === "autumn" ? "autumn" : "spring",
                }))
              }
              value={tableConfig.currentTerm}
            >
              <option value="spring">春季</option>
              <option value="autumn">秋季</option>
            </select>
          </label>
          <label className="text-sm text-[var(--muted)]">
            网格粒度
            <select
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
              onChange={(event) =>
                setTableConfig((prev) => ({
                  ...prev,
                  slotMinutes: event.target.value === "30" ? 30 : 60,
                }))
              }
              value={String(tableConfig.slotMinutes)}
            >
              <option value="30">30 分钟</option>
              <option value="60">60 分钟</option>
            </select>
          </label>
          <label className="text-sm text-[var(--muted)]">
            春季开始时间
            <input
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
              onChange={(event) =>
                setTableConfig((prev) => ({
                  ...prev,
                  spring: { ...prev.spring, dayStart: event.target.value },
                }))
              }
              type="time"
              value={tableConfig.spring.dayStart}
            />
          </label>
          <label className="text-sm text-[var(--muted)]">
            春季结束时间
            <input
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
              onChange={(event) =>
                setTableConfig((prev) => ({
                  ...prev,
                  spring: { ...prev.spring, dayEnd: event.target.value },
                }))
              }
              type="time"
              value={tableConfig.spring.dayEnd}
            />
          </label>
          <label className="text-sm text-[var(--muted)]">
            秋季开始时间
            <input
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
              onChange={(event) =>
                setTableConfig((prev) => ({
                  ...prev,
                  autumn: { ...prev.autumn, dayStart: event.target.value },
                }))
              }
              type="time"
              value={tableConfig.autumn.dayStart}
            />
          </label>
          <label className="text-sm text-[var(--muted)]">
            秋季结束时间
            <input
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
              onChange={(event) =>
                setTableConfig((prev) => ({
                  ...prev,
                  autumn: { ...prev.autumn, dayEnd: event.target.value },
                }))
              }
              type="time"
              value={tableConfig.autumn.dayEnd}
            />
          </label>
        </div>
      </div>

      {parsed.errors.length > 0 ? (
        <div className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">
          {parsed.errors.slice(0, 3).map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted)]">已识别 {parsed.items.length} 条课程。</p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
          disabled={isPending}
          onClick={() => {
            startTransition(() => {
              save();
            });
          }}
          type="button"
        >
          {isPending ? "保存中..." : "保存课表"}
        </button>
        <button
          className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)] transition active:scale-[0.98]"
          onClick={() => setEditorValue("")}
          type="button"
        >
          清空课表
        </button>
      </div>

      {message ? <p className="mt-3 text-sm text-[var(--muted)]">{message}</p> : null}
    </section>
  );
}
