taskwire knows no group for this project yet, so it knows only the `{area}` area, and `--no-area` and `taskwire area add` do not work. When the user tells you which projects share the task list, record them yourself:

1. `taskwire group init <name> --description <text>` here, with a short name for the group and the description of this project's area.
2. `taskwire area add <area> --path <dir> --description <text>` for each other repository, with the area its `.taskwire.json` uses.
3. `taskwire area add <area> --description <text>` for each kind of work without code, such as `infra` or `feedback`.

Until then, use `--area <tag>` only with the tags the project already uses (`taskwire tags`).
