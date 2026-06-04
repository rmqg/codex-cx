"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const repo = path.resolve(__dirname, "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cx-virtual-e2e-"));
const fakeBin = path.join(root, "fake-bin");
const recordsFile = path.join(root, "records.jsonl");

fs.mkdirSync(fakeBin, { recursive: true });

const fakeCodex = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME || '';
const account = path.basename(home);
const records = process.env.FAKE_RECORDS;
function append(data) { if (records) fs.appendFileSync(records, JSON.stringify(data) + '\\n'); }
function send(data) { process.stdout.write(JSON.stringify(data) + '\\n'); }
function limits() { return JSON.parse(process.env.FAKE_LIMITS || '{}')[account] || { p: 99, s: 99, r: '' }; }
function logDir() {
  const index = args.findIndex((arg) => arg === '-c');
  const value = index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith('log_dir='));
  if (!value || !value.startsWith('log_dir=')) return null;
  const encoded = value.slice('log_dir='.length);
  try { return JSON.parse(encoded); } catch { return encoded; }
}
function writeIncompleteSession() {
  const dir = path.join(home, 'sessions', '2026', '06', '04');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'rollout-e2e.jsonl'), [
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-e2e' } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'implement feature' }] } })
  ].join('\\n') + '\\n');
}
function writeLog(line) {
  const dir = logDir();
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'codex-tui.log'), line + '\\n');
}
if (args[0] === 'app-server') {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    for (;;) {
      const nl = buf.indexOf('\\n');
      if (nl < 0) break;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.method === 'initialize') send({ id: msg.id, result: { ok: true } });
      if (msg.method === 'account/rateLimits/read') {
        const x = limits();
        send({ id: msg.id, result: { rateLimitsByLimitId: { codex: {
          primary: { usedPercent: x.p },
          secondary: { usedPercent: x.s },
          rateLimitReachedType: x.r || ''
        } } } });
      }
    }
  });
} else if (args[0] === 'hold') {
  append({ type: 'hold', home, args });
  setInterval(() => {}, 1000);
} else {
  append({ type: 'run', home, args });
  if (process.env.FAKE_TOOL_TEXT_LOG === '1') {
    const first = 'usage';
    const second = 'limit';
    writeLog('2026-06-04T01:00:00Z INFO codex_core::stream_events_utils: ToolCall: exec_command {"cmd":"rg ' + first + ' ' + second + ' /tmp"}');
    process.exit(7);
  }
  if (account === process.env.FAKE_LIMIT_ACCOUNT) {
    writeIncompleteSession();
    writeLog('2026-06-04T01:00:00Z ERROR session_loop: Turn error: workspace_owner_credits_depleted');
    process.exit(0);
  }
  process.exit(0);
}
`;

fs.writeFileSync(path.join(fakeBin, "codex"), fakeCodex, { mode: 0o755 });

const defaultLimits = {
  ".codex-account1": { p: 4, s: 1, r: "" },
  ".codex-account2": { p: 11, s: 2, r: "" },
  ".codex-account3": { p: 8, s: 1, r: "" },
  ".codex-account4": { p: 100, s: 49, r: "workspace_owner_credits_depleted" },
};

const envBase = {
  ...process.env,
  HOME: root,
  PATH: `${path.join(repo, "bin")}:${fakeBin}:${process.env.PATH}`,
  FAKE_RECORDS: recordsFile,
  FAKE_LIMITS: JSON.stringify(defaultLimits),
  CX_LIMIT_TIMEOUT_MS: "3000",
  CX_AUTO_MAX_SWITCHES: "6",
};

for (const key of ["CX_ACCOUNT", "CX_ACCOUNT_COUNT", "CX_ACCOUNT_HOMES", "CX_NO_BYPASS"]) {
  delete envBase[key];
}
delete envBase.CX_INTERACTIVE_AUTO_EXEC;

function run(cmd, args, extraEnv = {}) {
  return spawnSync(cmd, args, { cwd: root, env: { ...envBase, ...extraEnv }, encoding: "utf8" });
}

function ok(cmd, args, extraEnv = {}) {
  const result = run(cmd, args, extraEnv);
  assert.equal(result.status, 0, `${cmd} ${args.join(" ")}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return result;
}

