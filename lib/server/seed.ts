import { ActionType } from "@/generated/prisma/enums";

import { demoSources } from "@/lib/data/demo-sources";
import { createSourceAndTasks, recalculateAllPriorities } from "@/lib/server/tasks";
import { prisma } from "@/lib/server/db";

async function addSeededLogsForNewTasks(taskIds: string[]) {
  if (taskIds.length === 0) {
    return;
  }

  await prisma.$transaction(
    taskIds.map((taskId) =>
      prisma.actionLog.create({
        data: {
          taskId,
          actionType: ActionType.seeded,
          note: "内置 demo 数据",
        },
      }),
    ),
  );
}

export async function resetAndSeedDemoData() {
  await prisma.actionLog.deleteMany();
  await prisma.dependency.deleteMany();
  await prisma.task.deleteMany();
  await prisma.source.deleteMany();

  const createdTaskIds: string[] = [];
  for (const source of demoSources) {
    const result = await createSourceAndTasks(source);
    createdTaskIds.push(...result.createdTasks.map((task) => task.id));
  }

  await addSeededLogsForNewTasks(createdTaskIds);
  await recalculateAllPriorities();
}

export async function importDemoData() {
  const existingTitles = new Set(
    (
      await prisma.source.findMany({
        where: {
          title: {
            in: demoSources.map((source) => source.title),
          },
        },
        select: {
          title: true,
        },
      })
    )
      .map((source) => source.title)
      .filter((title): title is string => Boolean(title)),
  );

  const createdTaskIds: string[] = [];
  let importedSources = 0;

  for (const source of demoSources) {
    if (source.title && existingTitles.has(source.title)) {
      continue;
    }
    const result = await createSourceAndTasks(source);
    createdTaskIds.push(...result.createdTasks.map((task) => task.id));
    importedSources += 1;
  }

  await addSeededLogsForNewTasks(createdTaskIds);
  return {
    importedSources,
    importedTasks: createdTaskIds.length,
  };
}
