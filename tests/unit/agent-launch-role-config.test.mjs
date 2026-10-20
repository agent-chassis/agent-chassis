import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseAgentLaunchRoleConfigSource,
  readRoleDefaultModel,
  readRoleEffort
} from "../../packages/agent-launch-cli/src/lib/agent-launch-role-config.mjs";

test("model-family parsing refuses explicit routing fields without inspecting or exposing their values", () => {
  for (const key of ["app", "client", "provider", "backend", "family", "model_provider"]) {
    for (const table of ["", "[transport]\n", "[roles.worker]\n"]) {
      assert.throws(() => parseAgentLaunchRoleConfigSource(`${table}${key} = "private-do-not-print"`, {
        rejectExplicitRouting: true,
      }), error => error.code === "role_config.explicit_routing_conflict"
        && error.message.includes(key) && !error.message.includes("private-do-not-print"));
    }
  }
  const config = parseAgentLaunchRoleConfigSource('# provider = "other"\n[unrelated]\nnote = "client = other"\n'
    + '[roles.worker]\nmodel = "sonnet"\neffort = "medium"', { rejectExplicitRouting: true });
  assert.deepEqual(config.roles, { worker: "sonnet" });
  assert.deepEqual(config.efforts, { worker: "medium" });
});

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
    /invalid TOML/
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
    /invalid TOML/
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
    /invalid TOML/
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

test("native OpenCode TOML preserves nested values and accepts unfamiliar native settings", () => {
  const config = parseAgentLaunchRoleConfigSource(`
[roles.worker]
model = 'local/example-model'
[opencode.provider.local]
npm = '@ai-sdk/openai-compatible'
[opencode.provider.local.options]
baseURL = 'http://127.0.0.1:8000/v1#literal'
headers = { Authorization = 'fixture-secret', 'X-Custom' = 'yes' }
unfamiliar = [{ enabled = true, weights = [1, 2.5] }]
notes = """first
second"""
[opencode.provider.local.models.'example-model']
name = 'Example local model'
`, { rejectExplicitRouting: true });
  const options = config.opencode.provider.local.options;
  assert.equal(options.baseURL, 'http://127.0.0.1:8000/v1#literal');
  assert.equal(options.headers.Authorization, 'fixture-secret');
  assert.deepEqual(options.unfamiliar[0].weights, [1, 2.5]);
  assert.equal(options.notes, 'first\nsecond');
  assert.equal(Object.isFrozen(options.unfamiliar[0]), true);
  assert.throws(() => { options.baseURL = 'other'; }, TypeError);

  assert.equal(parseAgentLaunchRoleConfigSource('[opencode]\nprovider = 42').opencode.provider, 42);
});

test("invalid native TOML reports syntax location without secret-bearing source excerpts", () => {
  assert.throws(() => parseAgentLaunchRoleConfigSource('[opencode]\napiKey = "private-key"\nbroken = ['),
    error => error.code === 'role_config.invalid_toml' && error.detail.line_number > 0
      && !JSON.stringify(error).includes('private-key') && !error.message.includes('private-key'));
});
