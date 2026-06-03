# codex-cx

Small account-switching wrappers for the OpenAI Codex CLI.

`cx` probes several local Codex account homes, chooses the usable account with the lowest weekly usage, and forwards the rest of the command to `codex`. `cxa` and `cxr` are convenience wrappers for common flows.

## Commands

```sh
cx [codex args...]
cx exec "prompt"
cx auto [codex args...]
cx --account 2 [codex args...]
cx status
cx --dry-run [codex args...]

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

`cx --account 2 ...` is the escape hatch: it uses only that account and does not probe usage, sort accounts, or auto-switch. Without an explicit account, `cx` uses the same auto-switching path as `cxa`.

## Install

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

By default, `cx` looks for three Codex homes:

```text
~/.codex-account1
~/.codex-account2
~/.codex-account3
```

Each account home should contain a valid Codex login, including `auth.json`. A typical setup is:

```sh
CODEX_HOME=~/.codex-account1 codex login
CODEX_HOME=~/.codex-account2 codex login
CODEX_HOME=~/.codex-account3 codex login
```

## Behavior

- `cx status` prints the detected accounts, active state, recent usage, weekly usage, and account home.
- Account selection is weekly-first, then 5h usage, then active state, then account name.
- Exhausted or unavailable accounts are skipped. If every candidate account is exhausted or unavailable, `cx` exits with an error instead of launching Codex.
- Already-running accounts stay eligible. `active` is only a tie-breaker after weekly usage and 5h usage.
- `cx auto` monitors the Codex TUI log for rate-limit errors. If a limit is detected, it terminates the current run, switches accounts, and resumes with `codex resume --last`.
- `--account 1`, `--account 2`, or `--account 3` runs only that account and disables probing, sorting, and auto-switching.
- `--dry-run` prints the `CODEX_HOME=... codex ...` command without launching Codex.

By default, `cx` adds `--dangerously-bypass-approvals-and-sandbox` unless a sandbox or approval option is already present. Use `--no-bypass` or `CX_NO_BYPASS=1` to disable that default.

## Environment

```text
CX_ACCOUNT=1|2|3|account1|account2|account3
CX_NO_BYPASS=1
CX_LIMIT_TIMEOUT_MS=15000
CX_AUTO_MAX_SWITCHES=5
```

## Requirements

- Node.js 18 or newer
- OpenAI Codex CLI available as `codex`
- Linux is recommended. Active account detection reads `/proc`; on platforms without `/proc`, account selection still works but `cx status` may not show active accounts.

## License

MIT
