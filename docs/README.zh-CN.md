# codex-cx

`codex-cx` 是 OpenAI Codex CLI 的账号切换包装器。它适合多个 ChatGPT/Codex 账号分别使用独立 `CODEX_HOME`，同时共享会话和工作状态的本地环境。

## 为什么用本地切号

`codex-cx` 不做模型请求中转，也不替换官方 Codex 协议。它只是为每个账号设置对应的 `CODEX_HOME`，再启动真实的 Codex CLI。

相比把请求转到中转服务，这种方式的优点是：

- 兼容问题更少：登录、resume、goal、plugin、MCP、图片、sandbox、配置项等仍由官方 Codex CLI 自己处理。
- 连接更稳定：没有额外的模型流转发层，少一个会断流、改包或不兼容新特性的环节。
- 原版特性保留更完整：Codex CLI 新增的子命令和参数通常可以直接透传。
- 无缝衔接更可靠：账号触达额度时，`cx` 会切到下一个账号，并优先恢复刚刚中断的精确 session。
- 凭据隔离更清楚：每个账号保留自己的 `auth.json`，不会链接、复制或共享登录凭据。

## 从零开始

1. 安装 Node.js 18 或更新版本。
2. 安装 OpenAI Codex CLI，并确认 `codex --version` 可用。
3. 安装 `codex-cx`：

```sh
npm install -g github:rmqg/codex-cx
```

已安装过时，用同一条命令更新全局版本：

```sh
npm install -g github:rmqg/codex-cx
```

4. 决定你要接入多少个账号，记为 `<N>`。创建账号目录并链接共享会话：

```sh
cx-setup --accounts <N> --migrate
```

创建 OpenAI API key 或 OpenAI 兼容接口账号：

```sh
printf '%s' "$OPENAI_API_KEY" | cx-setup --add-api-key free --api-key-stdin --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
```

如果你希望日志、state、goals、memories sqlite、生成图片等状态也共享，使用 full 模式：

```sh
cx-setup --accounts <N> --full --migrate
```

5. 每个账号分别登录一次：

```sh
for i in $(seq 1 <N>); do
  CODEX_HOME="$HOME/.codex-account$i" codex login
done
```

6. 验证：

```sh
cx status
cxa --dry-run
```

可选：如果希望直接运行 `codex` 时也自动信任当前目录，安装 PATH 包装器：

```sh
cx-setup --install-codex-wrapper --force
```

这个命令会安装或更新 `~/.local/bin/codex`，请确保 `~/.local/bin` 在 PATH 中位于官方 `codex` 之前。旧 shell 如果缓存了命令路径，运行 `rehash` 或重新开终端。

## 命令

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
cx-setup --help
cx-setup --list
cx-setup --install-codex-wrapper --force
cx-setup --add-api-key free --api-key-env OPENAI_API_KEY --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
cx-setup --remove free
cx-setup --accounts 2 --prune --migrate
```

`cxa` 等价于：

```sh
cx auto "$@"
```

`cxr` 等价于：

```sh
cx resume --last "$@"
```

`cx --account work ...` 是显式指定账号路径：只使用这个账号，不探测额度、不排序、不自动切号。不显式指定账号时，`cx` 走和 `cxa` 相同的自动切号路径。

如果某个参数必须原样传给 Codex，但它看起来像 `cx` 包装器参数，可以用 `--` 分隔：

```sh
cx --account work -- --dry-run exec "hello"
```

默认情况下，`cx` 会在启动真实 Codex 前，把当前目录和 `--cd`/`-C` 指向的目录写入所选账号的 `CODEX_HOME/config.toml`：

```toml
[projects."/some/path"]
trust_level = "trusted"
```

这样自动切到新账号时不会停在 “Do you trust the contents of this directory?” 提示上。写入是幂等的，只更新对应项目表的 `trust_level`，不会链接、复制或共享 `auth.json`。如果你需要保留 Codex 的目录确认提示，可以用 `--no-trust` 或 `CX_NO_TRUST=1` 关闭。

安装 `cx-setup --install-codex-wrapper --force` 后，直接运行 `codex` 也会在转交给真实 Codex CLI 前执行同样的目录 trust 写入。`CODEX_TRUST_ALL=0` 或 `CX_NO_TRUST=1` 可以关闭这个包装器行为；如果包装器找不到真实 Codex，可以设置 `CX_REAL_CODEX=/path/to/codex`。

## 多账号

如果没有设置环境变量，`cx` 会自动发现已有的账号目录：

```text
~/.codex-account*
```

自动发现会跳过 `cx-setup --remove` 或 `--prune` 产生的 `.cx-backup-*` 备份目录。

新环境中先用 `cx-setup --accounts <N>` 创建这些目录。也可以显式指定要探测的编号范围：

```sh
CX_ACCOUNT_COUNT=<N> cx status
CX_ACCOUNT_COUNT=<N> cxa
```

使用自定义账号目录：

```sh
CX_ACCOUNT_HOMES=work=~/.codex-work,school=~/.codex-school,backup=/mnt/codex-backup cx status
```

配置 `CX_ACCOUNT_HOMES` 后，可以用配置名指定账号：

```sh
CX_ACCOUNT_HOMES=work=~/.codex-work,school=~/.codex-school cx --account work
```

自定义目录也可以直接交给 setup 链接共享 session：

```sh
cx-setup --homes work=~/.codex-work,school=~/.codex-school --migrate
```

账号名和账号 home 路径都必须唯一。账号 home 不能和 shared home 指向同一个目录。

## API key 账号

`cx-setup --add-api-key <name>` 会创建一个命名 API key 账号。默认账号目录是 `~/.codex-account-<name>`，例如 `free` 会变成 `~/.codex-account-free`，自动发现时也会显示为 `free`。

推荐从环境变量或 stdin 写入 key，避免把 key 留在 shell 历史里：

```sh
OPENAI_API_KEY=sk-... cx-setup --add-api-key free --api-key-env OPENAI_API_KEY --openai-base-url https://ai2.hhhl.cc/v1 --model gpt-5.5 --api-key-check --migrate

