# codex-cx

`codex-cx` 是 OpenAI Codex CLI 的轻量账号切换包装器，适合把多个 Codex 登录分别放在不同 `CODEX_HOME` 目录里的本地环境。

## 命令

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

`cxa` 等价于：

```sh
cx auto "$@"
```

`cxr` 等价于：

```sh
cx resume --last "$@"
```

`cx --account 2 ...` 是显式指定账号路径：只使用 account2，不探测额度、不排序、不自动切号。不显式指定账号时，`cx` 走和 `cxa` 相同的自动切号路径。

## 安装

从 GitHub 直接安装：

```sh
npm install -g github:rmqg/codex-cx
```

本地开发：

```sh
git clone https://github.com/rmqg/codex-cx.git
cd codex-cx
npm link
```

## 账号目录

默认探测三个 Codex home：

```text
~/.codex-account1
~/.codex-account2
~/.codex-account3
```

每个目录都需要有有效的 Codex 登录，包括 `auth.json`。

```sh
CODEX_HOME=~/.codex-account1 codex login
CODEX_HOME=~/.codex-account2 codex login
CODEX_HOME=~/.codex-account3 codex login
```

## 选择策略

自动模式会先跳过耗尽或不可用账号。以下情况会被视为不可用：额度探测失败、没有 limit 数据、Codex 返回已触达限制、5h 用量大于等于 100%、weekly 用量大于等于 100%。

剩余账号按下面的规则排序：

- weekly 用量差距超过 5 个百分点时，选择 weekly 更低的账号。
- weekly 用量差距在 5 个百分点以内时，比较 5h 用量。
- 5h 用量差距超过 20 个百分点时，选择 5h 更低的账号。
- 5h 用量差距在 20 个百分点以内时，优先选择非 active 账号。
- 如果仍然相同，再按更低 5h、更低 weekly、账号名排序。

这个策略优先保持周限均衡，同时照顾 5h 短周期限制；当两个账号用量接近时，会尽量避开已经 active 的账号。

## 自动切号

`cx` 不带 `--account`、`cxa`、`cxr` 都走自动模式。运行期间，`cx` 会监控 Codex TUI 日志里的 usage-limit 错误。一旦检测到额度限制，`cx` 会终止当前 Codex 进程，把该账号标记为本轮已耗尽，然后用下面的命令重新启动：

```sh
codex resume --last
```

如果所有候选账号都耗尽或不可用，`cx` 会打印账号状态并报错退出，不会启动 Codex。

自动 resume 最适合各账号 home 共享或软链接 Codex session 目录的配置。

## 状态输出

```sh
cx status
```

状态表会显示每个账号的 active 状态、5h 用量、weekly 用量、触达限制原因和 home 目录。Linux 上 `active` 通过读取 `/proc` 中正在运行的 Codex 进程判断。

## 环境变量

```text
CX_ACCOUNT=1|2|3|account1|account2|account3
CX_NO_BYPASS=1
CX_LIMIT_TIMEOUT_MS=15000
CX_AUTO_MAX_SWITCHES=5
```

`CX_ACCOUNT` 等价于 `--account`：它会禁用探测、排序和自动切号，只使用指定账号。

默认情况下，`cx` 会在没有显式 sandbox 或 approval 参数时添加 `--dangerously-bypass-approvals-and-sandbox`。可以用 `--no-bypass` 或 `CX_NO_BYPASS=1` 关闭这个默认行为。

## 要求

- Node.js 18 或更新版本
- OpenAI Codex CLI 可通过 `codex` 命令调用
- 推荐 Linux，用于 active 账号检测

在没有 `/proc` 的平台上，账号选择仍然可用，但 `cx status` 可能无法显示 active 账号。

## 许可证

GPL-3.0-only。见 [LICENSE](../LICENSE)。
