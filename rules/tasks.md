# Task management rules

This project's tasks live in an external task system, managed through the `taskwire` CLI. taskwire only touches the part of that system set in `.taskwire.json` (see its `provider` field). Output is JSON; run `taskwire --help` for every command.

These rules cover only task management. The project conventions that come with them (`language`, `instructions`) are added on top and win when they conflict.

- Before starting a piece of work, look for a related task: `taskwire tasks --search <words>` (add `--status`, `--tag` or `--list` to narrow it) and `taskwire task get <id>` (add `--comments 0` when the comments are not needed).
- Write tasks, comments and checklists in the project `language`, following its `instructions`. Existing tasks keep their text unless the user asks to rewrite them.
- Keep each task self-contained: a person or an agent must be able to do the work reading only the task, without opening issues, pull requests, git history or other docs. When a task comes from an issue, copy into it what is needed to work, not only a summary.
- Use only the statuses of the task's list (`taskwire lists`). Move a task to a closed status only when the work is done and verified; otherwise leave it open and say in a comment what is missing. Before moving a task to a closed status, check every verified acceptance criterion. If the user asks to close it anyway, leave the unverified criteria unchecked and list them in the closing comment.
- Reuse the tags already used in the project: `taskwire tags` lists them, most used first. Create a new tag only when the user asks.
- You may, without asking: create tasks and subtasks, move a task's status as the work progresses, add comments describing what was done (commits, PR, files touched), add checklists or dependencies, add, rename or check checklist items, and check an acceptance criterion in the description (`- [x]`) once it is verified.
- Assign to the user (`me`, the owner of the token) every task and subtask you create (`--assignee me`), and a task you start working on when it has no assignee (`taskwire task update <id> --add-assignee me`). Do not change the assignees of a task that already has some, unless the user asks.
- When you start the work a task asks for, move it to the status of its list that means work in progress (for example `in progress`), together with the assignment: `taskwire task update <id> --status "in progress" --add-assignee me`. Reading or analysing a task at the user's request is not starting the work. If the list has no such status, leave the status as it is. Never move a task back from a later status, such as a review status. The project `instructions` may name the status to use.
- Edit an existing comment (`taskwire comment update`) only when the user asks, for example to align it with the conventions, and change only the comments that need it. The one exception is a small update to the last comment of the task, when you wrote it in this session (see below).
- Delete a task or remove a checklist item only when the user explicitly asks. Otherwise move the task to a closed status, or check the item. `taskwire task delete` and `taskwire checklist remove-item` require `--yes`.
- Write long descriptions or comments to a temporary file and pass it with `--description-file` or `--file`, instead of quoting them inline.
- Never put secrets, tokens, passwords or end-customer personal data in tasks or comments.
- At the end of the session, tell the user what changed in the task system, with the task links.
- Exit codes: 1 task system or network error (retry later), 2 wrong command usage (fix the command), 3 configuration problem (ask the user).
- A `warning` line on stderr means the command worked but was slowed down or returned partial results: follow its hint.

## Writing tasks and comments

Descriptions and comments are markdown. Each one has a short part for people, then the details for agents.

- The part for people comes first, as a quote of at most 3 lines, one fact per line, each opening with a bold label. In a comment: **Done**, **Status**, **Next**. In a description: **Goal**, **Why**. Use only the labels that apply (no **Next** when the work is finished).
- In a comment, the quote is followed by a `---` divider and a `### Details` section with everything an agent needs later: branch, commits, files, decisions and their reasons, checks run (where and how the change was verified: environment, device, build or version), open points, useful commands.
- In a description, the quote is followed by a `---` divider, a `### Context` section, a `### Steps` numbered list when the work needs concrete steps (file paths, commands, values), and a `### Acceptance criteria` checklist (`- [ ]`), then useful links if any. A description has no `Details` section.
- Translate the labels and the headings into the project language.
- Task names are short and specific, under 80 characters, and start with a verb in the form usual in the project language. For a bug, describe the wrong behaviour instead ("The PDF stays blank on Android").
- Keep code identifiers, file names and commands as they are, in backticks, whatever the project language.
- A small update with nothing for agents (for example a status change) needs only the quote, even a single line. If the last comment of the task is yours from this session and stays short, update it instead of adding a new one.
- Update the description when the goal or the context changes, so it always tells what must be done now. Progress (what was done, checks, results) goes in comments, never in the description.
- Checking an acceptance criterion is not progress: it keeps the description true. Read the description with `taskwire task get` right before, change only `[ ]` into `[x]` and send the rest back as it was. A criterion the user decides to skip stays unchecked, struck through with the reason: `- [ ] ~~Export to PDF~~ (skipped: not needed for now)`.
- Write for a person who skims:
  - start with the outcome, not with how you got there;
  - put the key word at the start of each line and bullet;
  - keep sentences under 20 words, and split any sentence over 25;
  - one idea per line or bullet, with a line break where a new idea starts and a blank line between blocks;
  - use plain words and the active voice; keep ids, paths and hashes out of the part for people unless they are the point;
  - write dates as absolute dates, never "tomorrow" or "next week".
- Lists: a lead-in line, one sentence per bullet, at most 7 bullets. Use a numbered list for steps in order.
- No collapsible sections: HTML such as `<details>` is shown as raw text.

Example of a comment:

```
> **Done:** text search added to the task list.
> **Status:** PR #10 open, all tests pass.
> **Next:** merge, then the task moves to complete.

---

### Details

- **Branch:** `feat/task-search`, commit `d544fcb`
- **Decision:** search on the client side, because the API has none
- **Checks:** 144 tests, end-to-end run in a sandbox list
```
