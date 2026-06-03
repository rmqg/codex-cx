"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const path = require("path");
const { isUsable, limitExhaustedReason, retryArgsAfterRateLimit, selectResult } = require("../bin/cx");

function account(name, primary, secondary, options = {}) {
  return {
    account: { name, home: `/tmp/${name}` },
    active: Boolean(options.active),
    ok: options.ok ?? true,
    error: options.error,
    limits: {
      primary: { usedPercent: primary },
      secondary: { usedPercent: secondary },
      rateLimitReachedType: options.reached || "",
    },
  };
}

function tempAccountHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cx-test-account-"));
}

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.CX_ACCOUNT;
  delete env.CX_ACCOUNT_COUNT;
  delete env.CX_ACCOUNT_HOMES;
  return { ...env, ...extra };
}

function writeSession(accountHome, events) {
  const dir = path.join(accountHome, "sessions", "2026", "06", "03");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-test-${process.pid}-${Math.random().toString(16).slice(2)}.jsonl`);
  fs.writeFileSync(
    file,
    events
      .map((payload) =>
        JSON.stringify({
          timestamp: new Date().toISOString(),
          ...payload,
        }),
      )
      .join("\n"),
  );
  const now = new Date();
  fs.utimesSync(file, now, now);
  return file;
}

function taskStarted() {
  return { type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } };
}

function userMessage(text) {
  return {
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  };
}

function assistantMessage(text) {
  return {
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
  };
}

function taskComplete() {
  return { type: "event_msg", payload: { type: "task_complete", turn_id: "turn-1" } };
}

{
  const selected = selectResult([
    account("account1", 1, 80),
    account("account2", 99, 10, { active: true }),
    account("account3", 20, 30),
  ]);

  assert.equal(selected.account.name, "account2", "weekly usage wins when the gap is above 5%");
}

{
  const selected = selectResult([
    account("account1", 80, 10),
    account("account2", 20, 14),
  ]);

  assert.equal(selected.account.name, "account2", "5h usage wins when weekly usage is within 5%");
}

{
  const selected = selectResult([
    account("account1", 10, 10, { active: true }),
    account("account2", 29, 14),
  ]);

  assert.equal(selected.account.name, "account2", "inactive account wins when weekly and 5h gaps are both within thresholds");
}

{
  const selected = selectResult([
    account("account1", 10, 10, { active: true }),
    account("account2", 31, 14),
  ]);

  assert.equal(selected.account.name, "account1", "5h usage wins when the 5h gap is above 20%");
}

{
  const selected = selectResult([
    account("account1", 30, 30, { active: true }),
    account("account2", 30, 30),
    account("account3", 30, 30),
  ]);

  assert.equal(selected.account.name, "account2", "account name breaks ties after active state");
}

{
  const exhausted = account("account1", 0, 0, { reached: "secondary" });
  const selected = selectResult([
    exhausted,
    account("account2", 70, 20),
  ]);

  assert.equal(limitExhaustedReason(exhausted), "secondary");
  assert.equal(selected.account.name, "account2", "exhausted accounts are skipped even when usage would sort first");
}

{
  const selected = selectResult([
    account("account1", 100, 10),
    account("account2", 20, 100),
    account("account3", 0, 0, { reached: "primary" }),
  ]);

  assert.equal(selected, null, "all exhausted accounts return no selection");
}

{
  const exhausted = account("account3", 0, 0, { reached: "primary" });
  const selected = selectResult([
    account("account1", 20, 50, { active: true }),
    account("account2", 30, 60, { active: true }),
    exhausted,
  ]);

  assert.equal(isUsable(exhausted), false);
  assert.equal(selected.account.name, "account1", "usable active accounts beat an inactive exhausted account");
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const result = spawnSync(process.execPath, [cx, "--account", "5", "--dry-run"], {
    env: cleanEnv({ CX_ACCOUNT_COUNT: "5" }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /CODEX_HOME=.*\.codex-account5 codex/);
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cx-standalone-"));
  const standalone = path.join(tempDir, "cx");
  fs.copyFileSync(cx, standalone);
  fs.chmodSync(standalone, 0o755);

  const result = spawnSync(process.execPath, [standalone, "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const result = spawnSync(process.execPath, [cx, "--account", "work", "--dry-run"], {
    env: cleanEnv({ CX_ACCOUNT_HOMES: "work=~/cx-work,backup=/tmp/cx-backup" }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /CODEX_HOME=.*cx-work codex/);
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const result = spawnSync(process.execPath, [cx, "--dry-run"], {
    env: cleanEnv({ CX_ACCOUNT_HOMES: "work=" }),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /CX_ACCOUNT_HOMES entries must include a path/);
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-empty-home-"));
  const result = spawnSync(process.execPath, [cx, "status"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No Codex account homes found/);
  assert.match(result.stderr, /cx-setup --accounts <N> --migrate/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-discover-home-"));
  fs.mkdirSync(path.join(tempHome, ".codex-account4"));
  fs.mkdirSync(path.join(tempHome, ".codex-account7"));

  const bySuffix = spawnSync(process.execPath, [cx, "--account", "7", "--dry-run", "exec", "hello"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });
  const byIndex = spawnSync(process.execPath, [cx, "--account", "1", "--dry-run", "exec", "hello"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(bySuffix.status, 0);
  assert.match(bySuffix.stderr, new RegExp(`${tempHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.codex-account7`));
  assert.equal(byIndex.status, 0);
  assert.match(byIndex.stderr, new RegExp(`${tempHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.codex-account4`));
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  const args = ["exec", "implement feature"];

  assert.deepEqual(
    retryArgsAfterRateLimit(args, accountHome, { minMtimeMs: Date.now() - 1000 }),
    args,
    "without a current session file, retry the original command instead of resuming an unrelated session",
  );

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("implement feature"), assistantMessage("done"), taskComplete()]);

  assert.deepEqual(
    retryArgsAfterRateLimit(["exec", "implement feature"], accountHome, { minMtimeMs: Date.now() - 1000 }),
    ["exec", "resume", "--last"],
    "completed exec turns resume the session without replaying the prompt",
  );

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("implement feature")]);

  const retryArgs = retryArgsAfterRateLimit(["exec", "--json", "implement feature"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(retryArgs.slice(0, 4), ["exec", "resume", "--json", "--last"]);
  assert.match(
    retryArgs.at(-1),
    /Continue the interrupted task/,
    "incomplete exec turns resume and explicitly continue the pending instruction",
  );

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("implement feature")]);

  const retryArgs = retryArgsAfterRateLimit(["exec", "--color", "never", "--json", "implement feature"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(
    retryArgs.slice(0, 4),
    ["exec", "resume", "--json", "--last"],
    "exec-only value options are parsed but not replayed to exec resume when unsupported",
  );
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("finish docs")]);

  const retryArgs = retryArgsAfterRateLimit(["-m", "gpt-5", "finish docs"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(retryArgs.slice(0, 4), ["-m", "gpt-5", "resume", "--last"]);
  assert.match(
    retryArgs.at(-1),
    /Continue the interrupted task/,
    "incomplete interactive turns preserve global options and continue the pending instruction",
  );

  fs.rmSync(accountHome, { recursive: true, force: true });
}
