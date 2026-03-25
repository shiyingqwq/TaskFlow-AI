export type AssistantSkill = "task_ops" | "schedule_ops" | "course_reader" | "daily_log" | "general";

export function detectAssistantSkill(message: string): AssistantSkill {
  const text = message.replace(/\s+/g, "");

  if (/(课表|课程|空档|上课|第几节|今天有课|今天有什么课)/.test(text)) {
    return "course_reader";
  }

  if (/(今日日程|今天安排|安排数据|排版数据|时段|排程|改到\d|安排到\d|放到\d)/.test(text)) {
    return "schedule_ops";
  }

  if (/(日志|日报|汇报|总结今天)/.test(text)) {
    return "daily_log";
  }

  if (/(新增|修改|编辑|标记|状态|截止|重复|任务|待办|进度|删除)/.test(text)) {
    return "task_ops";
  }

  return "general";
}

export function getSkillToolCatalog(skill: AssistantSkill) {
  if (skill === "course_reader") {
    return [
      "get_today_courses",
      "get_today_free_windows",
    ];
  }

  if (skill === "schedule_ops") {
    return [
      "get_today_schedule_summary",
      "update_task_core(startAtISO/estimatedMinutes/snoozeUntilISO/status)",
      "get_today_courses",
    ];
  }

  if (skill === "task_ops") {
    return [
      "get_dashboard_tasks",
      "update_status",
      "update_task_core",
      "record_progress",
      "schedule_follow_up",
      "create_task",
      "delete_task",
    ];
  }

  if (skill === "daily_log") {
    return [
      "read_daily_log_snapshot",
      "generate_daily_log",
      "polish_daily_log",
    ];
  }

  return [
    "get_dashboard_tasks",
    "get_today_schedule_summary",
    "get_today_courses",
  ];
}

export function getSkillInstruction(skill: AssistantSkill) {
  if (skill === "course_reader") {
    return "当前是课表技能：优先回答课程与空档，不要误触发任务修改动作。";
  }
  if (skill === "schedule_ops") {
    return "当前是日程技能：可读取今日日程摘要，并通过 update_task_core 调整 startAtISO/estimatedMinutes 等排程字段。";
  }
  if (skill === "task_ops") {
    return "当前是任务技能：可执行任务字段和状态管理。";
  }
  if (skill === "daily_log") {
    return "当前是日志技能：聚焦日志读取/生成/润色。";
  }
  return "当前是通用技能：先澄清意图，再选择最小必要动作。";
}
