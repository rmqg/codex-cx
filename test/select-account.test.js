"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const path = require("path");
const {
  extractAccountEmail,
  isApiKeyAuth,
  isUsable,
  isUsageLimitLogLine,
  isResumeInvocation,
  limitExhaustedReason,
  logChunkHasUsageLimit,
  shouldResumeGoalStatus,
  retryArgsAfterRateLimit,
  selectResult,
  ensureTrustedProjectsForCodexHome,
  trustedProjectPathsFromCodexArgs,
} = require("../bin/cx");

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
    authMode: options.authMode || "account",
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
  delete env.CX_AUTO_MAX_SWITCHES;
  delete env.CX_INTERACTIVE_AUTO_EXEC;
  delete env.CX_LIMIT_TIMEOUT_MS;
  delete env.CX_NO_TRUST;
  delete env.CODEX_TRUST_ALL;
  delete env.CX_REAL_CODEX;
  return { ...env, ...extra };
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function writeSession(accountHome, events, options = {}) {
  const dir = path.join(accountHome, "sessions", "2026", "06", "03");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, options.fileName || `rollout-test-${process.pid}-${Math.random().toString(16).slice(2)}.jsonl`);
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

function sessionMeta(id = "019eaaaa-bbbb-7ccc-8ddd-000000000001", cwd = process.cwd()) {
  return { type: "session_meta", payload: { id, cwd } };
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

function userEventMessage(text) {
  return { type: "event_msg", payload: { type: "user_message", message: text } };
}

function assistantMessage(text) {
  return {
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
  };
}

function toolCall() {
  return {
    type: "response_item",
    payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{}" },
  };
}

function taskComplete(lastAgentMessage = null) {
  return { type: "event_msg", payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: lastAgentMessage } };
}

function tokenCountWithoutCredits() {
  return {
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        credits: { has_credits: false },
        rate_limit_reached_type: null,
      },
    },
  };
}