printf '%s' 'sk-...' | cx-setup --add-api-key free --api-key-stdin --openai-base-url https://ai2.hhhl.cc/v1 --model gpt-5.5 --api-key-check --migrate
```

这个命令会在该账号 home 写入 `auth.json`：

```json
{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "sk-..."
}
```

同时会在该账号的 `config.toml` 写入 `cli_auth_credentials_store = "file"`、`forced_login_method = "api"`，并按参数写入 `model` 和 `openai_base_url`。如果 `auth.json` 已存在，默认会拒绝覆盖；确认要替换时加 `--force`。

`--openai-base-url` 会被规范化为无尾随 `/` 的 http(s) URL。加 `--api-key-check` 后，setup 会在写入 `auth.json` 前验证接口；默认 `auto` 模式在同时提供 `--model` 时请求 `<openai_base_url>/responses`，没有 `--model` 时请求 `<openai_base_url>/models`。也可以显式使用 `--api-key-check=responses`、`--api-key-check=chat` 或 `--api-key-check=models`。`--api-key-check-timeout-ms <MS>` 可以调整超时。校验失败时不会写入 API key 凭据。

API key 账号不会走 ChatGPT 账号额度探测。自动模式会把它视为可用账号，但选择顺序由 API key 模式控制：

```sh
CX_API_KEY_MODE=fallback cxa
CX_API_KEY_MODE=prefer cxa
cx-setup --api-key-mode prefer
```

`fallback` 是默认模式：优先使用正常 ChatGPT/Codex 账号，只有这些账号不可用、探测失败或额度耗尽时才使用 API key 账号。`prefer` 会优先选择 API key 账号。`cx-setup --api-key-mode <mode>` 会写入本机 `~/.config/codex-cx/config.json`，环境变量 `CX_API_KEY_MODE` 可以临时覆盖它。

## 增减账号

列出 setup 当前会发现或选择的账号：

```sh
cx-setup --list
cx-setup --accounts 3 --list
cx-setup --homes work=~/.codex-work,school=~/.codex-school --list
```

列表会显示账号名、home 是否存在、是否 active、认证类型、已链接的共享项数量和 home 路径。它不会读取或打印 API key。

增加编号账号仍使用：

```sh
cx-setup --accounts <N> --migrate
```

减少账号时，如果只是把 `<N>` 改小，旧的 `.codex-account*` 目录仍会被自动发现。使用 `--prune` 可以把目标集合之外的已发现账号目录移到 `.cx-backup-*` 备份名，从自动发现里移除：

```sh
cx-setup --accounts 2 --prune --migrate
```

移除单个命名或编号账号：

```sh
cx-setup --remove free
cx-setup --remove account3
cx-setup --remove 3
cx-setup --homes work=~/.codex-work --remove work
```

移除账号默认是移动整个账号 home 到备份路径，不会删除或共享其中的 `auth.json`。`--remove` 的候选集合会合并自动发现账号和 `--accounts`/`--homes` 显式指定的账号；同一个 home 只处理一次。如果选择器匹配多个不同 home，会报歧义并要求使用更明确的账号名或路径。

备份目录名包含 `.cx-backup-*`，新版 `cx`、`cxr` 和 `cx-setup --list` 都会跳过这些备份，所以被移除的 API key 账号不会再因为备份目录仍在 home 下而被自动选择。

如果目标账号正被 Codex 进程使用，真实执行会拒绝操作；先退出对应会话，或明确接受风险时使用 `--allow-active`。

## 共享工作空间

`cx-setup` 会创建账号目录，并把共享工作状态链接到同一个 shared home。它永远不会链接 `auth.json`，每个账号都保留自己的登录凭据。

默认共享：

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

full 模式额外共享：

```text
log
goals_1.sqlite*
logs_2.sqlite*
memories_1.sqlite*
state_5.sqlite*
```

常用 setup 命令：

```sh
cx-setup --accounts <N> --dry-run
cx-setup --list
cx-setup --accounts <N> --migrate
cx-setup --accounts <N> --full --migrate
cx-setup --accounts <N> --home ~/.codex-shared --prefix ~/.codex-account --full --migrate
cx-setup --homes work=~/.codex-work,school=~/.codex-school --full --migrate
cx-setup --add-api-key free --api-key-env OPENAI_API_KEY --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
cx-setup --install-codex-wrapper --force
cx-setup --accounts 2 --prune --migrate
cx-setup --remove free
```

`--migrate` 会在共享目标不存在时复制已有账号数据，然后把旧路径备份成 `.cx-backup-*`，再创建软链接。SQLite 文件不能真正合并；已有的每个账号文件会保留在备份里。

`--force` 会直接把已有路径移到备份里，不先复制。只有你确定旧数据不需要时再用。

`cx-setup` 默认拒绝修改正在被 Codex 进程使用的账号目录。请先退出这些 Codex 会话再执行真实迁移。`--dry-run` 始终安全；`--allow-active` 可以绕过保护，但在 `--full` 模式下风险较高，因为 sqlite/state 文件可能正在被打开。执行 `--full` 后，除非你能接受共享 SQLite 的并发风险，否则不要同时运行多个会写入 state 的 Codex 实例。

## 选择策略

自动模式会先跳过耗尽或不可用账号。以下情况会被视为不可用：额度探测失败、没有 limit 数据、Codex 返回已触达限制、5h 用量大于等于 100%、weekly 用量大于等于 100%。已触达的 primary 限制，包括 `workspace_owner_credits_depleted`，会统一显示为 `5h>=100%`；已触达的 secondary 限制会显示为 `weekly>=100%`。

剩余账号按下面的规则排序：

- weekly 用量差距超过 5 个百分点时，选择 weekly 更低的账号。
- weekly 用量差距在 5 个百分点以内时，比较 5h 用量。
- 5h 用量差距超过 20 个百分点时，选择 5h 更低的账号。
- 5h 用量差距在 20 个百分点以内时，优先选择非 active 账号。
- 如果仍然相同，再按更低 5h、更低 weekly、账号名排序。

自动模式打印选中账号时，如果能从该账号 `auth.json` 读取到邮箱，会把邮箱附在账号名后，例如 `[cx-auto] selected account1 (name@example.com): ...`。读不到邮箱或 `auth.json` 不是可解析 JSON 时，会保持原来的账号名输出。

## 自动切号

运行期间，`cx` 会监控 Codex TUI 日志里的 usage-limit 错误。它会识别 Codex 自己的 `You've hit your usage limit`、`Your workspace is out of credits`、workspace credits/spend cap reached 类型、带 Codex HTTP 429 的 `Turn error`，以及结构化 Goal 模式 usage-limit 日志。它会忽略工具调用文本、命令输出，以及 GitHub curated-plugin sync 429 这类外部服务限流。一旦检测到真实额度限制，`cx` 会终止当前 Codex 进程，把该账号标记为本轮已耗尽，然后切到另一个可用账号。

