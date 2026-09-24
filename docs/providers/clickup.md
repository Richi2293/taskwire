# ClickUp

taskwire talks to the ClickUp REST API v2 with a personal token.

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
- Priorities map to ClickUp's `urgent=1`, `high=2`, `normal=3`, `low=4`.
- Descriptions are sent as markdown.
- Task ids copied from the UI with a leading `#` are accepted.
- Accounts with several workspaces are supported: `init` saves the workspace of the folder, so `taskwire tasks` reads the right one.
- Lists can be created (`taskwire list create`) but not deleted; archive them in the ClickUp UI.

## Real API behavior

Facts checked against the live API:

- Subtasks nested in `GET /task/{id}` have no `list`, `folder` or `priority`; taskwire fills them from the parent.
- Date-only due dates come back at 04:00 local time. The day is the one that was sent.
- Filtering by a closed status returns closed tasks even without `--include-closed`.

## Notes for agents

The generic rules in [agent-rules.md](../agent-rules.md) apply. On ClickUp, agents must also avoid features that consume free-plan allowances (custom fields, sprint points, time estimates, attachments); taskwire does not expose them.

## Free Forever plan

- The REST API allows 100 requests per minute per token, with no daily cap. On a 429 taskwire waits and retries once if the wait is 60 seconds or less.
- taskwire does not expose custom fields, sprint points, time estimates, attachments or custom task types, which are limited or metered on the free plan.
- Tasks created through the API can trigger automations, which have a monthly run cap on the free plan.
- The official ClickUp MCP server is not used: it requires OAuth and is capped at 50 calls per day on the free plan.
