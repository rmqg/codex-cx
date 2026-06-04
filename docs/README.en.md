# codex-cx

`codex-cx` provides account-switching wrappers for the OpenAI Codex CLI. It is meant for local setups where each ChatGPT/Codex account has its own `CODEX_HOME`, while conversation sessions and other workspace state can be shared.

## Quick Start

1. Install Node.js 18 or newer.
2. Install the OpenAI Codex CLI and confirm `codex --version` works.
3. Install `codex-cx`:

```sh
npm install -g github:rmqg/codex-cx
```

To update an existing global install, run the same command again:

```sh
npm install -g github:rmqg/codex-cx
```

4. Decide how many accounts you want to use; call that number `<N>`. Create account homes and shared session links:

```sh
cx-setup --accounts <N> --migrate
```

Use `--full` if you also want logs, state, goals, memories sqlite files, and generated images linked:

```sh
cx-setup --accounts <N> --full --migrate
```

5. Log in once per account:

```sh
for i in $(seq 1 <N>); do
  CODEX_HOME="$HOME/.codex-account$i" codex login
done
```

6. Verify:

```sh
cx status
cxa --dry-run
```

## Commands

```sh
cx [codex args...]
cx exec "prompt"
cx auto [codex args...]
cx --account work [codex args...]
cx status
cx --dry-run [codex args...]
cx --no-bypass [codex args...]
cx --no-trust [codex args...]

cxa [codex args...]
cxr [extra resume args...]
cx-setup [options]
```

`cxa` expands to:

```sh
cx auto "$@"
```

`cxr` expands to:

```sh
cx resume --last "$@"
```

`cx --account work ...` is the explicit-account path. It uses only that account and does not probe usage, sort accounts, or auto-switch. Without an explicit account, `cx` uses the same auto-switching path as `cxa`.

Use `--` when an argument must be passed to Codex even though it looks like a `cx` wrapper option:

```sh
cx --account work -- --dry-run exec "hello"
```

By default, `cx` injects a temporary Codex config override for the current work root: `projects."<cwd>".trust_level="trusted"`. This prevents a newly selected account from stopping at the “Do you trust the contents of this directory?” prompt during automatic switching. The override applies only to that launch and does not write to the account's `config.toml`; use `--no-trust` or `CX_NO_TRUST=1` to keep Codex's normal directory trust prompt.

## Multiple Accounts

When no account environment variable is set, `cx` auto-discovers existing account homes:

```text
~/.codex-account*
```

On a new machine, create those homes first with `cx-setup --accounts <N>`. You can also explicitly force the numbered range to probe:

```sh
CX_ACCOUNT_COUNT=<N> cx status
CX_ACCOUNT_COUNT=<N> cxa
```

For custom homes:

```sh
CX_ACCOUNT_HOMES=work=~/.codex-work,school=~/.codex-school,backup=/mnt/codex-backup cx status
```

With `CX_ACCOUNT_HOMES`, selectors can use the configured names:

```sh
CX_ACCOUNT_HOMES=work=~/.codex-work,school=~/.codex-school cx --account work
```

Use the same homes with setup when you need shared sessions for custom paths:

```sh
cx-setup --homes work=~/.codex-work,school=~/.codex-school --migrate
```

Account names and account home paths must be unique. An account home must not be the same directory as the shared home.

## Shared Workspace Setup

`cx-setup` creates account directories and links shared workspace state. It never links `auth.json`; every account keeps its own login.

Default shared items:

```text
sessions
archived_sessions
memories
skills
shell_snapshots
cache
generated_images
history.jsonl
models_cache.json
```

Full shared items add:

```text
log
goals_1.sqlite*
logs_2.sqlite*
memories_1.sqlite*
state_5.sqlite*
```

Useful setup commands:

```sh
cx-setup --accounts <N> --dry-run
cx-setup --accounts <N> --migrate
cx-setup --accounts <N> --full --migrate
cx-setup --accounts <N> --home ~/.codex-shared --prefix ~/.codex-account --full --migrate
cx-setup --homes work=~/.codex-work,school=~/.codex-school --full --migrate
```

`--migrate` copies existing account data into the shared home when the shared target does not already exist, then moves the old per-account path to a `.cx-backup-*` name before creating the symlink. SQLite files cannot be truly merged; existing per-account files are kept in backups.

`--force` moves existing paths aside without copying them first. Use it only when you know the existing data is disposable.

`cx-setup` refuses to modify account homes that are currently used by running Codex processes. Exit those sessions first. `--dry-run` is always safe. `--allow-active` bypasses the guard, but it is risky with `--full` because SQLite/state files can be open while they are moved. After `--full`, avoid running multiple Codex instances that write state at the same time unless you accept the usual shared-SQLite concurrency risk.

## Selection Policy

Automatic mode first skips exhausted or unavailable accounts. An account is unavailable when probing fails, no limit data is available, Codex reports a reached limit, 5h usage is at least 100%, or weekly usage is at least 100%. Reached primary limits, including `workspace_owner_credits_depleted`, are shown as `5h>=100%`; reached secondary limits are shown as `weekly>=100%`.

Remaining accounts are sorted with this policy:

