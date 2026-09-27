# taskwire-orchestrator (experimental)

Lets AI agents work on the tasks of your projects on their own, through taskwire, and leaves you only the decisions, the reviews and the checks a machine cannot make.

It is at an early stage and not published: run it from a clone of this repository. It follows only the projects you add, and talks to taskwire through its CLI, like any agent, so every taskwire check applies to it too.

## Commands

```
orchestrator/bin/taskwire-orchestrator add <folder> [--test-command <command>]
orchestrator/bin/taskwire-orchestrator list
orchestrator/bin/taskwire-orchestrator next
```

- `add` follows a project already set up with taskwire (it has a `.taskwire.json`). `--test-command` is the command that runs the project tests, from the project folder.
- `list` shows the projects it follows.
- `next` shows, for each project, the task an agent would work on next. It changes nothing.

## Which task comes next

A task is picked when:

- its status is one of the start statuses of the project (`backlog` and `to do` by default);
- it does not wait for a person (no `needs` mark, see `taskwire task update --needs`);
- it does not have the block tag (`no-agent` by default), which keeps agents away from a task;
- it has no open subtasks, since the work is in the subtasks.

Among those, the highest priority comes first, then the oldest task.

## Configuration

The config lives in `~/.config/taskwire-orchestrator/config.json` (set `TASKWIRE_ORCHESTRATOR_HOME` to use another folder). `add` writes it; you can also edit it by hand.

```json
{
  "taskwireCommand": "/path/to/taskwire/bin/taskwire",
  "projects": [
    { "path": "/Users/jane/code/website", "testCommand": "npm test", "startStatuses": ["to do"], "blockTag": "manual" }
  ]
}
```

| Field | Meaning |
|---|---|
| `taskwireCommand` | the taskwire command to run; defaults to `taskwire` on the PATH. Point it to a clone to try an unreleased taskwire |
| `projects[].path` | absolute path of the project folder |
| `projects[].testCommand` | command that runs the project tests |
| `projects[].startStatuses` | statuses tasks are picked from |
| `projects[].blockTag` | tag that keeps agents away from a task |

## Development

Same rules as taskwire (see [AGENTS.md](../AGENTS.md)): Node 24.7 or later, TypeScript run directly, no dependencies, `node --test` from the repository root runs these tests too.
