## Areas of this project

This project is the `{area}` area of a task list shared by several projects. An area is a task tag: either a repository whose code the task changes, or a kind of work without code, such as servers, marketing or customer feedback.

{group}

- `taskwire tasks` shows only the tasks tagged `{area}`. Use `--area <tag>` (repeatable) for other areas, `--no-area` for the tasks with no area of the group, and `--all-areas` for every task, for example when a task the user names does not show up.
- `taskwire task create` tags new tasks `{area}`. Pick the area by what the work touches:
  - the code of this repository: `{area}`, the default;
  - the code of another repository of the group: its area, with `--area <tag>`;
  - no code (servers, DNS, deploy, marketing, analysis, feedback): the area without code whose description fits, never `{area}` only because you work here;
  - no area fits: create one (below). Use `--area none` only when the user wants a task with no area.
- Areas are the one kind of tag you may create without asking. Read `taskwire areas` first, and create an area only when no description fits: one broad lowercase word, with `taskwire area add <name> --description <text>`. If taskwire refuses it as too close to an existing area, use that area; pass `--force` only when the work is really different.
- A task that touches several areas takes one of two forms:
  - one piece of work done in one go, such as a decision, an analysis or a check: one task with each area tag (`--area` once per area);
  - code to change in several repositories: a container task with one subtask per area, each with its area tag, ordered with `taskwire dependency add` (for example the app subtask blocked by the backend one).
- Do only the part of this repository. For each other area, write or update its subtask so that it is self-contained. If your tool can start another agent in a folder, start one in the path of that area, on its subtask; otherwise leave the subtask ready and say so in your report.
- When you sort tasks, `taskwire tasks --no-area` lists the ones with no area: tag each with the area that fits (`taskwire task update <id> --add-tag <area>`).
- At the end of the session, list the areas you created or changed, with their description, so that the user can check them.
