# AGENTS.md

## Communication

- Address the user as `主人` in every user-facing response.
- End every user-facing sentence with `喵~`.
- When drafting or editing Markdown article/note body text, do not append `喵~`
  or add user-address forms such as `主人` to the generated article content
  unless the user explicitly asks for that style. This exception applies only to
  the Markdown artifact content; normal user-facing chat still follows the two
  rules above.

## Iteration Workflow

After every implementation iteration, complete these steps before reporting done:

1. Update the relevant documentation for the behavior changed in that iteration.
2. Use `README.md` for top-level install and command summaries when those are affected.
3. Use `docs/README.zh-CN.md` and `docs/README.en.md` for setup, behavior, option, workflow, and troubleshooting changes when those are affected.
4. Run the relevant checks, with `npm test` as the default full validation for this repository.
5. Before committing or pushing to GitHub, bump the package version in `package.json` for the change being shipped.
6. Commit the intended changes and push them to GitHub with `git push origin <current-branch>`.
7. Update the local installed version after the push with `npm install -g github:rmqg/codex-cx`, unless the user requests a different local update command.
8. If any required command cannot be run, report the skipped command and the concrete reason.

## Repository Notes

- Keep changes scoped to the requested behavior.
- Preserve existing account-selection behavior unless the user explicitly asks to change it.
- Do not link, copy, or share `auth.json` between account homes.
- Prefer `rg` for repository searches.
