const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve("src/pages/CodexAccountsPage.tsx"),
  "utf8",
);
const panelStart = source.indexOf("const renderCodexAutoSwitchSettings = () =>");
const panelEnd = source.indexOf("\n  return (\n    <div", panelStart);

assert.notEqual(panelStart, -1, "auto-switch panel renderer must exist");
assert.notEqual(panelEnd, -1, "auto-switch panel renderer must have a stable end");

const panelSource = source.slice(panelStart, panelEnd);

test("Codex auto-switch panel never exposes backend quota window keys", () => {
  assert.doesNotMatch(panelSource, /\bprimary_window\b/);
  assert.doesNotMatch(panelSource, /\bsecondary_window\b/);
  assert.match(panelSource, /codex\.quota\.hourly/);
  assert.match(panelSource, /codex\.quota\.weekly/);
});

test("Codex auto-switch scope description interpolates the current status", () => {
  assert.match(
    panelSource,
    /codexAutoSwitchAccountScopeDesc[\s\S]*?status:\s*autoSwitchStatusLabel/,
  );
  assert.match(panelSource, /autoSwitchStatusLabel[\s\S]*?common\.enabled/);
  assert.match(panelSource, /autoSwitchStatusLabel[\s\S]*?common\.disabled/);
});

test("Codex auto-switch refresh choices use localized units", () => {
  assert.match(panelSource, /wakeup\.refreshInterval\.minutes/);
  assert.doesNotMatch(panelSource, /label:\s*"(?:2|5|10|15) 分钟"/);
});
