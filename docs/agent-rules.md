# Agent rules

Paste the block below into the `AGENTS.md` of every project that uses taskwire, so every AI agent working on it follows the same rules. If the project also has a `CLAUDE.md`, make it reference `AGENTS.md`.

The rules do not depend on the task system. Provider-specific notes, if any, are in the provider's page under [providers](providers/).

```markdown
## Project tasks (taskwire)

This project's tasks live in an external task system, managed through the `taskwire` CLI. taskwire only touches the part of that system set in `.taskwire.json` (see its `provider` field). Output is JSON; run `taskwire --help` for every command.

- Before starting a piece of work, look for a related task: `taskwire tasks --search <words>` (add `--status`, `--tag` or `--list` to narrow it) and `taskwire task get <id>` (add `--comments 0` when the comments are not needed).
- Before creating or editing tasks, comments or checklists, run `taskwire conventions` and follow it: `language` is the language to write in, `instructions` are the project's writing rules. Existing tasks keep their text unless the user asks to rewrite them.
- You may, without asking: create tasks and subtasks, move a task's status as the work progresses, add comments describing what was done (commits, PR, files touched), and add checklists or dependencies.
- Edit an existing comment (`taskwire comment update`) only when the user asks, for example to align it with the conventions, and change only the comments that need it.
- Delete a task only when the user explicitly asks. Otherwise move it to a closed status. `taskwire task delete` requires `--yes`.
- Write long descriptions or comments to a temporary file and pass it with `--description-file` or `--file`, instead of quoting them inline.
- Never put secrets, tokens, passwords or end-customer personal data in tasks or comments.
- At the end of the session, tell the user what changed in the task system, with the task links.
- Exit codes: 1 task system or network error (retry later), 2 wrong command usage (fix the command), 3 configuration problem (ask the user).
- A `warning` line on stderr means the command worked but was slowed down or returned partial results: follow its hint.
```
