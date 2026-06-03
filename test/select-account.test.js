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