重试路径取决于触发额度限制时的会话状态：

```sh
codex resume <interrupted-session-id> "Continue the interrupted task ..."
codex exec resume <interrupted-session-id> "Continue the interrupted task ..."
```

如果上一轮已经正常完成并产生了 assistant 输出，`cx` 只恢复会话。如果交互式 `cx` 或 `cxr` 的新指令已经写入 session，但这一轮还没完成，或者 Codex 因额度耗尽写出了 `task_complete` 但 `last_agent_message` 为空，`cx` 会通过 `codex resume <interrupted-session-id> "Continue ..."` 让下一个账号打开 TUI，并自动提交继续执行这条未完成指令的 prompt。即使同一个 turn 里较早已经有过 assistant 输出，只要额度耗尽时没有最终 `last_agent_message`，也会按未完成处理。只要 session 文件里有 id，`cx` 会恢复刚刚中断的精确 session，而不是依赖下一个账号自己的 `--last`。

如果 `cx` 找不到精确 session id，它不会生成 `codex resume --last "Continue ..."`，因为 Codex CLI 会把这条 `Continue ...` 当作 session id 解析；此时会降级为 `codex exec resume --last "Continue ..."`，确保继续 prompt 能被发送。

对 `cx exec ...`，重试会走 `codex exec resume <interrupted-session-id> "Continue ..."`，保持非交互模式，并显式继续未完成的用户指令。如果原始命令是 `cx exec resume <session-id>`，重试会保留这个显式 session id，而不是改成 `--last`。

