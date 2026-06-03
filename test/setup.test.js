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
