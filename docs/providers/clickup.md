# ClickUp

taskwire talks to the ClickUp REST API v2 with a personal token. Moving a task to another list uses the API v3, the only one that supports it.

## Token

In ClickUp: avatar > Settings > Apps > API Token. Store it as described in the README, then run `taskwire whoami`.

## How a project maps to ClickUp

One project is one ClickUp folder. taskwire reads and writes only the lists and tasks inside that folder, and checks it before every write.

A project can also be some lists of a folder, set with `listIds`: for example one folder per company and one list per project. taskwire then reads and writes only those lists, and a task or list of another list in the folder is refused with exit code 3.

```
cd path/to/project
taskwire folders                                   # every folder with its space and workspace
taskwire init --folder <id> [--list <id>]          # --list sets defaultListId
taskwire init --folder <id> --scope-list <id>...   # limits the project to those lists (listIds)
taskwire lists                                     # lists of the project and their statuses
```

| Field | Meaning |
|---|---|
| `workspaceId` | the ClickUp workspace that contains the folder, found and saved by `init` (optional: when missing, taskwire looks it up on every `taskwire tasks` without `--list`) |
| `folderId` | the ClickUp folder of the project (required) |
| `listIds` | lists of the folder that belong to the project, for a folder shared by several projects (optional: when missing, the project is the whole folder) |
| `defaultListId` | list used by `task create` when `--list` is missing (optional; with `listIds`, one of them) |

## Behavior notes

- Statuses are matched case-insensitively against the target list and sent with the list's exact name.
- `taskwire tasks --status` with no result checks that the status exists in the project's lists, so a typo is an error instead of an empty list.
- Priorities map to ClickUp's `urgent=1`, `high=2`, `normal=3`, `low=4`.
- Descriptions are sent as markdown (`markdown_content`), comments too (`comment_markdown`).
- Task ids copied from the UI with a leading `#` are accepted.
- `taskwire task get` reads up to 500 comments (20 pages of 25) and warns when older ones are left out. `--comments <n>` reads only the pages needed for the n most recent comments (one request per 25), and `--comments 0` makes no comment request. `taskwire tasks` reads up to 5000 tasks and warns the same way.
- `taskwire comment update` looks for the comment among the ones `task get` reads, so replies in a thread and comments older than the 500 most recent cannot be edited. The update sends the current `resolved` and `assignee` (required by `PUT /comment/{id}`) unchanged, and omits `assignee` when the comment has none. The new text replaces the old one, formatting included.
- Accounts with several workspaces are supported: `init` saves the workspace of the folder, so `taskwire tasks` reads the right one.
- `taskwire tasks --due-before` and `--due-after` map to `due_date_lt` (midnight of the day) and `due_date_gt` (midnight of the next day, minus 1 ms), `--top-level` to `subtasks=false`. `--limit` stops reading pages once enough tasks are found.
- `taskwire tasks --search` filters the tasks after reading them, on the name and `text_content` (the plain text of the description), because the API has no text search (see below).
- Checklist items are found through the task given with `--task`, so an item or checklist of another task is refused before any write.
- Lists can be created (`taskwire list create`) but not deleted; archive them in the ClickUp UI.
- With `listIds`:
  - a task belongs to the project of its home list (`list` in the API), also when it shows in other lists as well; subtasks always share the home list of their parent;
  - `taskwire tasks` without `--list` filters with `list_ids[]` instead of `project_ids[]`, and leaves out tasks whose home list is not in `listIds`;
  - `taskwire tasks` with no result checks the lists in `listIds`, so a wrong id is an error instead of an empty list;
  - `taskwire lists` reads only those lists, and `taskwire list create` is refused: create the list in ClickUp, then add its id to `listIds`;
  - `init` checks every list, sets the only list as `defaultListId` when there is one, and `init --force` keeps `listIds` when the folder does not change and no `--scope-list` is given.
- `task update --list` moves only top-level tasks, and their subtasks follow. With `--status`, the status is matched against the target list and set after the move.
- `task update --parent` accepts a parent in another list of the project: the subtask moves to the parent's list. `--parent none` is refused, because the API cannot detach a subtask (see below); do it in the ClickUp UI.

## Real API behavior

Facts checked against the live API:

