import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";

import { z } from "zod";

import { jsonContent, errorContent } from "../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { registerWorkRecordReadTools } from "../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";

function buildHandler(workspaceDir) {
  const handlers = new Map();
  registerWorkRecordReadTools({
    registerTool: (name, _def, handler) => {
      handlers.set(name, handler);
    },
    workspaceRepos: [{ repo: "test/fixture", dir: workspaceDir }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: (repos) => repos[0],
    createCompactValidateDispatchResponse: () => ({})
  });
  const handler = handlers.get("workspace_run_validation");
  assert.ok(handler, "workspace_run_validation must be registered");
  return handler;
}

const PASSING_TEST = `import test from "node:test";\ntest("passes", () => {});\n`;
const FAILING_TEST = `import test from "node:test";\nimport assert from "node:assert/strict";\ntest("fails", () => { assert.equal(1, 2); });\n`;
const CHECK_FAIL = `export const broken = ;\n`;

async function setupWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk1205-node-test-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "wk1205-outside-"));

  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });

  const record = {
    schema_version: "work-record.v1",
    id: "WK-9001",
    title: "node_test fixture",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    slices: [
      {
        id: "SLICE-001",
        title: "fixture slice",
        work_kind: "implementation",
        status: "todo",
        sections: {
          structured_validation: {
            allowed: [
              { command: "node_test", target: "passing.test.mjs" },
              { command: "node_test", target: "checkfail.mjs" },
              { command: "node_test", target: "testfail.test.mjs" },

              { command: "other_command", target: "other-only.test.mjs" }
            ]
          }
        }
      }
    ],
    sections: {
      structured_validation: {
        allowed: [{ command: "node_test", target: "record-level.test.mjs" }]
      }
    }
  };
  await writeFile(
    path.join(root, "wiki", "work-records", "WK-9001.json"),
    `${JSON.stringify(record, null, 2)}\n`
  );

  await writeFile(path.join(root, "passing.test.mjs"), PASSING_TEST);
  await writeFile(path.join(root, "record-level.test.mjs"), PASSING_TEST);
  await writeFile(path.join(root, "testfail.test.mjs"), FAILING_TEST);
  await writeFile(path.join(root, "checkfail.mjs"), CHECK_FAIL);
  await writeFile(path.join(root, "other-only.test.mjs"), PASSING_TEST);

  await writeFile(path.join(root, "unlisted.mjs"), "export const x = 1;\n");
  await writeFile(path.join(root, "notes.txt"), "not javascript\n");

  await writeFile(path.join(outside, "outside.mjs"), "export const y = 2;\n");
  await symlink(path.join(outside, "outside.mjs"), path.join(root, "escape.mjs"));

  const handler = buildHandler(root);
  const cleanup = async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  };
  return { root, outside, handler, cleanup };
}

function assertErrorResult(result, pattern) {
  assert.equal(result.isError, true, "expected an MCP error result");
  assert.equal(result.content[0].type, "text");
  if (pattern) {
    assert.match(result.content[0].text, pattern);
  }
}

test("authorized node_test runs node --check then node --test and reports success", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-001", target: "passing.test.mjs" });
  assert.equal(result.isError, undefined);
  const out = result.structuredContent;
  assert.equal(out.tool, "workspace_run_validation");
  assert.equal(out.command, "node_test");
  assert.equal(out.unit, "WK-9001#SLICE-001");
  assert.equal(out.target, "passing.test.mjs");
  assert.equal(out.ok, true);

  const [checkStep, testStep] = out.steps;

  assert.deepEqual(checkStep.argv, ["node", "--check", "passing.test.mjs"]);
  assert.deepEqual(testStep.argv, ["node", "--test", "passing.test.mjs"]);
  assert.equal(checkStep.ok, true);
  assert.equal(checkStep.exit_code, 0);
  assert.equal(testStep.ran, true);
  assert.equal(testStep.skipped, false);
  assert.equal(testStep.ok, true);
  assert.equal(testStep.exit_code, 0);
});

test("record-level allowed[] authorizes a node_test target addressed by bare WK id", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001", target: "record-level.test.mjs" });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.unit, "WK-9001");
  assert.equal(result.structuredContent.ok, true);
});

test("authorization is per-unit: a record-level target is not allowed for a slice", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-001", target: "record-level.test.mjs" });
  assertErrorResult(result, /not authorized by the work contract/);
});

test("slice id matching is case-insensitive against the canonical slice id", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#slice-001", target: "passing.test.mjs" });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.ok, true);
});

