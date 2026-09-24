export interface RawUser {
  id: number;
  username: string | null;
  email?: string;
}

export interface RawStatus {
  status: string;
  type?: string;
}

export interface RawChecklistItem {
  id: string;
  name: string;
  resolved: boolean;
}

export interface RawChecklist {
  id: string;
  name: string;
  items: RawChecklistItem[];
}

export interface RawDependency {
  task_id: string;
  depends_on: string;
}

export interface RawTask {
  id: string;
  name: string;
  url: string;
  status: RawStatus;
  priority: { priority: string } | null;
  tags: { name: string }[];
  assignees: RawUser[];
  due_date: string | null;
  date_updated: string | null;
  parent: string | null;
  list: { id: string; name: string };
  folder: { id: string; name: string };
  markdown_description?: string | null;
  description?: string | null;
  subtasks?: RawSubtask[];
  checklists?: RawChecklist[];
  dependencies?: RawDependency[];
}

// Subtasks nested in GET /task/{id} come without list, folder and priority.
export type RawSubtask = Omit<RawTask, 'list' | 'folder' | 'priority'> & Partial<Pick<RawTask, 'list' | 'folder' | 'priority'>>;

export interface RawList {
  id: string;
  name: string;
  folder?: { id: string; name?: string };
  statuses?: RawStatus[];
}

export interface RawComment {
  id: string;
  comment_text: string;
  user: RawUser;
  date: string;
  assignee?: RawUser | null;
  resolved?: boolean;
}
