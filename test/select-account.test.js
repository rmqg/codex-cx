"use strict";

const assert = require("assert/strict");
const { isUsable, selectResult } = require("../bin/cx");

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

{
  const selected = selectResult([
    account("account1", 1, 80),
    account("account2", 99, 10, { active: true }),
    account("account3", 20, 30),
  ]);

  assert.equal(selected.account.name, "account2", "weekly usage is the primary selection key");
}

{
  const selected = selectResult([
    account("account1", 20, 70, { active: true }),
    account("account2", 30, 20, { active: true }),
    account("account3", 10, 30, { active: true }),
  ]);

  assert.equal(selected.account.name, "account2", "all locked accounts remain selectable");
}

{
  const exhausted = account("account3", 0, 0, { reached: "primary" });
  const selected = selectResult([
    account("account1", 20, 50, { active: true }),
    account("account2", 30, 60, { active: true }),
    exhausted,
  ]);

  assert.equal(isUsable(exhausted), false);
  assert.equal(selected.account.name, "account1", "locked usable accounts beat an unlocked exhausted account");
}

{
  const selected = selectResult([
    account("account1", 40, 20),
    account("account2", 10, 20),
  ]);

  assert.equal(selected.account.name, "account2", "5h usage breaks weekly ties");
}