- Subtasks nested in `GET /task/{id}` have no `list`, `folder` or `priority`; taskwire fills them from the parent. A subtask read on its own has the `list` of its parent.
- `GET /team/{id}/task` filters by list with `list_ids[]`, subtasks included; several ids return the union. An unknown list id answers 200 with no tasks instead of an error.
- Tasks in multiple lists (TIML) show their extra lists in `locations`; `list` stays the home list. On the free plan `POST /list/{id}/task/{task_id}` (add a task to another list) fails with 403 `TIML_001` ("Your plan is limited to ... usages of feature").
- Date-only due dates come back at 04:00 local time. The day is the one that was sent.
- Filtering by a closed status returns closed tasks even without `--include-closed`.
- `PUT /comment/{id}` accepts a body without `assignee`, although the docs mark it as required: updating a comment with no assignee works. The comment keeps its id, author, creation date and position, and multiline text with accents and backticks is stored as sent.
- `GET /task/{id}/comment` returns comments newest first, 25 per page. Passing `start` and `start_id` of the oldest comment returns the next older page, which does not repeat that comment (checked with 30 comments: pages of 25 and 5, no duplicates).
- `PUT /task/{id}` with `due_date: null` removes the due date, and `priority: null` removes the priority (used by `--due none` and `--priority none`).
- `PUT /task/{id}` with `parent: <task-id>` turns a top-level task into a subtask and moves a subtask to another parent. A parent in another list moves the subtask to that list. `parent` equal to the task id fails with 400 (`ITEM_069`).
- `PUT /task/{id}` with `parent: null` or `parent: ""` answers 200 but changes nothing: a subtask cannot be detached through the API.
- `PUT /task/{id}` with a `list` field answers 200 but ignores it. Moving a task needs the v3 `PUT /api/v3/workspaces/{workspace_id}/tasks/{task_id}/home_list/{list_id}`: its subtasks follow it, a subtask fails with 400 ("Only root tasks can be moved to a new home list") and an unknown list with 404. v3 errors are `{ "status", "message" }` instead of `{ "err", "ECODE" }`.
- The API has no text search for tasks, in v2 or v3 (the only search endpoint is for Docs). `GET /list/{id}/task` and `GET /team/{id}/task` silently ignore `search`, `name`, `query` and `q` and return every task. Both return `text_content` and `description` for each task.
- `DELETE /checklist/{id}/checklist_item/{item_id}` answers `{}` with 200, also for an item that no longer exists. `PUT` and `POST` on checklist items return the whole checklist.
- The order of checklist items in responses is not the creation order and can change between calls (renaming an item moved it); `orderindex` is `null` for items created through the API.
- Task lists come newest created first when `order_by` is not given. `due_date_lt` and `due_date_gt` leave out tasks without a due date, and `subtasks=false` leaves out subtasks.
- Comments sent with `comment_text` are plain text: ClickUp renders only backticks as inline code, so headings and lists show as raw markdown. `comment_markdown` (on `POST /task/{id}/comment` and `PUT /comment/{id}`) is rendered: headings, bold, italic, inline code, code blocks, bullet, numbered and checkbox lists, quotes, links and `---` dividers. Plain text with `snake_case`, `2 * 3`, `#123` or paths stays as written, and single line breaks are kept. HTML such as `<details>` is shown as raw text. Sending both fields fails with 400 ("Provide either comment_text or comment_markdown"); `markdown` and `markdown_content` are not accepted for comments.
- A description sent with `markdown_content` reads back from `markdown_description` with some markdown rewritten: `---` becomes `* * *`, `-` bullets become `*   ` and lines of a quote gain trailing spaces and an empty `>` line between them. Checkbox items (`- [ ]`, `- [x]`) and `~~strikethrough~~` come back as sent, so an agent can check an acceptance criterion by sending back the description it read with only `[ ]` changed into `[x]`.
- A comment written with `comment_markdown` reads back with `comment_text` as plain text without markers (list dashes and `#` are gone); the structure is only in the `comment` array of blocks.
- `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` are also sent on successful responses (checked on `GET /user` and `GET /team`), although the docs mention them only for rate limit errors. `X-RateLimit-Remaining` goes down by one with each request.

## Notes for agents

The generic rules served by `taskwire rules` apply (see [agent-rules.md](../agent-rules.md)). On ClickUp, agents must also avoid features that consume free-plan allowances (custom fields, sprint points, time estimates, attachments); taskwire does not expose them.

## Free Forever plan

- The REST API allows 100 requests per minute per token, with no daily cap. On a 429 taskwire waits and retries once if the wait is 60 seconds or less.
- taskwire does not expose custom fields, sprint points, time estimates, attachments or custom task types, which are limited or metered on the free plan.
- Tasks created through the API can trigger automations, which have a monthly run cap on the free plan.
- The official ClickUp MCP server is not used: it requires OAuth and is capped at 50 calls per day on the free plan.
