"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseArgs, parseHomes } = require("../bin/cx-setup");

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.CX_ACCOUNT;
  delete env.CX_ACCOUNT_COUNT;
  delete env.CX_ACCOUNT_HOMES;
  delete env.CX_AUTO_MAX_SWITCHES;
  delete env.CX_LIMIT_TIMEOUT_MS;
  return { ...env, ...extra };
}

{
  const options = parseArgs([]);

  assert.equal(options.accounts, null);
  assert.equal(options.homes, null);
}

{
  const options = parseArgs(["--accounts", "5", "--full", "--migrate", "--dry-run"]);

  assert.equal(options.accounts, 5);
  assert.equal(options.full, true);
  assert.equal(options.migrate, true);
  assert.equal(options.dryRun, true);
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

assert.throws(() => parseArgs(["--accounts", "0"]), /positive integer/);
assert.throws(() => parseArgs(["--homes", ",,,"]), /at least one/);
assert.throws(() => parseArgs(["--homes", "work="]), /include a path/);

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
