# ClickUp

taskwire talks to the ClickUp REST API v2 with a personal token. Moving a task to another list uses the API v3, the only one that supports it.

## Token

In ClickUp: avatar > Settings > Apps > API Token. Store it as described in the README, then run `taskwire whoami`.

## How a project maps to ClickUp

One project is one ClickUp folder. taskwire reads and writes only the lists and tasks inside that folder, and checks it before every write.

```
cd path/to/project
taskwire folders                           # every folder with its space and workspace
taskwire init --folder <id> [--list <id>]  # --list sets defaultListId
taskwire lists                             # lists of the folder and their statuses
```

| Field | Meaning |
|---|---|
| `workspaceId` | the ClickUp workspace that contains the folder, found and saved by `init` (optional: when missing, taskwire looks it up on every `taskwire tasks` without `--list`) |
| `folderId` | the ClickUp folder of the project (required) |
| `defaultListId` | list used by `task create` when `--list` is missing (optional) |

## Behavior notes

- Statuses are matched case-insensitively against the target list and sent with the list's exact name.
- `taskwire tasks --status` with no result checks that the status exists in the project's lists, so a typo is an error instead of an empty list.
- Priorities map to ClickUp's `urgent=1`, `high=2`, `normal=3`, `low=4`.
- Descriptions are sent as markdown.
- Task ids copied from the UI with a leading `#` are accepted.
- `taskwire task get` reads up to 500 comments (20 pages of 25) and warns when older ones are left out. `--comments <n>` reads only the pages needed for the n most recent comments (one request per 25), and `--comments 0` makes no comment request. `taskwire tasks` reads up to 5000 tasks and warns the same way.
- `taskwire comment update` looks for the comment among the ones `task get` reads, so replies in a thread and comments older than the 500 most recent cannot be edited. The update sends the current `resolved` and `assignee` (required by `PUT /comment/{id}`) unchanged, and omits `assignee` when the comment has none. The new text is plain text, so rich formatting of the old comment is lost.
- Accounts with several workspaces are supported: `init` saves the workspace of the folder, so `taskwire tasks` reads the right one.
- `taskwire tasks --search` filters the tasks after reading them, on the name and `text_content` (the plain text of the description), because the API has no text search (see below).
- Checklist items are found through the task given with `--task`, so an item or checklist of another task is refused before any write.
- Lists can be created (`taskwire list create`) but not deleted; archive them in the ClickUp UI.
- `task update --list` moves only top-level tasks, and their subtasks follow. With `--status`, the status is matched against the target list and set after the move.
- `task update --parent` accepts a parent in another list of the project: the subtask moves to the parent's list. `--parent none` is refused, because the API cannot detach a subtask (see below); do it in the ClickUp UI.

## Real API behavior

Facts checked against the live API:

- Subtasks nested in `GET /task/{id}` have no `list`, `folder` or `priority`; taskwire fills them from the parent.
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
- `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` are also sent on successful responses (checked on `GET /user` and `GET /team`), although the docs mention them only for rate limit errors. `X-RateLimit-Remaining` goes down by one with each request.

## Notes for agents

The generic rules in [agent-rules.md](../agent-rules.md) apply. On ClickUp, agents must also avoid features that consume free-plan allowances (custom fields, sprint points, time estimates, attachments); taskwire does not expose them.

## Free Forever plan

- The REST API allows 100 requests per minute per token, with no daily cap. On a 429 taskwire waits and retries once if the wait is 60 seconds or less.
- taskwire does not expose custom fields, sprint points, time estimates, attachments or custom task types, which are limited or metered on the free plan.
- Tasks created through the API can trigger automations, which have a monthly run cap on the free plan.
- The official ClickUp MCP server is not used: it requires OAuth and is capped at 50 calls per day on the free plan.
