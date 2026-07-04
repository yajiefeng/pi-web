# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `yajiefeng/pi-web`. Use the `gh` CLI for all operations.

Always pass `--repo yajiefeng/pi-web` unless the user explicitly asks to use another repo.

## Conventions

- **Create an issue**: `gh issue create --repo yajiefeng/pi-web --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view --repo yajiefeng/pi-web <number> --comments`, filtering comments by `jq` and also fetching labels when needed.
- **List issues**: `gh issue list --repo yajiefeng/pi-web --state open --json number,title,body,labels,comments` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment --repo yajiefeng/pi-web <number> --body "..."`.
- **Apply / remove labels**: `gh issue edit --repo yajiefeng/pi-web <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close --repo yajiefeng/pi-web <number> --comment "..."`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `yajiefeng/pi-web`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view --repo yajiefeng/pi-web <number> --comments`.
