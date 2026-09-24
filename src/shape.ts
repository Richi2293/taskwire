import type { RawChecklist, RawComment, RawList, RawTask } from './clickup-types.ts';
import { msToIso } from './dates.ts';

export interface TaskSummary {
  id: string;
  name: string;
  status: string;
  priority: string | null;
  tags: string[];
  assignees: { id: number; username: string | null }[];
  due: string | null;
  list: { id: string; name: string };
  parent: string | null;
  url: string;
  updatedAt: string | null;
}

export interface ChecklistOut {
  id: string;
  name: string;
  items: { id: string; name: string; resolved: boolean }[];
}

export interface TaskDetail extends TaskSummary {
  description: string;
  subtasks: TaskSummary[];
  checklists: ChecklistOut[];
  dependencies: { blockedBy: string[]; blocking: string[] };
  comments: { id: string; author: string | null; date: string | null; text: string }[];
}

export interface ListOut {
  id: string;
  name: string;
  statuses: string[];
}

export function toTask(raw: RawTask): TaskSummary {
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status.status,
    priority: raw.priority?.priority ?? null,
    tags: raw.tags.map((tag) => tag.name),
    assignees: raw.assignees.map((user) => ({ id: user.id, username: user.username })),
    due: msToIso(raw.due_date),
    list: { id: raw.list.id, name: raw.list.name },
    parent: raw.parent,
    url: raw.url,
    updatedAt: msToIso(raw.date_updated),
  };
}

export function toChecklist(raw: RawChecklist): ChecklistOut {
  return {
    id: raw.id,
    name: raw.name,
    items: raw.items.map((item) => ({ id: item.id, name: item.name, resolved: item.resolved })),
  };
}

export function toTaskDetail(raw: RawTask, comments: RawComment[]): TaskDetail {
  const dependencies = raw.dependencies ?? [];
  return {
    ...toTask(raw),
    description: raw.markdown_description ?? raw.description ?? '',
    subtasks: (raw.subtasks ?? []).map(toTask),
    checklists: (raw.checklists ?? []).map(toChecklist),
    dependencies: {
      blockedBy: dependencies.filter((d) => d.task_id === raw.id).map((d) => d.depends_on),
      blocking: dependencies.filter((d) => d.depends_on === raw.id).map((d) => d.task_id),
    },
    comments: comments.map((comment) => ({
      id: comment.id,
      author: comment.user.username,
      date: msToIso(comment.date),
      text: comment.comment_text,
    })),
  };
}

export function toList(raw: RawList): ListOut {
  return { id: raw.id, name: raw.name, statuses: (raw.statuses ?? []).map((s) => s.status) };
}