对 `cx resume ...`、`cxr` 和 `cx exec resume ...`，`cx` 会在启动 Codex 前检查目标 session 是否有 paused、usage-limited 或 blocked goal。如果有，它会通过 Codex app-server 把该 goal 恢复为 active，然后再按原命令继续；如果没有 goal 或 goal 已完成，则保持现有恢复逻辑不变。

设置 `CX_INTERACTIVE_AUTO_EXEC=1` 可以强制使用旧的非交互 `codex exec resume ...` 继续路径。

如果下一个账号没有共享 `sessions` 目录，`cx` 会先把刚刚中断的这一个 session JSONL 文件复制到下一个账号 home，再按精确 session id 恢复。它不会复制、链接或共享任何 `auth.json`。如果受限进程还没来得及写出本轮 session 文件，`cx` 会在下一个账号上重跑原始命令，而不是盲目恢复某个更旧的 `--last` 会话。

如果所有候选账号都耗尽或不可用，`cx` 会打印账号状态并报错退出，不会启动 Codex。

自动 resume 仍然最适合先用 `cx-setup` 把所有账号 home 链接到共享 `sessions` 目录；运行时单文件复制只是为了避免未共享 sessions 时恢复到目标账号的旧会话。

## 环境变量

```text
CX_ACCOUNT=1|account1|work
CX_ACCOUNT_COUNT=N
CX_ACCOUNT_HOMES=name=/path,name2=/path2
CX_API_KEY_MODE=prefer|fallback
CX_NO_BYPASS=1
CX_NO_TRUST=1
CODEX_TRUST_ALL=0
CX_REAL_CODEX=/path/to/codex
CX_AUTO_RESUME_GOAL=0
CX_LIMIT_TIMEOUT_MS=15000
CX_LIMIT_RETRIES=2
CX_AUTO_MAX_SWITCHES=5
CX_INTERACTIVE_AUTO_EXEC=1
```

`CX_ACCOUNT` 等价于 `--account`：它会禁用探测、排序和自动切号，只使用指定账号。

`CX_ACCOUNT_COUNT`、`CX_LIMIT_TIMEOUT_MS`、`CX_LIMIT_RETRIES`、`CX_AUTO_MAX_SWITCHES` 必须是正整数。

`CX_API_KEY_MODE=fallback` 是默认选择策略：可用的 ChatGPT/Codex 账号优先，API key 账号作为额度耗尽后的兜底。`CX_API_KEY_MODE=prefer` 会优先选择 API key 账号。本机默认值也可以用 `cx-setup --api-key-mode prefer` 写入 `~/.config/codex-cx/config.json`。

`CX_LIMIT_TIMEOUT_MS` 作用于每一次 app-server 额度探测。`CX_LIMIT_RETRIES` 控制每个账号最多探测几次；缺少 `auth.json` 仍然会立即报错，不会重试。

默认情况下，`cx` 会在没有显式 sandbox 或 approval 参数时添加 `--dangerously-bypass-approvals-and-sandbox`。可以用 `--no-bypass` 或 `CX_NO_BYPASS=1` 关闭这个默认行为。

默认情况下，`cx` 会把本次启动的当前目录和 `--cd`/`-C` 目标写入所选账号的 `config.toml`，避免多账号自动切换时被目录信任确认打断。可以用 `--no-trust` 或 `CX_NO_TRUST=1` 关闭这个默认行为。