function readRecords() {
  if (!fs.existsSync(recordsFile)) {
    return [];
  }
  return fs.readFileSync(recordsFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

function clearRecords() {
  fs.rmSync(recordsFile, { force: true });
}

function assertLink(link, target) {
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, `${link} should be symlink`);
  assert.equal(path.resolve(path.dirname(link), fs.readlinkSync(link)), target, `${link} target`);
}

function runVirtualE2e() {
  ok("cx-setup", ["--accounts", "4", "--full", "--migrate"]);
  const sharedItems = [
    "sessions",
    "archived_sessions",
    "memories",
    "skills",
    "shell_snapshots",
    "cache",
    "generated_images",
    "history.jsonl",
    "models_cache.json",
    "log",
    "goals_1.sqlite",
    "goals_1.sqlite-shm",
    "goals_1.sqlite-wal",
    "logs_2.sqlite",
    "logs_2.sqlite-shm",
    "logs_2.sqlite-wal",
    "memories_1.sqlite",
    "memories_1.sqlite-shm",
    "memories_1.sqlite-wal",
    "state_5.sqlite",
    "state_5.sqlite-shm",
    "state_5.sqlite-wal",
  ];
  for (let i = 1; i <= 4; i += 1) {
    const home = path.join(root, `.codex-account${i}`);
    fs.writeFileSync(path.join(home, "auth.json"), `auth-${i}\n`);
    for (const item of sharedItems) {
      assertLink(path.join(home, item), path.join(root, ".codex", item));
    }
    assert.equal(fs.lstatSync(path.join(home, "auth.json")).isSymbolicLink(), false);
  }
  ok("cx-setup", ["--accounts", "4", "--full", "--migrate"]);

  let result = ok("cx", ["status"]);
  assert.match(result.stderr, /account4\s+-\s+100%\s+49%\s+5h>=100%/);

  const holder = spawn(path.join(fakeBin, "codex"), ["hold"], {
    env: { ...envBase, CODEX_HOME: path.join(root, ".codex-account2") },
    stdio: "ignore",
  });
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    result = ok("cx", ["status"]);
    assert.match(result.stderr, /account2\s+yes/);
  } finally {
    holder.kill("SIGTERM");
  }

  result = ok("cxa", ["--dry-run", "exec", "hello"]);
  assert.match(result.stderr, /selected account1/);
  assert.match(result.stderr, /exec hello/);

  result = ok("cx", ["--account", "4", "--dry-run", "--no-bypass", "exec", "hello"]);
  assert.match(result.stderr, /\.codex-account4/);
  assert.doesNotMatch(result.stderr, /dangerously-bypass/);

  result = ok("cx", ["--account", "1", "--dry-run", "--", "--dry-run", "exec", "hello"]);
  assert.match(result.stderr, /--dry-run exec hello/);

  const exhaustedLimits = JSON.stringify({
    ".codex-account1": { p: 100, s: 1, r: "" },
    ".codex-account2": { p: 10, s: 100, r: "" },
    ".codex-account3": { p: 99, s: 1, r: "primary" },
    ".codex-account4": { p: 100, s: 49, r: "workspace_owner_credits_depleted" },
  });
  result = run("cx", ["--dry-run", "exec", "blocked"], { FAKE_LIMITS: exhaustedLimits });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /All candidate accounts are exhausted or unavailable/);

  result = run("cx", ["status"], { CX_ACCOUNT_HOMES: `work=${root}/a,WORK=${root}/b` });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /duplicate account name/);
  result = run("cx-setup", ["--homes", `work=${root}/.codex`, "--dry-run"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Account home must not be the shared home/);
  result = run("cx", ["status"], { CX_LIMIT_TIMEOUT_MS: "bad" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /positive integer/);

  clearRecords();
  result = run("cxa", ["exec", "mentions tool text"], { FAKE_TOOL_TEXT_LOG: "1" });
  assert.equal(result.status, 7, result.stderr);
  assert.equal(readRecords().filter((entry) => entry.type === "run").length, 1);

  clearRecords();
  ok("cxa", ["resume", "--last"], { FAKE_LIMIT_ACCOUNT: ".codex-account1" });
  let runs = readRecords().filter((entry) => entry.type === "run");
  assert.equal(runs.length, 2, JSON.stringify(runs));
  assert.equal(path.basename(runs[0].home), ".codex-account1");
  assert.equal(path.basename(runs[1].home), ".codex-account3");
  assert.ok(runs[1].args.includes("exec"));
  assert.ok(runs[1].args.includes("resume"));
  assert.deepEqual(runs[1].args.slice(-2, -1), ["--last"]);
  assert.ok(runs[1].args.some((arg) => /Continue the interrupted task/.test(arg)));

  clearRecords();
  ok("cxa", ["exec", "implement feature"], { FAKE_LIMIT_ACCOUNT: ".codex-account1" });
  runs = readRecords().filter((entry) => entry.type === "run");
  assert.equal(runs.length, 2, JSON.stringify(runs));
  assert.equal(path.basename(runs[1].home), ".codex-account3");
  assert.ok(runs[1].args.includes("exec"));
  assert.ok(runs[1].args.includes("resume"));
  assert.ok(runs[1].args.some((arg) => /Continue the interrupted task/.test(arg)));
}

try {
  runVirtualE2e();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
