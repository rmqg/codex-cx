# codex-multi-account Beginner Guide

This tool helps you use multiple Codex accounts on one machine.

You still use the official Codex CLI. `codex-multi-account` only adds a local account layer:

- It creates one `CODEX_HOME` folder per account.
- It selects a usable account before launching Codex.
- When one account hits usage limits, it tries to switch to another account and continue the same task.

It is not a model proxy. It does not forward model traffic. It does not share your `auth.json` login files.

## When To Use It

Use it if:

- You have multiple ChatGPT/Codex accounts.
- You want those accounts to share conversation sessions.
- You want official Codex CLI behavior, not a relay/proxy workflow.
- You often hit usage limits and want smoother account handoff.

You probably do not need it if:

- You only use one account.
- You only need one OpenAI API key and do not need account switching.

## Before Installing

Check that Node.js and Codex are installed:

```sh
node --version
codex --version
```

Requirements:

- Node.js 18 or newer.
- The official OpenAI Codex CLI, with `codex --version` working.

## Install

```sh
npm install -g github:rmqg/codex-multi-account
```

Update with the same command:

```sh
npm install -g github:rmqg/codex-multi-account
```

Confirm the commands are available:

```sh
cx --help
cx-setup --help
```

## First Setup

If you have 3 accounts, create 3 account folders:

```sh
cx-setup --accounts 3 --migrate
```

This creates:

```text
~/.codex-account1
~/.codex-account2
~/.codex-account3
```

Log in once for each account:

```sh
CODEX_HOME="$HOME/.codex-account1" codex login
CODEX_HOME="$HOME/.codex-account2" codex login
CODEX_HOME="$HOME/.codex-account3" codex login
```

Check status:

```sh
cx status
```

Check remaining quota:

```sh
cx quota
```

`cx quota` prints a total first, then one block per account, with colored ASCII bars and reset times for 5h and weekly remaining quota.
The total is not a simple average; when Codex reports each window capacity, cx weights the remaining quota by that capacity, which fits mixed account types with different limits.
If a window has no capacity field, cx counts it as one equal-weight unit and marks the Total title with fallback.
If Codex does not report a reset time, that window shows `reset unknown`.

## Daily Use

Start Codex with automatic account selection:

```sh
cxa
```

After one task starts, model, profile, and reasoning effort stay with that task instead of changing to the next account's defaults.
If you use `/fast` or `/slow` during the task, automatic handoff reads the latest effort from the interrupted session and continues with it.

Run a one-shot task:

```sh
cx exec "explain this repo"
```

Resume the last conversation:

```sh
cxr
```

Force one account:

```sh
cx --account 1
cx --account account2
```

Show account status:

```sh
cx status
```

Show remaining quota:

```sh
cx quota
cx limits
cx remaining
```

These three quota commands are equivalent.

## Command Cheat Sheet

```sh
cx [codex args...]              # Run Codex with automatic account selection
cxa [codex args...]             # Auto mode, same as cx auto
cxr [extra resume args...]      # Resume the last conversation
cx status                       # Show account status and used quota
cx quota                        # Show weighted total, reset times, and per-account bars
cx --account 2                  # Use only account 2
cx --no-trust                   # Do not write project trust automatically
cx --no-bypass                  # Do not add the bypass flag automatically
cx-setup --accounts 3 --migrate # Create 3 account folders
cx-setup --list                 # List account folders
```

## What Auto Trust Means

Codex may ask this when entering a project for the first time:

```text
Do you trust the contents of this directory?
```

With multiple accounts, seeing that prompt for every account is annoying.

By default, `cx` writes the current project to the selected account's:

```text
CODEX_HOME/config.toml
```

The entry looks like this:

```toml
[projects."/some/path"]
trust_level = "trusted"
```

This helps account switching continue without a trust prompt.

To keep Codex's original trust prompt:

```sh
cx --no-trust
CX_NO_TRUST=1 cxa
```

## Make Plain codex Auto Trust Too

If you sometimes run `codex` directly instead of `cx` or `cxa`, install the PATH wrapper:

```sh
cx-setup --install-codex-wrapper --force
```

Confirm it is first in PATH:

```sh
command -v codex
```

Expected output:

```text
~/.local/bin/codex
```

If your old shell cached the previous path, run:

```sh
rehash
```

Or open a new terminal.

## What Gets Shared

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

Important points:

- Session history is shared, so switching accounts can continue more easily.
- `auth.json` is not shared.
- Every account keeps its own login.

If you also want logs, goals, state, and memories sqlite files shared:

