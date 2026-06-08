# codex-multi-account

Use multiple Codex accounts locally without changing how the official Codex CLI works.

The installed commands are still short:

```sh
cx        # run Codex with automatic account selection
cxa       # same idea, explicit auto mode
cxr       # resume the last conversation
cx-setup  # create account folders and shared state
```

## Install

```sh
npm install -g github:rmqg/codex-multi-account
```

Update with the same command.

## First Setup

Create account folders. Replace `3` with your account count.

```sh
cx-setup --accounts 3 --migrate
```

Log in once per account:

```sh
CODEX_HOME="$HOME/.codex-account1" codex login
CODEX_HOME="$HOME/.codex-account2" codex login
CODEX_HOME="$HOME/.codex-account3" codex login
```

Check everything:

```sh
cx status
cx quota
```

`cx quota` shows a weighted total first, then 5h and weekly bars plus reset times for each account.
When Codex does not report a capacity for a quota window, that window is counted as one equal-weight unit and the total label says so.
Quota probes use a 30s timeout, 3 attempts, and a 1500ms retry delay by default; tune `CX_LIMIT_TIMEOUT_MS`, `CX_LIMIT_RETRIES`, and `CX_LIMIT_RETRY_DELAY_MS` if your network is unstable.

During one auto-switched task, model/profile/reasoning defaults stay with the task.
If you use `/fast` during the task, the retry keeps that faster task state when switching accounts.

Run Codex:

```sh
cxa
cx exec "explain this repo"
cxr
```

## Optional

Install the direct `codex` wrapper so plain `codex` also auto-trusts the current project:

```sh
cx-setup --install-codex-wrapper --force
```

## Docs

- [English guide](docs/README.en.md)
- [中文教程](docs/README.zh-CN.md)

License: GPL-3.0-only.
