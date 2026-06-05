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

Create an OpenAI API key or OpenAI-compatible API account:

```sh
printf '%s' "$OPENAI_API_KEY" | cx-setup --add-api-key free --api-key-stdin --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
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
cx-setup --add-api-key free --api-key-env OPENAI_API_KEY --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
cx-setup --remove free
cx-setup --accounts 2 --prune --migrate
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

## API Key Accounts

`cx-setup --add-api-key <name>` creates a named API-key account. The default account home is `~/.codex-account-<name>`, so `free` becomes `~/.codex-account-free` and is discovered as `free`.

Prefer reading keys from an environment variable or stdin so the key is not left in shell history:

```sh
OPENAI_API_KEY=sk-... cx-setup --add-api-key free --api-key-env OPENAI_API_KEY --openai-base-url https://ai2.hhhl.cc/v1 --model gpt-5.5 --api-key-check --migrate

printf '%s' 'sk-...' | cx-setup --add-api-key free --api-key-stdin --openai-base-url https://ai2.hhhl.cc/v1 --model gpt-5.5 --api-key-check --migrate
```

The command writes `auth.json` under that account home:

```json
{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "sk-..."
}
```

It also writes `cli_auth_credentials_store = "file"` and `forced_login_method = "api"` to that account's `config.toml`, plus `model` and `openai_base_url` when supplied. If `auth.json` already exists, setup refuses to replace it unless you pass `--force`.

`--openai-base-url` is normalized to an http(s) URL without a trailing `/`. Add `--api-key-check` to validate the endpoint before `auth.json` is written. The default `auto` mode calls `<openai_base_url>/models` first, then calls `<openai_base_url>/responses` when `--model` is also supplied. You can also use `--api-key-check=models`, `--api-key-check=responses`, or `--api-key-check=chat` explicitly. Use `--api-key-check-timeout-ms <MS>` to change the timeout. Failed checks do not write API-key credentials.

API-key accounts do not use the ChatGPT account rate-limit probe. Auto mode treats them as usable, but their selection order is controlled by the API-key mode:

```sh
CX_API_KEY_MODE=fallback cxa
CX_API_KEY_MODE=prefer cxa
cx-setup --api-key-mode prefer
```

`fallback` is the default: use regular ChatGPT/Codex accounts first, then API-key accounts only when those accounts are unavailable, fail probing, or hit limits. `prefer` selects API-key accounts first. `cx-setup --api-key-mode <mode>` persists the local default to `~/.config/codex-cx/config.json`; `CX_API_KEY_MODE` temporarily overrides it.

## Adding And Removing Accounts

Add numbered accounts as before:

```sh
cx-setup --accounts <N> --migrate
```

When reducing `<N>`, old `.codex-account*` directories are still auto-discovered. Use `--prune` to move discovered account homes outside the target set to `.cx-backup-*` names:

```sh
cx-setup --accounts 2 --prune --migrate
```

Remove one named or numbered account:

```sh
cx-setup --remove free
cx-setup --remove account3
cx-setup --remove 3
```

Removal moves the whole account home to a backup path by default. It does not delete or share any `auth.json`. If the target home is used by a running Codex process, real runs refuse to proceed; exit that session first, or pass `--allow-active` if you accept the risk.

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
cx-setup --add-api-key free --api-key-env OPENAI_API_KEY --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
cx-setup --accounts 2 --prune --migrate
cx-setup --remove free
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

When automatic mode prints the selected account, it appends the account email when one can be read from that account's `auth.json`, for example `[cx-auto] selected account1 (name@example.com): ...`. If no email is available, or if `auth.json` is not parseable JSON, the original account-name output is preserved.

## Auto-Switching

During a run, `cx` watches the Codex TUI log for usage-limit errors. It recognizes Codex's own limit messages such as `You've hit your usage limit`, `Your workspace is out of credits`, workspace credit/spend-cap reached types, `Turn error` lines with Codex HTTP 429 responses, and structured Goal-mode usage-limit logs. It ignores tool-call text, command output, and external service throttling such as GitHub curated-plugin sync 429s. If a real usage limit is detected, `cx` terminates the current Codex process, marks that account exhausted for the current wrapper run, and switches to another usable account.

The retry path depends on what happened before the limit:

```sh
codex resume <interrupted-session-id> "Continue the interrupted task ..."
codex exec resume <interrupted-session-id> "Continue the interrupted task ..."
```

If the last turn in the current session completed normally and produced assistant output, `cx` only resumes the session. If an interactive `cx` or `cxr` turn was interrupted after a new user instruction was recorded, or Codex wrote `task_complete` for an out-of-credits turn with an empty `last_agent_message`, `cx` resumes it through `codex resume <interrupted-session-id> "Continue ..."` so the next account opens the TUI and submits a continuation prompt for that pending instruction. Even if the same turn already had earlier assistant output, an out-of-credits completion with no final `last_agent_message` is treated as unfinished. When the session file has an id, `cx` targets the exact interrupted session instead of relying on the next account's own `--last`.

If `cx` cannot find an exact session id, it does not build `codex resume --last "Continue ..."`, because Codex CLI parses that `Continue ...` text as a session id. In that case it falls back to `codex exec resume --last "Continue ..."` so the continuation prompt is actually sent.

For `cx exec ...`, retries use `codex exec resume <interrupted-session-id> "Continue ..."` so non-interactive sessions keep their mode and can explicitly continue the pending instruction. If the original command was `cx exec resume <session-id>`, the retry keeps that explicit session id instead of switching to `--last`.

For `cx resume ...`, `cxr`, and `cx exec resume ...`, `cx` checks the target session for a paused, usage-limited, or blocked goal before launching Codex. If one exists, it uses Codex app-server to mark the goal active, then continues with the original command; if there is no goal or the goal is complete, the existing resume behavior is unchanged.

