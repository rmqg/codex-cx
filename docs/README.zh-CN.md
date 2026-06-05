# codex-cx

`codex-cx` 是 OpenAI Codex CLI 的账号切换包装器。它适合多个 ChatGPT/Codex 账号分别使用独立 `CODEX_HOME`，同时共享会话和工作状态的本地环境。

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

默认情况下，`cx` 会给当前工作根注入临时 Codex 配置 `projects."<cwd>".trust_level="trusted"`。这样自动切到新账号时不会停在 “Do you trust the contents of this directory?” 提示上。这个配置只作用于本次启动，不会写入账号的 `config.toml`；如果你需要保留 Codex 的目录确认提示，可以用 `--no-trust` 或 `CX_NO_TRUST=1` 关闭。

## 多账号

如果没有设置环境变量，`cx` 会自动发现已有的账号目录：

```text
~/.codex-account*
```

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
cx-setup --accounts <N> --migrate
cx-setup --accounts <N> --full --migrate
cx-setup --accounts <N> --home ~/.codex-shared --prefix ~/.codex-account --full --migrate
cx-setup --homes work=~/.codex-work,school=~/.codex-school --full --migrate
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
codex resume --last "Continue the interrupted task ..."
codex exec resume --last "Continue the interrupted task ..."
```

如果上一轮已经正常完成并产生了 assistant 输出，`cx` 只恢复会话。如果交互式 `cx` 或 `cxr` 的新指令已经写入 session，但这一轮还没完成，或者 Codex 因额度耗尽写出了 `task_complete` 但 `last_agent_message` 为空，`cx` 会通过 `codex resume --last "Continue ..."` 让下一个账号打开 TUI，并自动提交继续执行这条未完成指令的 prompt。

对 `cx exec ...`，重试会走 `codex exec resume --last "Continue ..."`，保持非交互模式，并显式继续未完成的用户指令。如果原始命令是 `cx exec resume <session-id>`，重试会保留这个显式 session id，而不是改成 `--last`。

对 `cx resume ...`、`cxr` 和 `cx exec resume ...`，`cx` 会在启动 Codex 前检查目标 session 是否有 paused、usage-limited 或 blocked goal。如果有，它会通过 Codex app-server 把该 goal 恢复为 active，然后再按原命令继续；如果没有 goal 或 goal 已完成，则保持现有恢复逻辑不变。

设置 `CX_INTERACTIVE_AUTO_EXEC=1` 可以强制使用旧的非交互 `codex exec resume ...` 继续路径。

如果受限进程还没来得及写出本轮 session 文件，`cx` 会在下一个账号上重跑原始命令，而不是盲目恢复某个更旧的 `--last` 会话。

如果所有候选账号都耗尽或不可用，`cx` 会打印账号状态并报错退出，不会启动 Codex。

自动 resume 最适合先用 `cx-setup` 把所有账号 home 链接到共享 `sessions` 目录的配置。

## 环境变量

```text
CX_ACCOUNT=1|account1|work
CX_ACCOUNT_COUNT=N
CX_ACCOUNT_HOMES=name=/path,name2=/path2
CX_NO_BYPASS=1
CX_NO_TRUST=1
CX_AUTO_RESUME_GOAL=0
CX_LIMIT_TIMEOUT_MS=15000
CX_LIMIT_RETRIES=2
CX_AUTO_MAX_SWITCHES=5
CX_INTERACTIVE_AUTO_EXEC=1
```

`CX_ACCOUNT` 等价于 `--account`：它会禁用探测、排序和自动切号，只使用指定账号。

`CX_ACCOUNT_COUNT`、`CX_LIMIT_TIMEOUT_MS`、`CX_LIMIT_RETRIES`、`CX_AUTO_MAX_SWITCHES` 必须是正整数。

`CX_LIMIT_TIMEOUT_MS` 作用于每一次 app-server 额度探测。`CX_LIMIT_RETRIES` 控制每个账号最多探测几次；缺少 `auth.json` 仍然会立即报错，不会重试。

默认情况下，`cx` 会在没有显式 sandbox 或 approval 参数时添加 `--dangerously-bypass-approvals-and-sandbox`。可以用 `--no-bypass` 或 `CX_NO_BYPASS=1` 关闭这个默认行为。

默认情况下，`cx` 会信任本次启动使用的工作根，避免多账号自动切换时被目录信任确认打断。可以用 `--no-trust` 或 `CX_NO_TRUST=1` 关闭这个默认行为。

默认情况下，resume 命令会自动恢复 paused、usage-limited 或 blocked goal。设置 `CX_AUTO_RESUME_GOAL=0` 可以关闭这个预处理。

默认情况下，交互式 turn 在自动切号后会通过 TUI `codex resume --last "Continue ..."` 继续未完成任务。设置 `CX_INTERACTIVE_AUTO_EXEC=1` 可以强制使用非交互 `codex exec resume ...`。

## 故障排查

- `No Codex account homes found`：新环境先运行 `cx-setup --accounts <N> --migrate`，或设置 `CX_ACCOUNT_HOMES`。
- `missing ~/.codex-accountN/auth.json`：运行 `CODEX_HOME=~/.codex-accountN codex login`。
- `All candidate accounts are exhausted or unavailable`：所有账号都探测失败、未登录或触达了 5h/weekly 限制。
- `failed to fetch codex rate limits` 这类探测错误：如果只是临时网络慢，可以调高 `CX_LIMIT_TIMEOUT_MS` 或 `CX_LIMIT_RETRIES`。
- `cx status` 不显示 active：active 检测依赖 Linux `/proc`。
- 自动切号后停在目录信任提示：确认正在使用新版 `cx`；新版默认会注入当前工作根的 trust 配置。如果你设置了 `CX_NO_TRUST=1` 或 `--no-trust`，需要取消它或手动信任目录。
- 自动切号后 resume 到错误会话：运行 `cx-setup --migrate` 或 `cx-setup --full --migrate`，确保所有账号共享 `sessions`。
- setup 被已有文件拦住：用 `--migrate` 复制并备份，或用 `--force` 只备份不复制。
- setup 拒绝 active 目录：先退出正在运行的 Codex 会话，再重新运行 `cx-setup`。
- setup 报重复账号名或重复 home：检查 `--homes` 或 `CX_ACCOUNT_HOMES`，确保每个账号名和每个 `CODEX_HOME` 都唯一。
- setup 报 `Account home must not be the shared home`：账号目录和共享目录要分开，例如 `~/.codex` 做共享状态，`~/.codex-account1` 做第一个账号。

## 许可证

GPL-3.0-only。见 [LICENSE](../LICENSE)。
