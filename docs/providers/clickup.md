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
| `folderId` | the ClickUp folder of the project (required) |
| `defaultListId` | list used by `task create` when `--list` is missing (optional) |

## Behavior notes

- Statuses are matched case-insensitively against the target list and sent with the list's exact name.
- Priorities map to ClickUp's `urgent=1`, `high=2`, `normal=3`, `low=4`.
- Descriptions are sent as markdown.
- Task ids copied from the UI with a leading `#` are accepted.
- `taskwire tasks` without `--list` needs exactly one workspace; with more, pass `--list`.
- Lists can be created (`taskwire list create`) but not deleted; archive them in the ClickUp UI.

## Free Forever plan

- The REST API allows 100 requests per minute per token, with no daily cap. On a 429 taskwire waits and retries once if the wait is 60 seconds or less.
- taskwire does not expose custom fields, sprint points, time estimates, attachments or custom task types, which are limited or metered on the free plan.
- Tasks created through the API can trigger automations, which have a monthly run cap on the free plan.
- The official ClickUp MCP server is not used: it requires OAuth and is capped at 50 calls per day on the free plan.
