"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  checkApiKeyEndpoint,
  normalizeApiKeyCheckMode,
  normalizeApiKeyMode,
  normalizeOpenAiBaseUrl,
  parseArgs,
  parseHomes,
} = require("../bin/cx-setup");

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.CX_ACCOUNT;
  delete env.CX_ACCOUNT_COUNT;
  delete env.CX_ACCOUNT_HOMES;
  delete env.CX_AUTO_MAX_SWITCHES;
  delete env.CX_API_KEY_MODE;
  delete env.CX_LIMIT_TIMEOUT_MS;
  delete env.CX_LIMIT_RETRY_DELAY_MS;
  return { ...env, ...extra };
}

{
  const options = parseArgs([]);

  assert.equal(options.accounts, null);
  assert.equal(options.homes, null);
  assert.equal(options.list, false);
}

{
  const options = parseArgs(["--accounts", "5", "--full", "--migrate", "--dry-run"]);

  assert.equal(options.accounts, 5);
  assert.equal(options.full, true);
  assert.equal(options.migrate, true);
  assert.equal(options.dryRun, true);
}

{
  const options = parseArgs(["--list-accounts", "--accounts", "2"]);

  assert.equal(options.list, true);
  assert.equal(options.accounts, 2);
}

{
  const options = parseArgs(["--install-codex-wrapper", "--codex-wrapper-bin", "~/bin", "--force"]);

  assert.equal(options.installCodexWrapper, true);
  assert.match(options.codexWrapperBin, /\/bin$/);
  assert.equal(options.force, true);
}

{
  const homes = parseHomes("work=~/codex-work,backup=/tmp/codex-backup,~/codex-third");

  assert.equal(homes[0].name, "work");
  assert.match(homes[0].home, /codex-work$/);
  assert.deepEqual(homes[1], { name: "backup", home: "/tmp/codex-backup" });
  assert.equal(homes[2].name, "account3");
  assert.match(homes[2].home, /codex-third$/);
}

{
  const options = parseArgs(["--homes", "work=~/codex-work,backup=/tmp/codex-backup", "--home", "/tmp/shared"]);

  assert.equal(options.accounts, null);
  assert.deepEqual(
    options.homes.map((account) => account.name),
    ["work", "backup"],
  );
  assert.equal(options.sharedHome, path.resolve("/tmp/shared"));
}

{
  const options = parseArgs([
    "--add-api-key",
    "free",
    "--api-key-env",
    "FREE_KEY",
    "--openai-base-url",
    "https://ai2.hhhl.cc/v1/",
    "--model",
    "gpt-5.5",
    "--api-key-check",
    "--api-key-check-timeout-ms",
    "1234",
    "--api-key-mode",
    "api-key-first",
  ]);

  assert.equal(options.addApiKey, "free");
  assert.equal(options.apiKeyEnv, "FREE_KEY");
  assert.equal(options.openaiBaseUrl, "https://ai2.hhhl.cc/v1");
  assert.equal(options.model, "gpt-5.5");
  assert.equal(options.apiKeyCheck, "auto");
  assert.equal(options.apiKeyCheckTimeoutMs, 1234);
  assert.equal(options.apiKeyMode, "prefer");
}

{
  assert.equal(normalizeApiKeyMode("prefer"), "prefer");
  assert.equal(normalizeApiKeyMode("after-limit"), "fallback");
  assert.equal(normalizeApiKeyCheckMode("chat-completions"), "chat");
  assert.throws(() => normalizeApiKeyCheckMode("bad"), /auto, responses, chat, or models/);
  assert.equal(normalizeOpenAiBaseUrl("https://proxy.example.com/v1/"), "https://proxy.example.com/v1");
}

