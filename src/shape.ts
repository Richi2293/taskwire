import type { RawChecklist, RawComment, RawCommentBlock, RawList, RawTask } from './clickup-types.ts';
import { msToIso, msToLocalIso } from './dates.ts';
import { DEFAULT_NEEDS_TAGS, needsFromTags } from './needs.ts';
import type { NeedsKind, NeedsTags } from './needs.ts';

export interface TaskSummary {
  id: string;
  name: string;
  status: string;
  priority: string | null;
  tags: string[];
  // Why the task waits for a person, read from its needs tag; null when it waits for nobody.
  needs: NeedsKind | null;
  assignees: { id: number; username: string | null }[];
  due: string | null;
  list: { id: string; name: string };
  parent: string | null;
  // The tasks this one waits for (ClickUp dependencies), open or closed.
  blockedBy: string[];
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
  comments: {
    id: string;
    author: string | null;
    date: string | null;
    text: string;
    resolved: boolean;
    assignee: { id: number; username: string | null } | null;
  }[];
}

export interface ListOut {
  id: string;
  name: string;
  statuses: string[];
}

export function toTask(raw: RawTask, needsTags: NeedsTags = DEFAULT_NEEDS_TAGS): TaskSummary {
  const tags = raw.tags.map((tag) => tag.name);
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status.status,
    priority: raw.priority?.priority ?? null,
    tags,
    needs: needsFromTags(tags, needsTags),
    assignees: raw.assignees.map((user) => ({ id: user.id, username: user.username })),
    due: msToLocalIso(raw.due_date),
    list: { id: raw.list.id, name: raw.list.name },
    parent: raw.parent,
    blockedBy: (raw.dependencies ?? []).filter((d) => d.task_id === raw.id).map((d) => d.depends_on),
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

export function toTaskDetail(raw: RawTask, comments: RawComment[], needsTags: NeedsTags = DEFAULT_NEEDS_TAGS): TaskDetail {
  const dependencies = raw.dependencies ?? [];
  return {
    ...toTask(raw, needsTags),
    description: raw.markdown_description ?? raw.description ?? '',
    subtasks: (raw.subtasks ?? []).map((subtask) =>
      toTask({ ...subtask, list: subtask.list ?? raw.list, folder: subtask.folder ?? raw.folder, priority: subtask.priority ?? null }, needsTags),
    ),
    checklists: (raw.checklists ?? []).map(toChecklist),
    dependencies: {
      blockedBy: dependencies.filter((d) => d.task_id === raw.id).map((d) => d.depends_on),
      blocking: dependencies.filter((d) => d.depends_on === raw.id).map((d) => d.task_id),
    },
    comments: comments.map((comment) => ({
      id: comment.id,
      author: comment.user.username,
      date: msToIso(comment.date),
      text: commentMarkdown(comment.comment, comment.comment_text),
      resolved: comment.resolved ?? false,
      assignee: comment.assignee ? { id: comment.assignee.id, username: comment.assignee.username } : null,
    })),
  };
}

export function toList(raw: RawList): ListOut {
  return { id: raw.id, name: raw.name, statuses: (raw.statuses ?? []).map((s) => s.status) };
}

type LineFormat = Record<string, unknown>;

interface CommentLine {
  text: string;
  format: LineFormat | 'divider';
}

// Rebuilds the markdown of a comment from its blocks, because `comment_text` has no formatting.
// Falls back to the plain text when a block is unknown (a mention, for example), so no text is lost.
export function commentMarkdown(blocks: RawCommentBlock[] | undefined, plainText: string): string {
  const lines = blocks && blocks.length > 0 ? commentLines(blocks) : null;
  return lines ? renderLines(lines) : plainText;
}

function commentLines(blocks: RawCommentBlock[]): CommentLine[] | null {
  const lines: CommentLine[] = [];
  let current = '';
  for (const block of blocks) {
    if (block.type === 'divider') {
      if (current) lines.push({ text: current, format: {} });
      current = '';
      lines.push({ text: '', format: 'divider' });
      continue;
    }
    if (block.type !== undefined || typeof block.text !== 'string') return null;
    const attributes = block.attributes ?? {};
    block.text.split('\n').forEach((part, index) => {
      if (index > 0) {
        // The attributes of a "\n" are the format of the line it ends.
        lines.push({ text: current, format: attributes });
        current = '';
      }
      current += inlineMarkdown(part, attributes);
    });
  }
  if (current) lines.push({ text: current, format: {} });
  return lines;
}

function inlineMarkdown(text: string, attributes: LineFormat): string {
  if (!text) return '';
  let result = text;
  if (attributes.code) result = `\`${result}\``;
  if (attributes.italic) result = `*${result}*`;
  if (attributes.bold) result = `**${result}**`;
  if (attributes.strike) result = `~~${result}~~`;
  if (typeof attributes.link === 'string') result = `[${result}](${attributes.link})`;
  return result;
}

const LIST_MARKERS: Record<string, string> = { bullet: '- ', checked: '- [x] ', unchecked: '- [ ] ' };

function renderLines(lines: CommentLine[]): string {
  const output: string[] = [];
  let inCodeBlock = false;
  // Number of the next item of each ordered list, by indent level.
  let counters: number[] = [];
  for (const line of lines) {
    const format = line.format === 'divider' ? {} : line.format;
    const isCode = format['code-block'] !== undefined;
    if (isCode !== inCodeBlock) {
      output.push('```');
      inCodeBlock = isCode;
    }
    if (line.format === 'divider') {
      if (output.length > 0 && output[output.length - 1] !== '') output.push('');
      output.push('---');
      counters = [];
      continue;
    }
    if (isCode) {
      output.push(line.text);
      continue;
    }
    const list = typeof format.list === 'string' ? format.list : null;
    const indent = typeof format.indent === 'number' ? format.indent : 0;
    if (list === 'ordered') {
      counters.length = indent + 1;
      counters[indent] = (counters[indent] ?? 0) + 1;
      output.push(`${'  '.repeat(indent)}${counters[indent]}. ${line.text}`);
      continue;
    }
    if (list !== null && LIST_MARKERS[list]) {
      counters.length = indent;
      output.push(`${'  '.repeat(indent)}${LIST_MARKERS[list]}${line.text}`);
      continue;
    }
    counters = [];
    if (typeof format.header === 'number') output.push(`${'#'.repeat(format.header)} ${line.text}`);
    // ClickUp stores the line break between two quote lines as an empty quote line: skip it.
    else if (format.blockquote !== undefined) {
      if (line.text) output.push(`> ${line.text}`);
    }
    else output.push(line.text);
  }
  if (inCodeBlock) output.push('```');
  return output.join('\n').replace(/\n+$/, '');
}