```sh
cx-setup --accounts 3 --full --migrate
```

`--full` is more aggressive. Avoid running multiple Codex instances that write state at the same time unless you accept the risk.

## API Key Account

You can add an API key account as a fallback.

Prefer reading the key from an environment variable:

```sh
OPENAI_API_KEY=sk-... cx-setup --add-api-key free --api-key-env OPENAI_API_KEY --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
```

Or read it from stdin so it is not stored in shell history:

```sh
printf '%s' "$OPENAI_API_KEY" | cx-setup --add-api-key free --api-key-stdin --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
```

Default selection policy:

- Use normal ChatGPT/Codex accounts first.
- Use API key accounts after those accounts fail, are unavailable, or hit limits.

To prefer API key accounts:

```sh
CX_API_KEY_MODE=prefer cxa
cx-setup --api-key-mode prefer
```

The local API key mode is stored in `~/.config/codex-cx/config.json`. The directory keeps the old name for compatibility with existing installs.

## Add Accounts

If you had 3 accounts and now want 4:

```sh
cx-setup --accounts 4 --migrate
CODEX_HOME="$HOME/.codex-account4" codex login
```

## Remove Accounts

Remove account `free`:

```sh
cx-setup --remove free
```

Remove account 3:

```sh
cx-setup --remove 3
```

Removal does not delete data. It moves the account folder to a `.cx-backup-*` backup path.

## Custom Account Folders

If you do not want numbered folders:

```sh
cx-setup --homes work=~/.codex-work,school=~/.codex-school --migrate
```

Use them like this:

```sh
cx --account work
CX_ACCOUNT_HOMES=work=~/.codex-work,school=~/.codex-school cxa
```

## Environment Variables

Common variables:

```text
CX_ACCOUNT=1
CX_ACCOUNT_COUNT=3
CX_ACCOUNT_HOMES=work=/path/a,school=/path/b
CX_API_KEY_MODE=prefer
CX_NO_BYPASS=1
CX_NO_TRUST=1
CX_COLOR=1
NO_COLOR=1
```

Meaning:

- `CX_ACCOUNT=1`: always use account 1.
- `CX_ACCOUNT_COUNT=3`: only probe accounts 1 through 3.
- `CX_API_KEY_MODE=prefer`: prefer API key accounts.
- `CX_NO_BYPASS=1`: do not add the bypass flag automatically.
- `CX_NO_TRUST=1`: do not write project trust automatically.
- `CX_COLOR=1`: force colored quota bars.
- `CX_COLOR=0` or `NO_COLOR=1`: disable color.

Advanced variables:

```text
CODEX_TRUST_ALL=0
CX_REAL_CODEX=/path/to/codex
CX_AUTO_RESUME_GOAL=0
CX_LIMIT_TIMEOUT_MS=15000
CX_LIMIT_RETRIES=2
CX_AUTO_MAX_SWITCHES=5
CX_INTERACTIVE_AUTO_EXEC=1
```

## How Auto-Switch Continues Work

When the current account hits a usage limit, `cx` tries to:

1. Stop the current Codex process.
2. Mark that account unavailable for this wrapper run.
3. Pick another usable account.
4. Resume the exact interrupted session first.
5. Send a continuation prompt so the next account continues the unfinished work.

Common retry shapes:

```sh
codex resume <interrupted-session-id> "Continue the interrupted task ..."
codex exec resume <interrupted-session-id> "Continue the interrupted task ..."
```

If no exact session id is found, `cx` uses a safer fallback and avoids treating `Continue ...` as a session id.

## Troubleshooting

`No Codex account homes found`

Create account folders first:

```sh
cx-setup --accounts 3 --migrate
```

`missing ~/.codex-accountN/auth.json`

That account is not logged in:

```sh
CODEX_HOME="$HOME/.codex-accountN" codex login
```

`All candidate accounts are exhausted or unavailable`

All accounts are unavailable, not logged in, failed probing, or hit limits. Check:

```sh
cx status
cx quota
```

Auto-switch still shows the trust prompt

Confirm this is not set:

```sh
CX_NO_TRUST=1
```

You can also reinstall the direct `codex` wrapper:

```sh
cx-setup --install-codex-wrapper --force
```

`cx status` does not show active accounts

Active detection uses Linux `/proc`, so it may be inaccurate outside Linux.

API key checking fails

Check that `--openai-base-url` points to the correct API root. It usually ends in `/v1`.

## License

GPL-3.0-only. See [LICENSE](../LICENSE).