assert.throws(() => parseArgs(["--accounts", "0"]), /positive integer/);
assert.throws(() => parseArgs(["--homes", ",,,"]), /at least one/);
assert.throws(() => parseArgs(["--homes", "work="]), /include a path/);
assert.throws(() => parseArgs(["--api-key-check"]), /requires --add-api-key/);
assert.throws(
  () => parseArgs(["--add-api-key", "free", "--api-key", "sk-test", "--openai-base-url", "ftp://example.com/v1"]),
  /must use http or https/,
);

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-empty-"));
  const result = spawnSync(process.execPath, [setup, "--dry-run"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /No account homes selected/);
  assert.match(result.stderr, /--accounts <N>/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const result = spawnSync(process.execPath, [setup, "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Add one more numbered account/);
  assert.match(result.stdout, /Install the optional codex PATH wrapper/);
  assert.match(result.stdout, /Create numbered accounts with full shared state/);
  assert.match(result.stdout, /never links or shares auth\.json/);
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-wrapper-"));
  const wrapperBin = path.join(tempHome, "bin");
  const result = spawnSync(
    process.execPath,
    [setup, "--install-codex-wrapper", "--codex-wrapper-bin", wrapperBin, "--force"],
    {
      env: cleanEnv({ HOME: tempHome }),
      encoding: "utf8",
    },
  );

  const installed = path.join(wrapperBin, "codex");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.lstatSync(installed).isSymbolicLink(), true);
  assert.equal(path.resolve(wrapperBin, fs.readlinkSync(installed)), path.resolve(__dirname, "../bin/codex"));
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-apikey-"));
  const configHome = path.join(tempHome, "xdg");
  const result = spawnSync(
    process.execPath,
    [
      setup,
      "--add-api-key",
      "free",
      "--api-key-env",
      "FREE_CODEX_KEY",
      "--openai-base-url",
      "https://ai2.hhhl.cc/v1",
      "--model",
      "gpt-5.5",
      "--api-key-mode",
      "prefer",
      "--migrate",
    ],
    {
      env: cleanEnv({ HOME: tempHome, XDG_CONFIG_HOME: configHome, FREE_CODEX_KEY: "sk-free" }),
      encoding: "utf8",
    },
  );

  const accountHome = path.join(tempHome, ".codex-account-free");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.readFileSync(path.join(accountHome, "auth.json"), "utf8"),
    `${JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-free" }, null, 2)}\n`,
  );
  const config = fs.readFileSync(path.join(accountHome, "config.toml"), "utf8");
  assert.match(config, /openai_base_url = "https:\/\/ai2\.hhhl\.cc\/v1"/);
  assert.match(config, /model = "gpt-5\.5"/);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(configHome, "codex-cx", "config.json"), "utf8")).apiKeyMode,
    "prefer",
  );
  assert.equal(fs.lstatSync(path.join(accountHome, "sessions")).isSymbolicLink(), true);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-remove-"));
  fs.mkdirSync(path.join(tempHome, ".codex-account-free"));
  fs.writeFileSync(path.join(tempHome, ".codex-account-free", "auth.json"), "{}\n");

  const result = spawnSync(process.execPath, [setup, "--remove", "free"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(tempHome, ".codex-account-free")), false);
  assert.ok(fs.readdirSync(tempHome).some((entry) => /^\.codex-account-free\.cx-backup-/.test(entry)));
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-remove-custom-"));
  const customHome = path.join(tempHome, "codex-work");
  fs.mkdirSync(customHome);
  fs.writeFileSync(path.join(customHome, "auth.json"), "{}\n");

  const result = spawnSync(process.execPath, [setup, "--homes", `work=${customHome}`, "--remove", "work"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(customHome), false);
  assert.ok(fs.readdirSync(tempHome).some((entry) => /^codex-work\.cx-backup-/.test(entry)));
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-prune-"));
  fs.mkdirSync(path.join(tempHome, ".codex-account1"));
  fs.mkdirSync(path.join(tempHome, ".codex-account2"));
  fs.mkdirSync(path.join(tempHome, ".codex-account-free"));

  const result = spawnSync(process.execPath, [setup, "--accounts", "1", "--prune", "--migrate"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(tempHome, ".codex-account1")), true);
  assert.equal(fs.existsSync(path.join(tempHome, ".codex-account2")), false);
  assert.equal(fs.existsSync(path.join(tempHome, ".codex-account-free")), false);
  assert.ok(fs.readdirSync(tempHome).some((entry) => /^\.codex-account2\.cx-backup-/.test(entry)));
  assert.ok(fs.readdirSync(tempHome).some((entry) => /^\.codex-account-free\.cx-backup-/.test(entry)));
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-list-"));
  fs.mkdirSync(path.join(tempHome, ".codex-account1"));
  fs.mkdirSync(path.join(tempHome, ".codex-account-free.cx-backup-20260606034723-1872314"));
  fs.writeFileSync(path.join(tempHome, ".codex-account1", "auth.json"), "{}\n");
  fs.writeFileSync(
    path.join(tempHome, ".codex-account-free.cx-backup-20260606034723-1872314", "auth.json"),
    `${JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-backup" })}\n`,
  );

  const result = spawnSync(process.execPath, [setup, "--list"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /account1/);
  assert.doesNotMatch(result.stdout, /free/);
  assert.doesNotMatch(result.stdout, /cx-backup/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-discover-"));
  fs.mkdirSync(path.join(tempHome, ".codex-account4"));
  fs.mkdirSync(path.join(tempHome, ".codex-account7"));

  const result = spawnSync(process.execPath, [setup, "--dry-run"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /\.codex-account4/);
  assert.match(result.stdout, /\.codex-account7/);
  assert.doesNotMatch(result.stdout, /\.codex-account1/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-duplicate-name-"));
  const result = spawnSync(process.execPath, [setup, "--homes", `work=${tempHome}/a,WORK=${tempHome}/b`, "--dry-run"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /duplicate account name: WORK/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-duplicate-home-"));
  const result = spawnSync(process.execPath, [setup, "--homes", `work=${tempHome}/a,backup=${tempHome}/a`, "--dry-run"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /duplicate account home/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-shared-home-"));
  const sharedHome = path.join(tempHome, ".codex-shared");
  const result = spawnSync(process.execPath, [setup, "--homes", `work=${sharedHome}`, "--home", sharedHome, "--dry-run"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Account home must not be the shared home/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const setup = path.resolve(__dirname, "../bin/cx-setup");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-setup-migrate-"));
  const accountOne = path.join(tempHome, ".codex-account1");
  const sessionFile = path.join(accountOne, "sessions", "2026", "06", "03", "session.jsonl");
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, "session data\n");
  fs.writeFileSync(path.join(accountOne, "auth.json"), "{}\n");

  const args = [setup, "--accounts", "2", "--migrate"];
  const first = spawnSync(process.execPath, args, {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });
  const second = spawnSync(process.execPath, args, {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  const sharedSessions = path.join(tempHome, ".codex", "sessions");
  const accountOneSessions = path.join(accountOne, "sessions");
  const accountTwoSessions = path.join(tempHome, ".codex-account2", "sessions");

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.lstatSync(accountOneSessions).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(accountTwoSessions).isSymbolicLink(), true);
  assert.equal(path.resolve(accountOne, fs.readlinkSync(accountOneSessions)), sharedSessions);
  assert.equal(path.resolve(path.join(tempHome, ".codex-account2"), fs.readlinkSync(accountTwoSessions)), sharedSessions);
  assert.equal(fs.readFileSync(path.join(sharedSessions, "2026", "06", "03", "session.jsonl"), "utf8"), "session data\n");
  assert.equal(fs.existsSync(path.join(accountOne, "auth.json")), true);
  assert.equal(fs.lstatSync(path.join(accountOne, "auth.json")).isSymbolicLink(), false);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

(async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  try {
    console.log = () => {};
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      if (String(url).endsWith("/models")) {
        return new Response(JSON.stringify({ object: "chat.completion", id: "not-a-model-list" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).endsWith("/responses")) {
        return new Response(JSON.stringify({ id: "resp-test", model: "gpt-5.5", output_text: "ping" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    };

    await checkApiKeyEndpoint("sk-test", {
      apiKeyCheck: "auto",
      apiKeyCheckTimeoutMs: 1000,
      openaiBaseUrl: "https://proxy.example.com/v1",
      model: "gpt-5.5",
    });

    assert.deepEqual(
      calls.map((call) => [call.method, call.url]),
      [["POST", "https://proxy.example.com/v1/responses"]],
    );
    assert.match(calls[0].body, /gpt-5\.5/);

    await assert.rejects(
      () =>
        checkApiKeyEndpoint("sk-test", {
          apiKeyCheck: "models",
          apiKeyCheckTimeoutMs: 1000,
          openaiBaseUrl: "https://proxy.example.com/v1",
        }),
      /did not return a model list/,
    );

    globalThis.fetch = async () =>
      new Response("<html>missing</html>", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    await assert.rejects(
      () =>
        checkApiKeyEndpoint("sk-test", {
          apiKeyCheck: "models",
          apiKeyCheckTimeoutMs: 1000,
          openaiBaseUrl: "https://bad.example.com/v1",
        }),
      /HTTP 404/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
