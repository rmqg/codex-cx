"use strict";

const assert = require("assert/strict");
const { isUsable, limitExhaustedReason, selectResult } = require("../bin/cx");

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

  assert.equal(selected.account.name, "account2", "active accounts remain selectable");
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
  const selected = selectResult([
    account("account1", 40, 20),
    account("account2", 10, 20),
  ]);

  assert.equal(selected.account.name, "account2", "5h usage breaks weekly ties");
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
  const selected = selectResult([
    account("account1", 20, 30, { active: true }),
    account("account2", 20, 30),
  ]);

  assert.equal(selected.account.name, "account2", "active state is only a final tie-breaker");
}
