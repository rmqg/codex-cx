# codex-cx

Small account-switching wrappers for the OpenAI Codex CLI.

## Documentation

- [English](docs/README.en.md)
- [简体中文](docs/README.zh-CN.md)

## Install

```sh
npm install -g github:rmqg/codex-cx
```

Run the same command again to update an existing global install.

## Commands

```sh
cx [codex args...]
cx --no-trust [codex args...]
cxa [codex args...]
cxr [extra resume args...]
cx-setup [options]
cx-setup --help
cx-setup --list
cx-setup --add-api-key free --api-key-env OPENAI_API_KEY --openai-base-url https://proxy.example.com/v1 --model gpt-5.5 --api-key-check --migrate
cx-setup --remove free
cx-setup --accounts 2 --prune --migrate
```

License: GPL-3.0-only.
