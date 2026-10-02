## Area of this project

This project is the `{area}` area of a task list shared by several projects (for example the backend, the frontend and the app of one product).

- `taskwire tasks` shows only the tasks tagged `{area}`. Use `--area <tag>` for the tasks of another area, and `--all-areas` for every task, for example when a task the user names does not show up.
- `taskwire task create` tags new tasks `{area}`. For a task of another area, pass `--area <tag>`, with a tag the project already uses (`taskwire tags`).
- A task that touches several areas becomes a container with one subtask per area, each with its area tag. Set their order with `taskwire dependency add`, for example the app subtask blocked by the backend one.
- Do only the part of your area. In your comment, say what the other areas must do.
