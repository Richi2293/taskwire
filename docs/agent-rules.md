# Agent rules

Paste the block below into the `AGENTS.md` of every project that uses taskwire, so every AI agent working on it follows the same rules. If the project also has a `CLAUDE.md`, make it reference `AGENTS.md`.

The rules do not depend on the task system. Provider-specific notes, if any, are in the provider's page under [providers](providers/).

````markdown
## Project tasks (taskwire)

This project's tasks live in an external task system, managed through the `taskwire` CLI. taskwire only touches the part of that system set in `.taskwire.json` (see its `provider` field). Output is JSON; run `taskwire --help` for every command.

- Before starting a piece of work, look for a related task: `taskwire tasks --search <words>` (add `--status`, `--tag` or `--list` to narrow it) and `taskwire task get <id>` (add `--comments 0` when the comments are not needed).
- Before creating or editing tasks, comments or checklists, run `taskwire conventions` and follow it: `language` is the language to write in, `instructions` are the project's writing rules. Existing tasks keep their text unless the user asks to rewrite them.
- You may, without asking: create tasks and subtasks, move a task's status as the work progresses, add comments describing what was done (commits, PR, files touched), add checklists or dependencies, and add, rename or check checklist items.
- Edit an existing comment (`taskwire comment update`) only when the user asks, for example to align it with the conventions, and change only the comments that need it.
- Delete a task or remove a checklist item only when the user explicitly asks. Otherwise move the task to a closed status, or check the item. `taskwire task delete` and `taskwire checklist remove-item` require `--yes`.
- Write long descriptions or comments to a temporary file and pass it with `--description-file` or `--file`, instead of quoting them inline.
- Never put secrets, tokens, passwords or end-customer personal data in tasks or comments.
- At the end of the session, tell the user what changed in the task system, with the task links.
- Exit codes: 1 task system or network error (retry later), 2 wrong command usage (fix the command), 3 configuration problem (ask the user).
- A `warning` line on stderr means the command worked but was slowed down or returned partial results: follow its hint.

### Writing tasks and comments

Descriptions and comments are markdown. Each one has a short part for people, then the details for agents.

- The part for people comes first, as a quote of at most 3 lines, one fact per line, each opening with a bold label. In a comment: **Done**, **Status**, **Next**. In a description: **Goal**, **Why**. Translate the labels into the project language.
- Then a `---` divider and a `### Details` section with everything an agent needs later: branch, commits, files, decisions and their reasons, checks run, open points, useful commands.
- A description states what the task must achieve and why, then the context and the acceptance criteria as a checklist (`- [ ]`). Keep it stable: progress goes in comments, not in the description.
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
````

The writing rules follow plain language and web readability guidance: the [inverted pyramid](https://www.nngroup.com/articles/inverted-pyramid/) and [concise, scannable text](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/) (Nielsen Norman Group), the [GOV.UK style guide](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/) (sentences over 25 words, bullets, numbered steps) and the [Federal Plain Language Guidelines](https://wid.org/wp-content/uploads/2022/03/FederalPLGuidelines.pdf) (short sentences, active voice).