- If weekly usage differs by more than 5 percentage points, choose the account with lower weekly usage.
- If weekly usage is within 5 percentage points, compare 5h usage.
- If 5h usage differs by more than 20 percentage points, choose the account with lower 5h usage.
- If 5h usage is within 20 percentage points, prefer an inactive account.
- If still tied, use lower 5h usage, then lower weekly usage, then account name.

## Auto-Switching

During a run, `cx` watches the Codex TUI log for usage-limit errors. It recognizes older `workspace_owner_credits_depleted`/`credits_depleted` fields, newer `Turn error: Your workspace is out of credits` text, and structured Goal-mode usage-limit logs. It ignores tool-call text or command output that merely mentions those quota words. If a real usage limit is detected, `cx` terminates the current Codex process, marks that account exhausted for the current wrapper run, and switches to another usable account.

The retry path depends on what happened before the limit:

```sh
codex resume --last
codex exec resume --last "Continue the interrupted task ..."
```

If the last turn in the current session completed normally and produced assistant output, `cx` only resumes the session. If an interactive `cx` or `cxr` turn was interrupted after a new user instruction was recorded, or Codex wrote `task_complete` for an out-of-credits turn with an empty `last_agent_message`, `cx` resumes it through `codex exec resume --last "Continue ..."` so the next account continues that pending instruction. This deliberately avoids passing a prompt to interactive `codex resume --last`, because current Codex CLI versions treat that extra positional argument as a session ID. After the resumed exec turn finishes, Codex exits; start `cxr` again if you want to keep chatting in the TUI.

For `cx exec ...`, retries use `codex exec resume --last "Continue ..."` so non-interactive sessions keep their mode and can explicitly continue the pending instruction. If the original command was `cx exec resume <session-id>`, the retry keeps that explicit session id instead of switching to `--last`.

For `cx resume ...`, `cxr`, and `cx exec resume ...`, `cx` checks the target session for a paused, usage-limited, or blocked goal before launching Codex. If one exists, it uses Codex app-server to mark the goal active, then continues with the original command; if there is no goal or the goal is complete, the existing resume behavior is unchanged.

Set `CX_INTERACTIVE_AUTO_EXEC=0` to disable the interactive-to-exec continuation behavior and reopen the TUI with plain `codex resume --last` instead.

If the limited process did not create a current session file, `cx` retries the original command on the next account instead of blindly resuming an unrelated older session.

If every candidate account is exhausted or unavailable, `cx` prints the account status and exits with an error instead of launching Codex.

Auto-resume works best after `cx-setup` links the account homes to shared session directories.

## Environment

```text
CX_ACCOUNT=1|account1|work
CX_ACCOUNT_COUNT=N
CX_ACCOUNT_HOMES=name=/path,name2=/path2
CX_NO_BYPASS=1
CX_NO_TRUST=1
CX_AUTO_RESUME_GOAL=0
CX_LIMIT_TIMEOUT_MS=15000
CX_AUTO_MAX_SWITCHES=5
CX_INTERACTIVE_AUTO_EXEC=0
```

`CX_ACCOUNT` behaves like `--account`: it disables probing, sorting, and auto-switching and uses only the selected account.

`CX_ACCOUNT_COUNT`, `CX_LIMIT_TIMEOUT_MS`, and `CX_AUTO_MAX_SWITCHES` must be positive integers.

By default, `cx` adds `--dangerously-bypass-approvals-and-sandbox` unless a sandbox or approval option is already present. Use `--no-bypass` or `CX_NO_BYPASS=1` to disable that default.

By default, `cx` trusts the work root used for the launch so account switches are not interrupted by the directory trust prompt. Use `--no-trust` or `CX_NO_TRUST=1` to disable that default.

By default, resume commands automatically reactivate paused, usage-limited, or blocked goals. Set `CX_AUTO_RESUME_GOAL=0` to disable this preflight.

By default, interrupted interactive turns continue through `codex exec resume ...` after an automatic account switch. Set `CX_INTERACTIVE_AUTO_EXEC=0` to keep the older conservative behavior, which only reopens the TUI with `codex resume --last`.

## Troubleshooting

- `No Codex account homes found`: on a new machine, run `cx-setup --accounts <N> --migrate`, or set `CX_ACCOUNT_HOMES`.
- `missing ~/.codex-accountN/auth.json`: run `CODEX_HOME=~/.codex-accountN codex login`.
- `All candidate accounts are exhausted or unavailable`: all probed accounts failed login/probing or hit a 5h/weekly limit.
- `cx status` does not show active accounts: active detection reads `/proc`, so it is Linux-focused.
- Auto-switch stops at the directory trust prompt: confirm the installed `cx` is current. Current versions inject trust for the work root by default; if `CX_NO_TRUST=1` or `--no-trust` is set, unset it or trust the directory manually.
- Auto-switch resumes the wrong conversation: run `cx-setup --migrate` or `cx-setup --full --migrate` so all account homes share `sessions`.
- Existing files block setup: rerun with `--migrate` to copy and back up, or `--force` to back up without copying.
- Setup refuses active homes: exit running Codex sessions, then rerun `cx-setup`.
- Setup reports duplicate account names/homes: fix `--homes` or `CX_ACCOUNT_HOMES` so every account has a unique name and unique `CODEX_HOME`.
- Setup reports `Account home must not be the shared home`: use separate directories, for example `~/.codex` for shared state and `~/.codex-account1` for the first account.

## License

GPL-3.0-only. See [LICENSE](../LICENSE).
