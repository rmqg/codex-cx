# codex-multi-account 中文教程

这个工具用来在本机管理多个 Codex 账号。

你继续使用官方 Codex CLI，`codex-multi-account` 只负责三件事：

- 给每个账号准备独立的 `CODEX_HOME`。
- 在多个账号之间自动选择可用账号。
- 某个账号触达额度时，尽量切到下一个账号继续刚才的任务。

它不是中转服务，不会转发模型请求，也不会共享你的 `auth.json` 登录凭据。

## 什么时候需要它

适合这些情况：

- 你有多个 ChatGPT/Codex 账号。
- 你希望不同账号共享会话记录，方便切号后继续。
- 你不想用模型中转，想保留官方 Codex CLI 的原生功能。
- 你经常遇到额度限制，希望自动换账号继续。

不适合这些情况：

- 你只有一个账号。
- 你只想配置一个 OpenAI API key，不需要多个账号切换。

## 安装前准备

先确认你已经有这两个东西：

```sh
node --version
codex --version
```

要求：

- Node.js 18 或更新版本。
- 官方 OpenAI Codex CLI 已安装，并且 `codex --version` 能正常输出。

## 安装

```sh
npm install -g github:rmqg/codex-multi-account
```

以后升级也运行同一条命令：

```sh
npm install -g github:rmqg/codex-multi-account
```

安装后确认命令存在：

```sh
cx --help
cx-setup --help
```

## 第一次配置

假设你有 3 个账号，先创建 3 个账号目录：

```sh
cx-setup --accounts 3 --migrate
```

它会创建：

```text
~/.codex-account1
~/.codex-account2
~/.codex-account3
```

每个账号都要登录一次：

```sh
CODEX_HOME="$HOME/.codex-account1" codex login
CODEX_HOME="$HOME/.codex-account2" codex login
CODEX_HOME="$HOME/.codex-account3" codex login
```

登录完成后检查状态：

```sh
cx status
```

查看每个账号还剩多少额度：

```sh
cx quota
```

`cx quota` 会先显示总剩余，再按账号分块显示 5h 和 weekly 剩余额度、恢复时间，并用彩色 ASCII 进度条显示大概情况。
总剩余不是简单平均；如果 Codex 返回了账号窗口上限，它会按上限加权，适合不同账号类型额度上限不一样的情况。
如果某个窗口没有上限字段，它会按 1 个单位兜底，并在 Total 标题里标出 fallback。
如果 Codex 没有返回恢复时间，对应窗口会显示 `reset unknown`。

## 日常使用

自动选择账号启动 Codex：

```sh
cxa
```

一次任务开始后，模型、profile 和 reasoning 档位会跟着这次任务走，不会因为切到另一个账号就变成另一个账号的默认档位。
如果你在任务中用 `/fast` 或 `/slow` 改了档位，自动切号续跑会读取中断会话里的最新档位继续。

执行一次非交互任务：

```sh
cx exec "帮我总结这个项目"
```

恢复上一次会话：

```sh
cxr
```

只用某一个账号：

```sh
cx --account 1
cx --account account2
```

查看账号状态：

```sh
cx status
```

查看剩余额度：

```sh
cx quota
cx limits
cx remaining
```

这三个额度命令等价。

## 常用命令速查

```sh
cx [codex args...]              # 自动选择账号运行 Codex
cxa [codex args...]             # 自动模式，等价于 cx auto
cxr [extra resume args...]      # 恢复最后一个会话
cx status                       # 查看账号状态和已用额度
cx quota                        # 查看加权总剩余、恢复时间和每账号进度条
cx --account 2                  # 只用第 2 个账号
cx --no-trust                   # 不自动写入项目 trust
cx --no-bypass                  # 不自动加 bypass 参数
cx-setup --accounts 3 --migrate # 创建 3 个账号目录
cx-setup --list                 # 列出账号目录
```

## 自动 trust 是什么

Codex 第一次进入某个项目时，可能会问：

```text
Do you trust the contents of this directory?
```

多账号切换时，如果每个账号都弹一次这个确认，会很烦。

默认情况下，`cx` 会在启动 Codex 前，把当前目录写进所选账号的：

```text
CODEX_HOME/config.toml
```

写入内容类似：

```toml
[projects."/some/path"]
trust_level = "trusted"
```

这样切账号时通常不会再弹 trust 提示。

如果你想保留官方确认提示：

```sh
cx --no-trust
CX_NO_TRUST=1 cxa
```

## 让普通 codex 也自动 trust

如果你直接运行 `codex`，而不是 `cx` 或 `cxa`，可以安装一个 PATH 包装器：

```sh
cx-setup --install-codex-wrapper --force
```

确认它生效：

```sh
command -v codex
```

理想输出是：

```text
~/.local/bin/codex
```