test("a failing node --check short-circuits and skips node --test", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-001", target: "checkfail.mjs" });
  assert.equal(result.isError, undefined);
  const out = result.structuredContent;
  assert.equal(out.ok, false);
  const [checkStep, testStep] = out.steps;
  assert.equal(checkStep.ok, false);
  assert.notEqual(checkStep.exit_code, 0);
  assert.equal(testStep.ran, false);
  assert.equal(testStep.skipped, true);
  assert.match(testStep.skipped_reason, /node --check failed/);
});

test("a failing node --test produces structured failure evidence with overall ok=false", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-001", target: "testfail.test.mjs" });
  assert.equal(result.isError, undefined);
  const out = result.structuredContent;
  assert.equal(out.ok, false);
  const [checkStep, testStep] = out.steps;
  assert.equal(checkStep.ok, true);
  assert.equal(testStep.ran, true);
  assert.equal(testStep.ok, false);
  assert.notEqual(testStep.exit_code, 0);
});

test("an existing but unlisted target is denied", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-001", target: "unlisted.mjs" });
  assertErrorResult(result, /not authorized by the work contract/);
});

test("a node_test target is not authorized by a different command's allowed entry", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-001", target: "other-only.test.mjs" });
  assertErrorResult(result, /not authorized by the work contract/);
});

test("a non-js/mjs target is rejected", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-001", target: "notes.txt" });
  assertErrorResult(result, /must be a \.js or \.mjs file/);
});

test("a lexical path escape is rejected", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-001", target: "../escape.mjs" });
  assertErrorResult(result, /escapes the workspace repo/);
});

test("a symlink that resolves outside the repo is rejected", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-001", target: "escape.mjs" });
  assertErrorResult(result, /resolves outside the workspace repo/);
});

test("an absolute target is rejected", async (t) => {
  const { root, handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({
    unit: "WK-9001#SLICE-001",
    target: path.join(root, "passing.test.mjs")
  });
  assertErrorResult(result, /must be repo-relative/);
});

test("a target with shell metacharacters cannot inject a command", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({
    unit: "WK-9001#SLICE-001",
    target: "passing.test.mjs; touch pwned.mjs"
  });
  assertErrorResult(result);
});

test("caller-supplied authority-shaped fields are rejected", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const forbiddenFields = [
    "snapshot",
    "authoritySnapshot",
    "validation_authority",
    "authority",
    "runtime_policy",
    "runtimePolicy",
    "launcherRuntimePolicy",
    "policy",
    "env",
    "runtime_env",
    "runtimeDirs",
    "runtime_dirs",
    "node_binary",
    "nodeBinary",
    "workspace_identity",
    "source_digest",
    "timeout",
    "outputCap",
    "cwd",
    "workspaceRoot",
    "args"
  ];

  for (const field of forbiddenFields) {
    const result = await handler({
      unit: "WK-9001#SLICE-001",
      target: "passing.test.mjs",
      [field]: "anything"
    });
    assertErrorResult(result, new RegExp(`authority fields: .*\\b${field}\\b`));
  }
});

test("a forged authority field cannot expand the allowed target set", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const forged = await handler({
    unit: "WK-9001#SLICE-001",
    target: "unlisted.mjs",
    snapshot: { allowed: [{ command: "node_test", target: "unlisted.mjs" }] },
    validation_authority: { allowed: [{ command: "node_test", target: "unlisted.mjs" }] }
  });
  assertErrorResult(forged, /authority fields/);
});

test("the tool is family-neutral: unknown family-shaped input does not change behavior", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const asCodex = await handler({
    unit: "WK-9001#SLICE-001",
    target: "passing.test.mjs",
    family: "codex"
  });
  const asClaude = await handler({
    unit: "WK-9001#SLICE-001",
    target: "passing.test.mjs",
    family: "claude"
  });
  assert.equal(asCodex.isError, undefined);
  assert.equal(asClaude.isError, undefined);
  assert.equal(asCodex.structuredContent.ok, true);
  assert.equal(asClaude.structuredContent.ok, true);
  assert.deepEqual(asCodex.structuredContent.steps[0].argv, asClaude.structuredContent.steps[0].argv);
});

test("a missing target is rejected", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-001", target: "does-not-exist.mjs" });
  assertErrorResult(result, /does not exist/);
});

test("an unknown unit fails closed", async (t) => {
  const { handler, cleanup } = await setupWorkspace();
  t.after(cleanup);

  const result = await handler({ unit: "WK-9001#SLICE-404", target: "passing.test.mjs" });
  assertErrorResult(result, /could not resolve unit/);
});