安装 `codex` PATH 包装器后，`CODEX_TRUST_ALL=0` 可以只关闭直接 `codex` 的自动 trust 写入；`CX_NO_TRUST=1` 会同时关闭 `cx` 和直接 `codex` 的自动 trust 写入。`CX_REAL_CODEX` 可以指定包装器要转交的真实 Codex CLI 路径。

默认情况下，resume 命令会自动恢复 paused、usage-limited 或 blocked goal。设置 `CX_AUTO_RESUME_GOAL=0` 可以关闭这个预处理。

默认情况下，交互式 turn 在自动切号后会通过 TUI `codex resume <session-id> "Continue ..."` 继续未完成任务。设置 `CX_INTERACTIVE_AUTO_EXEC=1` 可以强制使用非交互 `codex exec resume ...`。

## 故障排查

- `No Codex account homes found`：新环境先运行 `cx-setup --accounts <N> --migrate`，或设置 `CX_ACCOUNT_HOMES`。
- `missing ~/.codex-accountN/auth.json`：运行 `CODEX_HOME=~/.codex-accountN codex login`。
- `All candidate accounts are exhausted or unavailable`：所有账号都探测失败、未登录或触达了 5h/weekly 限制。
- `failed to fetch codex rate limits` 这类探测错误：如果只是临时网络慢，可以调高 `CX_LIMIT_TIMEOUT_MS` 或 `CX_LIMIT_RETRIES`。
- `cx status` 不显示 active：active 检测依赖 Linux `/proc`。
- 自动切号后停在目录信任提示：确认正在使用新版 `cx`；新版默认会把当前目录和 `--cd`/`-C` 目标写入所选账号的 `config.toml`。如果你设置了 `CX_NO_TRUST=1` 或 `--no-trust`，需要取消它或手动信任目录。
- 直接运行 `codex` 仍弹目录信任提示：运行 `cx-setup --install-codex-wrapper --force`，确认 `command -v codex` 指向 `~/.local/bin/codex`，旧 shell 可执行 `rehash` 或重新打开终端。
- `codex` 包装器报找不到真实 Codex：确认官方 Codex CLI 在 PATH 中还有另一个 `codex`，或设置 `CX_REAL_CODEX=/path/to/codex`。
- 自动切号后报 `No saved session found with ID Continue...`：这是旧版生成了非法的 `codex resume --last "Continue ..."`。更新到新版；新版有精确 session id 时会用 `codex resume <id> "Continue ..."`，没有 id 时会降级到 `codex exec resume --last "Continue ..."`。
- 自动切号后 resume 到错误会话：确认正在使用新版 `cx`；新版会优先恢复刚刚中断的精确 session id，并在未共享 `sessions` 时复制这一条 session 文件。仍有问题时运行 `cx-setup --migrate` 或 `cx-setup --full --migrate`，确保所有账号共享 `sessions`。
- `cx-setup --remove free` 后仍自动选择 free：更新到新版；旧版会把 `.codex-account-free.cx-backup-*` 备份目录继续当作账号发现，新版会跳过 `.cx-backup-*` 备份。可以用 `cx-setup --list` 确认候选账号。
- setup 被已有文件拦住：用 `--migrate` 复制并备份，或用 `--force` 只备份不复制。
- setup 拒绝 active 目录：先退出正在运行的 Codex 会话，再重新运行 `cx-setup`。
- setup 报重复账号名或重复 home：检查 `--homes` 或 `CX_ACCOUNT_HOMES`，确保每个账号名和每个 `CODEX_HOME` 都唯一。
- setup 报 `Account home must not be the shared home`：账号目录和共享目录要分开，例如 `~/.codex` 做共享状态，`~/.codex-account1` 做第一个账号。
- 改小 `--accounts <N>` 后旧账号仍会出现：旧目录还在自动发现范围内，运行 `cx-setup --accounts <N> --prune --migrate` 或 `cx-setup --remove <selector>`。
- API key 校验失败：确认 `--openai-base-url` 必须精确到 OpenAI 兼容 API 根路径，通常以 `/v1` 结尾；`--api-key-check` 会把 HTML、404、TLS、服务端换 key/无权限、空模型列表或 `/responses` 不可用的问题提前暴露出来。
- API key 账号没有被优先使用：默认是 `fallback`，运行 `CX_API_KEY_MODE=prefer cxa` 临时切换，或 `cx-setup --api-key-mode prefer` 写入本机默认。

## 许可证

GPL-3.0-only。见 [LICENSE](../LICENSE)。
