# codex-cx

`codex-cx` provides small account-switching wrappers for the OpenAI Codex CLI. It is designed for local setups where several Codex accounts are stored in separate `CODEX_HOME` directories.

## Commands

```sh
cx [codex args...]
cx exec "prompt"
cx auto [codex args...]
cx --account 2 [codex args...]
cx status
cx --dry-run [codex args...]
cx --no-bypass [codex args...]

cxa [codex args...]
cxr [extra resume args...]
```

`cxa` expands to:

```sh
cx auto "$@"
```

`cxr` expands to:

```sh
cx resume --last "$@"
```

`cx --account 2 ...` is the explicit-account path. It uses only that account and does not probe usage, sort accounts, or auto-switch. Without an explicit account, `cx` uses the same auto-switching path as `cxa`.

## Installation

Install directly from GitHub:

```sh
npm install -g github:rmqg/codex-cx
```

For local development:

```sh
git clone https://github.com/rmqg/codex-cx.git
cd codex-cx
npm link
```

## Account Layout

By default, `cx` probes three Codex homes:

```text
~/.codex-account1
~/.codex-account2
~/.codex-account3
```

Each account home should contain a valid Codex login, including `auth.json`.

```sh
CODEX_HOME=~/.codex-account1 codex login
CODEX_HOME=~/.codex-account2 codex login
CODEX_HOME=~/.codex-account3 codex login
```

## Selection Policy

Automatic mode first skips exhausted or unavailable accounts. An account is treated as unavailable when probing fails, no limit data is available, Codex reports a reached limit, 5h usage is at least 100%, or weekly usage is at least 100%.

Remaining accounts are sorted with this policy:

- If weekly usage differs by more than 5 percentage points, choose the account with lower weekly usage.
- If weekly usage is within 5 percentage points, compare 5h usage.
- If 5h usage differs by more than 20 percentage points, choose the account with lower 5h usage.
- If 5h usage is within 20 percentage points, prefer an inactive account.
- If still tied, use lower 5h usage, then lower weekly usage, then account name.

This keeps weekly usage roughly balanced while still respecting the shorter 5h limit and avoiding piling work onto an already active account when the usage numbers are close.

## Auto-Switching

`cx` without `--account`, `cxa`, and `cxr` run through automatic mode. During a run, `cx` watches the Codex TUI log for usage-limit errors. If a usage limit is detected, `cx` terminates the current Codex process, marks that account exhausted for the current wrapper run, and starts Codex again with:

```sh
codex resume --last
```

If every candidate account is exhausted or unavailable, `cx` prints the account status and exits with an error instead of launching Codex.

Session resume works best when the account homes share or link their Codex session directories.

## Status Output

```sh
cx status
```

The status table shows each account's active state, 5h usage, weekly usage, reached-limit reason, and home directory. `active` is detected from running Codex processes on Linux by reading `/proc`.

## Environment

```text
CX_ACCOUNT=1|2|3|account1|account2|account3
CX_NO_BYPASS=1
CX_LIMIT_TIMEOUT_MS=15000
CX_AUTO_MAX_SWITCHES=5
```

`CX_ACCOUNT` behaves like `--account`: it disables probing, sorting, and auto-switching and uses only the selected account.

By default, `cx` adds `--dangerously-bypass-approvals-and-sandbox` unless a sandbox or approval option is already present. Use `--no-bypass` or `CX_NO_BYPASS=1` to disable that default.

## Requirements

- Node.js 18 or newer
- OpenAI Codex CLI available as `codex`
- Linux is recommended for active-account detection

On platforms without `/proc`, account selection still works, but `cx status` may not show active accounts.

## License

GPL-3.0-only. See [LICENSE](../LICENSE).
