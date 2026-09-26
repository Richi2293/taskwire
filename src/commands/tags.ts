import type { Context } from './context.ts';
import { listTasks } from './tasks-read.ts';

export interface TagOut {
  name: string;
  tasks: number;
}

// Tags come from the project's tasks, not from the ClickUp space, whose tags also belong to other folders and projects.
export async function listTags(ctx: Context): Promise<TagOut[]> {
  const input = { positionals: [], values: { 'include-closed': true } };
  const tasks = await listTasks(ctx, input, 'Some tags may be missing: they come from the tasks read so far');
  const counts = new Map<string, number>();
  for (const task of tasks) {
    for (const tag of task.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, tasks: count }))
    .sort((a, b) => b.tasks - a.tasks || a.name.localeCompare(b.name));
}
