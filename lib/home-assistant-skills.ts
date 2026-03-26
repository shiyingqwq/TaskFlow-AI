import { getSkillToolCatalog as getSkillToolCatalogFromRegistry } from "@/lib/home-assistant-tools";

export type AssistantSkill = "task_ops" | "schedule_ops" | "course_reader" | "daily_log" | "time_reader" | "general";

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

  if (
    /(现在几点|现在几?点钟|当前时间|现在时间|今天几号|今天几月几号|今天星期几|今天周几|今天是几号)/.test(text) ||
    /(?:能|可以|可否).*(?:读取|告诉我|查看).*(?:时间|几点|日期|星期)/.test(text) ||
    /(?:现在|当前|此刻|目前).*(?:时间|几点|日期|星期|周几)/.test(text)
  ) {
    return "time_reader";
  }

  if (/(新增|修改|编辑|标记|状态|截止|重复|任务|待办|进度|删除)/.test(text)) {
    return "task_ops";
  }

  return "general";
}

export function getSkillToolCatalog(skill: AssistantSkill) {
  return getSkillToolCatalogFromRegistry(skill);
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
  if (skill === "time_reader") {
    return "当前是时间技能：遇到时间/日期/星期问题，优先调用 get_current_time，不要猜测。";
  }
  return "当前是通用技能：先澄清意图，再选择最小必要动作。";
}
