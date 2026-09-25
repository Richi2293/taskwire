import type { Client } from './client.ts';
import type { RawList, RawTask } from './clickup-types.ts';
import { configError, usageError } from './errors.ts';
import type { TaskwireError } from './errors.ts';

export function normalizeTaskId(id: string): string {
  const cleaned = id.trim().replace(/^#/, '');
  if (cleaned === '' || /\s/.test(cleaned)) throw usageError(`Invalid task id "${id}"`);
  return cleaned;
}

// listIds, when given, narrows the project to those lists of the folder (see ProjectConfig.listIds).
export async function loadTaskInFolder(
  client: Client,
  taskId: string,
  folderId: string,
  listIds?: readonly string[],
): Promise<RawTask> {
  const id = normalizeTaskId(taskId);
  const task = await client.request<RawTask>('GET', `/task/${encodeURIComponent(id)}`, {
    query: { include_subtasks: true, include_markdown_description: true },
  });
  if (task.folder?.id !== folderId) {
    throw configError(
      `Task ${id} is outside this project's ClickUp folder`,
      `Expected folder ${folderId}, found ${task.folder?.id ?? 'none'} (${task.folder?.name ?? 'no folder'})`,
    );
  }
  // A task belongs to the project of its home list, even when it also shows in other lists.
  if (listIds !== undefined && !listIds.includes(task.list.id)) {
    throw outsideLists(`Task ${id}`, listIds, task.list.id, task.list.name);
  }
  return task;
}

export async function loadListInFolder(
  client: Client,
  listId: string,
  folderId: string,
  listIds?: readonly string[],
): Promise<RawList> {
  if (!/^\d+$/.test(listId)) throw usageError(`Invalid list id "${listId}"`, 'Run "taskwire lists" to see the list ids');
  const list = await client.request<RawList>('GET', `/list/${listId}`);
  if (list.folder?.id !== folderId) {
    throw configError(
      `List ${listId} is outside this project's ClickUp folder`,
      `Expected folder ${folderId}, found ${list.folder?.id ?? 'none'}`,
    );
  }
  if (listIds !== undefined && !listIds.includes(list.id)) {
    throw outsideLists(`List ${listId}`, listIds, list.id, list.name);
  }
  return list;
}

function outsideLists(subject: string, listIds: readonly string[], foundId: string, foundName: string): TaskwireError {
  return configError(
    `${subject} is outside this project's lists`,
    `Expected one of ${listIds.join(', ')}, found ${foundId} (${foundName}). The project lists are "listIds" in .taskwire.json`,
  );
}
