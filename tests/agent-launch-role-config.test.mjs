import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readRoleDefaultModel,
  readRoleEffort
} from "../packages/agent-launch-cli/src/lib/agent-launch-role-config.mjs";

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-launch-role-config-"));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("reads a role default model from agent-launch.toml", () => {
  const dir = makeRepo();
  writeFileSync(
    path.join(dir, "agent-launch.toml"),
    [
      "[roles.worker]",
      'model = "gpt-5.5"',
      'effort = "medium"',
      "",
      "[roles.reviewer]",
      'model = "gpt-5.4"',
      'effort = "high"',
      "",
      "[roles.orchestrator]",
      'model = "opus"',
      "",
      "[roles.redteam]",
      'model = "opus"',
      'effort = "max"'
    ].join("\n"),
    "utf8"
  );

  assert.equal(readRoleDefaultModel("worker", { dir }), "gpt-5.5");
  assert.equal(readRoleEffort("worker", { dir }), "medium");
  assert.equal(readRoleDefaultModel("review", { dir }), "gpt-5.4");
  assert.equal(readRoleEffort("review", { dir }), "high");
  assert.equal(readRoleDefaultModel("orchestrator", { dir }), "opus");
  assert.equal(readRoleEffort("orchestrator", { dir }), null);
  assert.equal(readRoleDefaultModel("redteam", { dir }), "opus");
  assert.equal(readRoleEffort("redteam", { dir }), "max");
  assert.equal(readRoleDefaultModel("unknown", { dir }), null);
  assert.equal(readRoleEffort("unknown", { dir }), null);
});

 test("relative dirs do not read cwd-relative agent-launch.toml", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-launch-role-config-relative-"));
  test.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(
    path.join(dir, "agent-launch.toml"),
    ["[roles.worker]", 'model = "cwd-model"'].join("\n"),
    "utf8"
  );
  const relativeDir = path.relative(process.cwd(), dir);

  const failIfRead = (filePath) => {
    throw new Error(`unexpected cwd-relative role config read: ${filePath}`);
  };

  assert.equal(
    readRoleDefaultModel("worker", { dir: relativeDir, readFileText: failIfRead }),
    null
  );
  assert.equal(
    readRoleEffort("worker", { dir: relativeDir, readFileText: failIfRead }),
    null
  );
});

test("unknown role tables hard-error while loading agent-launch.toml", () => {
  const dir = makeRepo();
  writeFileSync(
    path.join(dir, "agent-launch.toml"),
    ["[roles.decider]", 'model = "gpt-5.5"'].join("\n"),
    "utf8"
  );

  assert.throws(
    () => readRoleDefaultModel("worker", { dir }),
    /unknown role decider/
  );
});

test("duplicate role tables hard-error while loading agent-launch.toml", () => {
  const dir = makeRepo();
  writeFileSync(
    path.join(dir, "agent-launch.toml"),
    ["[roles.worker]", 'model = "gpt-5.5"', "[roles.worker]", 'model = "opus"'].join("\n"),
    "utf8"
  );

  assert.throws(
    () => readRoleDefaultModel("worker", { dir }),
    /duplicate \[roles\.worker\] table/
  );
});

test("duplicate role keys hard-error while loading agent-launch.toml", () => {
  const dir = makeRepo();
  writeFileSync(
    path.join(dir, "agent-launch.toml"),
    ["[roles.worker]", 'model = "gpt-5.5"', 'model = "opus"'].join("\n"),
    "utf8"
  );

  assert.throws(
    () => readRoleDefaultModel("worker", { dir }),
    /duplicate model for role worker/
  );
});

test("duplicate effort keys hard-error while loading agent-launch.toml", () => {
  const dir = makeRepo();
  writeFileSync(
    path.join(dir, "agent-launch.toml"),
    ["[roles.worker]", 'model = "gpt-5.5"', 'effort = "medium"', 'effort = "high"'].join("\n"),
    "utf8"
  );

  assert.throws(
    () => readRoleEffort("worker", { dir }),
    /duplicate effort for role worker/
  );
});

test("missing model hard-errors while loading a role table", () => {
  const dir = makeRepo();
  writeFileSync(
    path.join(dir, "agent-launch.toml"),
    ["[roles.worker]", 'effort = "high"'].join("\n"),
    "utf8"
  );

  assert.throws(
    () => readRoleDefaultModel("worker", { dir }),
    /\[roles\.worker\] must declare model/
  );
});

test("empty model hard-errors while loading a role table", () => {
  const dir = makeRepo();
  writeFileSync(
    path.join(dir, "agent-launch.toml"),
    ["[roles.worker]", 'model = ""'].join("\n"),
    "utf8"
  );

  assert.throws(
    () => readRoleDefaultModel("worker", { dir }),
    /role worker model must be non-empty/
  );
});

test("unknown role effort hard-errors while loading agent-launch.toml", () => {
  const dir = makeRepo();
  writeFileSync(
    path.join(dir, "agent-launch.toml"),
    ["[roles.worker]", 'model = "gpt-5.5"', 'effort = "turbo"'].join("\n"),
    "utf8"
  );

  assert.throws(
    () => readRoleEffort("worker", { dir }),
    /effort turbo is not in low\|medium\|high\|xhigh\|max/
  );
});