如果旧终端缓存了命令路径，运行：

```sh
rehash
```

或者重新打开一个终端。

## 共享哪些东西

默认共享这些状态：

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

重点：

- 会话记录会共享，所以切号后更容易继续。
- `auth.json` 不会共享。
- 每个账号仍然保留自己的登录状态。

如果你还想共享日志、goals、state、memories sqlite 文件：

```sh
cx-setup --accounts 3 --full --migrate
```

`--full` 更激进，不建议同时开多个会写 state 的 Codex 实例。

## API key 账号

你也可以创建一个 API key 账号作为兜底。

推荐从环境变量读取 key：

```sh
OPENAI_API_KEY=sk-... cx-setup --add-api-key free --api-key-env OPENAI_API_KEY --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
```

或者从 stdin 读取，避免 key 留在 shell 历史里：

```sh
printf '%s' "$OPENAI_API_KEY" | cx-setup --add-api-key free --api-key-stdin --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
```

默认选择策略是：

- 先用正常 ChatGPT/Codex 账号。
- 这些账号不可用或额度耗尽时，再用 API key 账号。

如果想优先用 API key 账号：

```sh
CX_API_KEY_MODE=prefer cxa
cx-setup --api-key-mode prefer
```

本机 API key 选择偏好会写到 `~/.config/codex-cx/config.json`。这个目录名保留旧名是为了兼容已安装用户。

## 增加账号

例如原来有 3 个账号，现在要加到 4 个：

```sh
cx-setup --accounts 4 --migrate
CODEX_HOME="$HOME/.codex-account4" codex login
```

## 移除账号

移除 `free` 账号：

```sh
cx-setup --remove free
```

移除第 3 个账号：

```sh
cx-setup --remove 3
```

移除不会删除数据，而是把账号目录移动到 `.cx-backup-*` 备份路径。

## 自定义账号目录

如果你不想用 `~/.codex-account1` 这种编号目录：

```sh
cx-setup --homes work=~/.codex-work,school=~/.codex-school --migrate
```

使用时：

```sh
cx --account work
CX_ACCOUNT_HOMES=work=~/.codex-work,school=~/.codex-school cxa
```

## 环境变量

常用：

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

说明：

- `CX_ACCOUNT=1`：固定只用第 1 个账号。
- `CX_ACCOUNT_COUNT=3`：只探测 1 到 3 号账号。
- `CX_API_KEY_MODE=prefer`：优先使用 API key 账号。
- `CX_NO_BYPASS=1`：不要自动添加 bypass 参数。
- `CX_NO_TRUST=1`：不要自动写入项目 trust。
- `CX_COLOR=1`：强制彩色额度进度条。
- `CX_COLOR=0` 或 `NO_COLOR=1`：关闭颜色。

进阶：

```text
CODEX_TRUST_ALL=0
CX_REAL_CODEX=/path/to/codex
CX_AUTO_RESUME_GOAL=0
CX_LIMIT_TIMEOUT_MS=15000
CX_LIMIT_RETRIES=2
CX_AUTO_MAX_SWITCHES=5
CX_INTERACTIVE_AUTO_EXEC=1
```

## 自动切号怎么继续任务

如果当前账号触达额度限制，`cx` 会：

1. 停掉当前 Codex 进程。
2. 把这个账号标记为本轮不可用。
3. 找下一个可用账号。
4. 优先恢复刚刚中断的精确 session。
5. 发送继续提示，让新账号接着做未完成任务。

常见恢复命令形态：

```sh
codex resume <interrupted-session-id> "Continue the interrupted task ..."
codex exec resume <interrupted-session-id> "Continue the interrupted task ..."
```

如果没有找到精确 session id，`cx` 会尽量使用安全的 fallback，避免把 `Continue ...` 错当成 session id。

## 常见问题

`No Codex account homes found`

先创建账号目录：

```sh
cx-setup --accounts 3 --migrate
```

`missing ~/.codex-accountN/auth.json`

对应账号还没登录：

```sh
CODEX_HOME="$HOME/.codex-accountN" codex login
```

`All candidate accounts are exhausted or unavailable`

所有账号都不可用、未登录、探测失败或额度耗尽。先看：

```sh
cx status
cx quota
```

自动切号后仍然弹 trust 提示

确认没有设置：

```sh
CX_NO_TRUST=1
```

也可以重新安装 direct `codex` 包装器：

```sh
cx-setup --install-codex-wrapper --force
```

`cx status` 不显示 active

active 检测依赖 Linux `/proc`，在非 Linux 环境可能不准确。

API key 校验失败

检查 `--openai-base-url` 是否是正确 API 根路径，通常以 `/v1` 结尾。

## 许可证

GPL-3.0-only。见 [LICENSE](../LICENSE)。