{
  assert.equal(extractAccountEmail({ email: "direct@example.com" }), "direct@example.com");
  assert.equal(
    extractAccountEmail({ tokens: { id_token: `header.${base64UrlJson({ email: "token@example.com" })}.sig` } }),
    "token@example.com",
  );
  assert.equal(extractAccountEmail({ tokens: { id_token: "not-a-token" } }), "");
  assert.equal(isApiKeyAuth({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test" }), true);
  assert.equal(isApiKeyAuth({ auth_mode: "chatgpt" }), false);
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

  assert.equal(limitExhaustedReason(exhausted), "weekly>=100%");
  assert.equal(selected.account.name, "account2", "exhausted accounts are skipped even when usage would sort first");
}

{
  assert.equal(limitExhaustedReason(account("account1", 0, 0, { reached: "primary" })), "5h>=100%");
  assert.equal(
    limitExhaustedReason(account("account2", 100, 49, { reached: "workspace_owner_credits_depleted" })),
    "5h>=100%",
  );
  assert.equal(limitExhaustedReason(account("account3", 99, 100, { reached: "secondary_limit_reached" })), "weekly>=100%");
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
  const selected = selectResult(
    [
      account("account1", 90, 90),
      account("free", 0, 0, { authMode: "apikey" }),
    ],
    { apiKeyMode: "fallback" },
  );

  assert.equal(selected.account.name, "account1", "fallback mode prefers a usable account before API-key accounts");
}

{
  const selected = selectResult(
    [
      account("account1", 90, 90),
      account("free", 0, 0, { authMode: "apikey" }),
    ],
    { apiKeyMode: "prefer" },
  );

  assert.equal(selected.account.name, "free", "prefer mode selects API-key accounts before usable accounts");
}

{
  const selected = selectResult(
    [
      account("account1", 100, 90),
      account("free", 0, 0, { authMode: "apikey" }),
    ],
    { apiKeyMode: "fallback" },
  );

  assert.equal(selected.account.name, "free", "fallback mode uses API-key accounts after regular accounts are exhausted");
}

{
  assert.equal(isUsageLimitLogLine("Turn error: You've hit your usage limit."), true);
  assert.equal(
    isUsageLimitLogLine(
      "2026-06-04T01:00:00Z ERROR session_loop: Turn error: workspace_owner_credits_depleted",
    ),
    true,
  );
  assert.equal(
    isUsageLimitLogLine(
      "2026-06-04T03:28:15.620801Z  INFO session_loop{thread_id=019e907c}:turn{model=gpt-5.5}: codex_core::session::turn: Turn error: Your workspace is out of credits. Add credits to continue.",
    ),
    true,
  );
  assert.equal(isUsageLimitLogLine("■ Your workspace is out of credits. Add credits to continue."), true);
  assert.equal(
    isUsageLimitLogLine(
      "■ You're out of credits. Your workspace is out of credits. Add credits to continue using Codex.",
    ),
    true,
  );
  assert.equal(
    isUsageLimitLogLine(
      "■ Usage limit reached. You've reached your usage limit. Increase your limits to continue using codex.",
    ),
    true,
  );
  assert.equal(isUsageLimitLogLine("2026-06-04T03:28:15.620801Z  INFO codex_tui: Goal hit usage limits (/goal resume)"), true);
  assert.equal(isUsageLimitLogLine("Goal hit usage limits (/goal resume)"), false);
  assert.equal(isUsageLimitLogLine("ERROR: unexpected status 429 Too Many Requests"), false);
  assert.equal(
    isUsageLimitLogLine(
      "2026-06-04T01:00:00Z ERROR session_loop: Turn error: HTTP status client error (429 Too Many Requests)",
    ),
    true,
  );
  assert.equal(
    isUsageLimitLogLine(
      '2026-06-04T01:00:00Z INFO codex_core::stream_events_utils: ToolCall: exec_command {"cmd":"rg -n \\"usage limit|rate limit\\" /tmp"}',
    ),
    false,
  );
  assert.equal(
    isUsageLimitLogLine(
      '2026-06-04T01:00:00Z INFO codex_core::stream_events_utils: ToolCall: exec_command {"cmd":"printf \\"Your workspace is out of credits\\""}',
    ),
    false,
  );
  assert.equal(
    isUsageLimitLogLine(
      "2026-06-05T02:18:57.965736Z  WARN codex_core_plugins::startup_sync: GitHub HTTP sync failed for curated plugin sync; skipping export archive fallback because a local curated plugins snapshot already exists error=download curated plugins archive from https://api.github.com/repos/openai/plugins/zipball/9c1190e46c5c6d9ccad67b6155aeb532b1ccbc27 failed with status 429 Too Many Requests: You have exceeded a secondary rate limit.",
    ),
    false,
  );
  assert.equal(
    isUsageLimitLogLine(
      "致命错误：无法访问 'https://github.com/openai/plugins.git/'：GitHub HTTP sync failed for curated plugin sync: failed with status 429 Too Many Requests: You have exceeded a secondary rate limit.",
    ),
    false,
  );
  assert.equal(isUsageLimitLogLine("+Goal hit usage limits (/goal resume)"), false);
  assert.equal(
    isUsageLimitLogLine(
      "2026-06-04T01:00:00Z ERROR codex_tui: Error finding conversation path: Continue the interrupted task after a usage limit.",
    ),
    false,
  );
  assert.equal(isUsageLimitLogLine("+const rateLimitPattern = /usage limit/i;"), false);
  assert.equal(
    logChunkHasUsageLimit(
      [
        '2026-06-04T01:00:00Z INFO codex_core::stream_events_utils: ToolCall: exec_command {"cmd":"rg usage limit"}',
        "2026-06-04T01:00:01Z ERROR session_loop: Turn error: usage limit reached",
      ].join("\n"),
    ),
    true,
  );
}

{
  const accountHome = tempAccountHome();
  const startCwd = fs.mkdtempSync(path.join(os.tmpdir(), "cx-trust-start-"));
  const cdTarget = fs.mkdtempSync(path.join(os.tmpdir(), "cx-trust-cd-"));
  const paths = trustedProjectPathsFromCodexArgs(["--cd", cdTarget, "exec", "hello"], startCwd);

  assert.deepEqual(new Set(paths), new Set([fs.realpathSync.native(startCwd), fs.realpathSync.native(cdTarget)]));

  const result = ensureTrustedProjectsForCodexHome(accountHome, paths);
  const config = fs.readFileSync(path.join(accountHome, "config.toml"), "utf8");
  assert.equal(result.changed, true);
  assert.equal(config.includes(`[projects.${JSON.stringify(fs.realpathSync.native(startCwd))}]`), true);
  assert.equal(config.includes(`[projects.${JSON.stringify(fs.realpathSync.native(cdTarget))}]`), true);
  assert.equal((config.match(/trust_level = "trusted"/g) || []).length, 2);

  const second = ensureTrustedProjectsForCodexHome(accountHome, paths);
  assert.equal(second.changed, false, "trust writes should be idempotent");

  fs.rmSync(accountHome, { recursive: true, force: true });
  fs.rmSync(startCwd, { recursive: true, force: true });
  fs.rmSync(cdTarget, { recursive: true, force: true });
}

{
  assert.equal(isResumeInvocation(["resume", "--last"]), true);
  assert.equal(isResumeInvocation(["exec", "resume", "--last"]), true);
  assert.equal(isResumeInvocation(["e", "--json", "resume", "--last"]), true);
  assert.equal(isResumeInvocation(["exec", "implement feature"]), false);
  assert.equal(isResumeInvocation(["finish docs"]), false);

  assert.equal(shouldResumeGoalStatus("paused"), true);
  assert.equal(shouldResumeGoalStatus("usageLimited"), true);
  assert.equal(shouldResumeGoalStatus("blocked"), true);
  assert.equal(shouldResumeGoalStatus("active"), false);
  assert.equal(shouldResumeGoalStatus("complete"), false);
  assert.equal(shouldResumeGoalStatus("budgetLimited"), false);
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
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-help-home-"));
  fs.mkdirSync(path.join(tempHome, ".codex-account1"));
  const result = spawnSync(process.execPath, [cx, "--account", "1", "--dry-run", "exec", "--help"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /codex .*exec --help/);
  assert.doesNotMatch(result.stdout, /Usage:\n  cx /);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-delimiter-home-"));
  fs.mkdirSync(path.join(tempHome, ".codex-account1"));
  const result = spawnSync(process.execPath, [cx, "--account", "1", "--dry-run", "--", "--dry-run", "exec", "hello"], {
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /codex .*--dry-run exec hello/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-approval-home-"));
  fs.mkdirSync(path.join(tempHome, ".codex-account1"));
  const result = spawnSync(
    process.execPath,
    [cx, "--account", "1", "--dry-run", "--ask-for-approval", "never", "exec", "hello"],
    {
      env: cleanEnv({ HOME: tempHome }),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stderr, /--ask-for-approval never exec hello/);
  assert.doesNotMatch(result.stderr, /dangerously-bypass/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-trust-home-"));
  const trustedCwd = fs.mkdtempSync(path.join(os.tmpdir(), "cx-trusted-cwd-"));
  fs.mkdirSync(path.join(tempHome, ".codex-account1"));

  const trusted = spawnSync(process.execPath, [cx, "--account", "1", "--dry-run", "exec", "hello"], {
    cwd: trustedCwd,
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });
  assert.equal(trusted.status, 0);
  assert.doesNotMatch(trusted.stderr, /trust_level="trusted"/);
  assert.equal(fs.existsSync(path.join(tempHome, ".codex-account1", "config.toml")), false);

  const disabledByFlag = spawnSync(process.execPath, [cx, "--account", "1", "--dry-run", "--no-trust", "exec", "hello"], {
    cwd: trustedCwd,
    env: cleanEnv({ HOME: tempHome }),
    encoding: "utf8",
  });
  assert.equal(disabledByFlag.status, 0);
  assert.doesNotMatch(disabledByFlag.stderr, /trust_level="trusted"/);

  const disabledByEnv = spawnSync(process.execPath, [cx, "--account", "1", "--dry-run", "exec", "hello"], {
    cwd: trustedCwd,
    env: cleanEnv({ HOME: tempHome, CX_NO_TRUST: "1" }),
    encoding: "utf8",
  });
  assert.equal(disabledByEnv.status, 0);
  assert.doesNotMatch(disabledByEnv.stderr, /trust_level="trusted"/);

  fs.rmSync(tempHome, { recursive: true, force: true });
  fs.rmSync(trustedCwd, { recursive: true, force: true });
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
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-duplicate-name-"));
  const result = spawnSync(process.execPath, [cx, "status"], {
    env: cleanEnv({ CX_ACCOUNT_HOMES: `work=${tempHome}/a,WORK=${tempHome}/b` }),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /duplicate account name: WORK/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cx-duplicate-home-"));
  const result = spawnSync(process.execPath, [cx, "status"], {
    env: cleanEnv({ CX_ACCOUNT_HOMES: `work=${tempHome},backup=${tempHome}` }),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /duplicate account home/);
  fs.rmSync(tempHome, { recursive: true, force: true });
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const result = spawnSync(process.execPath, [cx, "status"], {
    env: cleanEnv({ CX_LIMIT_TIMEOUT_MS: "abc" }),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /CX_LIMIT_TIMEOUT_MS must be a positive integer/);
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const result = spawnSync(process.execPath, [cx, "status"], {
    env: cleanEnv({ CX_AUTO_MAX_SWITCHES: "0" }),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /CX_AUTO_MAX_SWITCHES must be a positive integer/);
}

{
  const cx = path.resolve(__dirname, "../bin/cx");
  const result = spawnSync(process.execPath, [cx, "status"], {
    env: cleanEnv({ CX_LIMIT_RETRIES: "0" }),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /CX_LIMIT_RETRIES must be a positive integer/);
}

{
  const result = spawnSync(
    process.execPath,
    ["-e", "process.env.CX_ACCOUNT_HOMES='broken='; require('./bin/cx'); console.log('ok')"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: cleanEnv(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ok");
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
  writeSession(accountHome, [taskStarted(), userMessage("implement feature"), assistantMessage("done"), taskComplete("done")]);

  assert.deepEqual(
    retryArgsAfterRateLimit(["exec", "implement feature"], accountHome, { minMtimeMs: Date.now() - 1000 }),
    ["exec", "resume", "--last"],
    "completed exec turns resume the session without replaying the prompt",
  );

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("new request"), tokenCountWithoutCredits(), taskComplete(null)]);

  const retryArgs = retryArgsAfterRateLimit(["resume", "--last"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(
    retryArgs,
    ["exec", "resume", "--last", retryArgs.at(-1)],
    "usage-limited interactive turns without a session id fall back to exec resume so the prompt is not parsed as an id",
  );
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [
    taskStarted(),
    userMessage("make screen capture work"),
    assistantMessage("I am updating the OBS scene."),
    toolCall(),
    userMessage("can I choose the screen capture source"),
    tokenCountWithoutCredits(),
    taskComplete(null),
  ]);

  const retryArgs = retryArgsAfterRateLimit(["resume", "--last"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(
    retryArgs,
    ["exec", "resume", "--last", retryArgs.at(-1)],
    "queued follow-ups without a session id fall back to exec resume so the prompt is not parsed as an id",
  );
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

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
  writeSession(accountHome, [taskStarted(), userMessage("resume specific session")]);

  const retryArgs = retryArgsAfterRateLimit(["exec", "resume", "019e-specific-session"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(retryArgs.slice(0, 3), ["exec", "resume", "019e-specific-session"]);
  assert.match(
    retryArgs.at(-1),
    /Continue the interrupted task/,
    "incomplete exec resume turns preserve the explicit session id",
  );

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("resume specific session")]);

  const retryArgs = retryArgsAfterRateLimit(
    ["exec", "resume", "--json", "019e-specific-session", "original prompt"],
    accountHome,
    {
      minMtimeMs: Date.now() - 1000,
    },
  );

  assert.deepEqual(retryArgs.slice(0, 4), ["exec", "resume", "--json", "019e-specific-session"]);
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("resume latest session")]);

  const retryArgs = retryArgsAfterRateLimit(["exec", "resume", "--last"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(retryArgs.slice(0, 3), ["exec", "resume", "--last"]);
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

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

  assert.deepEqual(
    retryArgs,
    ["-m", "gpt-5", "exec", "resume", "--last", retryArgs.at(-1)],
    "incomplete interactive turns without a session id preserve global options and fall back to exec resume",
  );
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("resume work")]);

  const retryArgs = retryArgsAfterRateLimit(["resume", "--last"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(
    retryArgs,
    ["exec", "resume", "--last", retryArgs.at(-1)],
    "interactive resume retries without a session id fall back to exec resume with a prompt",
  );
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("resume explicit session")]);

  const retryArgs = retryArgsAfterRateLimit(["resume", "019e-interactive-session"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(retryArgs.slice(0, 2), ["resume", "019e-interactive-session"]);
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("resume work")]);
  const previous = process.env.CX_INTERACTIVE_AUTO_EXEC;
  process.env.CX_INTERACTIVE_AUTO_EXEC = "1";

  try {
    const retryArgs = retryArgsAfterRateLimit(["resume", "--last"], accountHome, {
      minMtimeMs: Date.now() - 1000,
    });

    assert.deepEqual(
      retryArgs,
      ["exec", "resume", "--last", retryArgs.at(-1)],
      "CX_INTERACTIVE_AUTO_EXEC=1 preserves the non-interactive exec resume behavior",
    );
    assert.match(retryArgs.at(-1), /Continue the interrupted task/);
  } finally {
    if (previous === undefined) {
      delete process.env.CX_INTERACTIVE_AUTO_EXEC;
    } else {
      process.env.CX_INTERACTIVE_AUTO_EXEC = previous;
    }
    fs.rmSync(accountHome, { recursive: true, force: true });
  }
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userMessage("resume explicit session")]);
  const previous = process.env.CX_INTERACTIVE_AUTO_EXEC;
  process.env.CX_INTERACTIVE_AUTO_EXEC = "1";

  try {
    const retryArgs = retryArgsAfterRateLimit(["resume", "019e-interactive-session"], accountHome, {
      minMtimeMs: Date.now() - 1000,
    });

    assert.deepEqual(retryArgs.slice(0, 3), ["exec", "resume", "019e-interactive-session"]);
    assert.match(retryArgs.at(-1), /Continue the interrupted task/);
  } finally {
    if (previous === undefined) {
      delete process.env.CX_INTERACTIVE_AUTO_EXEC;
    } else {
      process.env.CX_INTERACTIVE_AUTO_EXEC = previous;
    }
    fs.rmSync(accountHome, { recursive: true, force: true });
  }
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted(), userEventMessage("resume event message")]);

  const retryArgs = retryArgsAfterRateLimit(["resume", "--last"], accountHome, { minMtimeMs: Date.now() - 1000 });

  assert.deepEqual(
    retryArgs,
    ["exec", "resume", "--last", retryArgs.at(-1)],
    "event_msg user_message without a session id falls back to exec resume",
  );
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  const threadId = "019eaaaa-bbbb-7ccc-8ddd-000000000123";
  writeSession(accountHome, [sessionMeta(threadId), taskStarted(), userMessage("resume exact session")]);

  const retryArgs = retryArgsAfterRateLimit(["resume", "--last"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(
    retryArgs,
    ["resume", threadId, retryArgs.at(-1)],
    "usage-limited interactive retries target the interrupted session id instead of target-account --last",
  );
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  const threadId = "019eaaaa-bbbb-7ccc-8ddd-000000000125";
  writeSession(accountHome, [taskStarted(), userMessage("resume filename session")], {
    fileName: `rollout-2026-06-03T00-00-00-${threadId}.jsonl`,
  });

  const retryArgs = retryArgsAfterRateLimit(["resume", "--last"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(
    retryArgs,
    ["resume", threadId, retryArgs.at(-1)],
    "interactive retries use the rollout filename session id when session_meta is unavailable",
  );
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  const threadId = "019eaaaa-bbbb-7ccc-8ddd-000000000124";
  writeSession(accountHome, [sessionMeta(threadId), taskStarted(), userMessage("resume exact exec session")]);

  const retryArgs = retryArgsAfterRateLimit(["exec", "implement feature"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(retryArgs.slice(0, 3), ["exec", "resume", threadId]);
  assert.match(retryArgs.at(-1), /Continue the interrupted task/);

  fs.rmSync(accountHome, { recursive: true, force: true });
}

{
  const accountHome = tempAccountHome();
  writeSession(accountHome, [taskStarted()]);

  assert.deepEqual(
    retryArgsAfterRateLimit(["finish docs"], accountHome, { minMtimeMs: Date.now() - 1000 }),
    ["finish docs"],
    "interactive prompts are replayed when the session exists but the user instruction was not recorded",
  );

  fs.rmSync(accountHome, { recursive: true, force: true });
}