Set `CX_INTERACTIVE_AUTO_EXEC=1` to force the older non-interactive `codex exec resume ...` continuation path for interrupted interactive turns.

If the next account does not share the `sessions` directory, `cx` first copies only the interrupted session JSONL file into the next account home, then resumes by the exact session id. It never copies, links, or shares any `auth.json`. If the limited process did not create a current session file, `cx` retries the original command on the next account instead of blindly resuming an unrelated older session.

If every candidate account is exhausted or unavailable, `cx` prints the account status and exits with an error instead of launching Codex.

Auto-resume still works best after `cx-setup` links the account homes to shared session directories; the runtime single-session copy is a fallback to avoid resuming the target account's older `--last` conversation when sessions are not shared.

## Environment

```text
CX_ACCOUNT=1|account1|work
CX_ACCOUNT_COUNT=N
CX_ACCOUNT_HOMES=name=/path,name2=/path2
CX_API_KEY_MODE=prefer|fallback
CX_NO_BYPASS=1
CX_NO_TRUST=1
CX_AUTO_RESUME_GOAL=0
CX_LIMIT_TIMEOUT_MS=15000
CX_LIMIT_RETRIES=2
CX_AUTO_MAX_SWITCHES=5
CX_INTERACTIVE_AUTO_EXEC=1
```

`CX_ACCOUNT` behaves like `--account`: it disables probing, sorting, and auto-switching and uses only the selected account.

`CX_ACCOUNT_COUNT`, `CX_LIMIT_TIMEOUT_MS`, `CX_LIMIT_RETRIES`, and `CX_AUTO_MAX_SWITCHES` must be positive integers.

`CX_API_KEY_MODE=fallback` is the default selection policy: usable ChatGPT/Codex accounts come first, and API-key accounts are fallback accounts after limits or probe failures. `CX_API_KEY_MODE=prefer` selects API-key accounts first. You can also persist a local default with `cx-setup --api-key-mode prefer`, which writes `~/.config/codex-cx/config.json`.

`CX_LIMIT_TIMEOUT_MS` applies to each app-server rate-limit probe attempt. `CX_LIMIT_RETRIES` controls how many times each account is probed before it is treated as temporarily unavailable; missing `auth.json` is still reported immediately.

By default, `cx` adds `--dangerously-bypass-approvals-and-sandbox` unless a sandbox or approval option is already present. Use `--no-bypass` or `CX_NO_BYPASS=1` to disable that default.

By default, `cx` trusts the work root used for the launch so account switches are not interrupted by the directory trust prompt. Use `--no-trust` or `CX_NO_TRUST=1` to disable that default.

By default, resume commands automatically reactivate paused, usage-limited, or blocked goals. Set `CX_AUTO_RESUME_GOAL=0` to disable this preflight.

By default, interrupted interactive turns continue through TUI `codex resume <session-id> "Continue ..."` after an automatic account switch. Set `CX_INTERACTIVE_AUTO_EXEC=1` to force non-interactive `codex exec resume ...` instead.

## Troubleshooting

- `No Codex account homes found`: on a new machine, run `cx-setup --accounts <N> --migrate`, or set `CX_ACCOUNT_HOMES`.
- `missing ~/.codex-accountN/auth.json`: run `CODEX_HOME=~/.codex-accountN codex login`.
- `All candidate accounts are exhausted or unavailable`: all probed accounts failed login/probing or hit a 5h/weekly limit.
- Probe errors like `failed to fetch codex rate limits`: increase `CX_LIMIT_TIMEOUT_MS` or `CX_LIMIT_RETRIES` if the network is temporarily slow.
- `cx status` does not show active accounts: active detection reads `/proc`, so it is Linux-focused.
- Auto-switch stops at the directory trust prompt: confirm the installed `cx` is current. Current versions inject trust for the work root by default; if `CX_NO_TRUST=1` or `--no-trust` is set, unset it or trust the directory manually.
- Auto-switch reports `No saved session found with ID Continue...`: an older version built the invalid command `codex resume --last "Continue ..."`. Update to the current version; it uses `codex resume <id> "Continue ..."` when an exact id is available, and falls back to `codex exec resume --last "Continue ..."` when no id can be found.
- Auto-switch resumes the wrong conversation: confirm the installed `cx` is current. Current versions target the exact interrupted session id first and copy that one session file when `sessions` is not shared. If it still happens, run `cx-setup --migrate` or `cx-setup --full --migrate` so all account homes share `sessions`.
- Existing files block setup: rerun with `--migrate` to copy and back up, or `--force` to back up without copying.
- Setup refuses active homes: exit running Codex sessions, then rerun `cx-setup`.
- Setup reports duplicate account names/homes: fix `--homes` or `CX_ACCOUNT_HOMES` so every account has a unique name and unique `CODEX_HOME`.
- Setup reports `Account home must not be the shared home`: use separate directories, for example `~/.codex` for shared state and `~/.codex-account1` for the first account.
- Old accounts still appear after reducing `--accounts <N>`: the old directories are still discoverable. Run `cx-setup --accounts <N> --prune --migrate` or `cx-setup --remove <selector>`.
- API-key checking fails: confirm `--openai-base-url` points exactly at the OpenAI-compatible API root, usually ending in `/v1`; `--api-key-check` surfaces HTML, 404, TLS, empty model-list, and missing `/responses` problems before the account is written.
- API-key accounts are not selected first: the default is `fallback`; use `CX_API_KEY_MODE=prefer cxa` for a one-off run, or `cx-setup --api-key-mode prefer` to persist the local default.

## License

GPL-3.0-only. See [LICENSE](../LICENSE).
