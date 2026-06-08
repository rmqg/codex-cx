# codex-multi-account

Small account-switching wrappers for the OpenAI Codex CLI.

`codex-multi-account` keeps you on the official Codex CLI path while rotating local
`CODEX_HOME` account directories. Compared with relay/proxy workflows, this
keeps original Codex features available, reduces compatibility bugs, avoids
proxy stream instability, and can continue interrupted work seamlessly when an
account hits usage limits.

## Documentation

- [English](docs/README.en.md)
- [简体中文](docs/README.zh-CN.md)

## Install

```sh
npm install -g github:rmqg/codex-multi-account
```

Run the same command again to update an existing global install.

Optional direct `codex` wrapper for automatic project trust:

```sh
cx-setup --install-codex-wrapper --force
```

## Commands

```sh
cx [codex args...]
cx --no-trust [codex args...]
cx status
cx quota  # colored multi-line remaining quota bars
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

License: GPL-3.0-only.
