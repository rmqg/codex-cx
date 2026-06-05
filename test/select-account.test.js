"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const path = require("path");
const {
  extractAccountEmail,
  isUsable,
  isUsageLimitLogLine,
  isResumeInvocation,
  limitExhaustedReason,
  logChunkHasUsageLimit,
  shouldResumeGoalStatus,
  retryArgsAfterRateLimit,
  selectResult,
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
  return { ...env, ...extra };
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
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

function userEventMessage(text) {
  return { type: "event_msg", payload: { type: "user_message", message: text } };
}

function assistantMessage(text) {
  return {
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
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
  assert.match(trusted.stderr, /-c/);
  assert.match(trusted.stderr, /trust_level="trusted"/);
  assert.match(trusted.stderr, /projects\./);

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
  writeSession(accountHome, [taskStarted(), userMessage("new request"), tokenCountWithoutCredits(), taskComplete(null)]);

  const retryArgs = retryArgsAfterRateLimit(["resume", "--last"], accountHome, {
    minMtimeMs: Date.now() - 1000,
  });

  assert.deepEqual(
    retryArgs,
    ["resume", "--last", retryArgs.at(-1)],
    "usage-limited interactive turns with task_complete but no assistant output continue through TUI resume",
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
    ["-m", "gpt-5", "resume", "--last", retryArgs.at(-1)],
    "incomplete interactive turns preserve global options and continue through TUI resume",
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
    ["resume", "--last", retryArgs.at(-1)],
    "interactive resume retries continue through TUI resume with a prompt",
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
    ["resume", "--last", retryArgs.at(-1)],
    "event_msg user_message is enough to continue an interrupted interactive turn",
  );
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
