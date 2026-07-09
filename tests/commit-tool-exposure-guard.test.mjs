

import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES as CODES,
  COMMIT_TOOL_EXPOSURE_GUARD_SCHEMA_VERSION,
  WORKER_COMMIT_TOOL_NAME,
  WORKER_TOOL_ALLOWLIST,
  CommitToolExposureGuardError,
  admitWorkerCommitCall,
  assertClosedInputSchema,
  constructWorkerCommitToolSurface,
  resolveServerBinding
} from "../packages/agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import {
  parseToolProfile,
  shouldExposeTool
} from "../packages/wiki-mcp/src/lib/tool-profile.mjs";

const CREDENTIAL = Object.freeze({ token: "launcher-minted-token" });
const BASE_SHA = "b".repeat(40);

function binding(overrides = {}) {
  return {
    launch_ref: "launch-WK-1430-SLICE-001",
    run_id: "wkdb_WK1430_SLICE001",
    retry_id: 0,
    output_branch: "wk/IN-0017/WK-1430",
    worktree_path: "/worktrees/WK-1430-SLICE-001",
    write_scope: ["tests/commit-tool-exposure-guard.test.mjs"],
    subject: "WK-1430#SLICE-001",
    base_sha: BASE_SHA,
    initiative: "IN-0017",
    ignored_extra: "must not leak",
    ...overrides
  };
}

function resolver(result = binding()) {
  const calls = [];
  return {
    calls,
    deps: {
      resolveBinding(credential) {
        calls.push(credential);
        return result;
      }
    }
  };
}

function expectGuardCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof CommitToolExposureGuardError);
    assert.equal(err.code, code);
    return true;
  });
}

test("closed worker input schema refuses authority-bearing fields and message bytes", () => {
  const refused = [
    ["path", CODES.WORKER_ASSERTED_BINDING],
    ["branch", CODES.WORKER_ASSERTED_BINDING],
    ["base_sha", CODES.WORKER_ASSERTED_BINDING],
    ["run_id", CODES.WORKER_ASSERTED_BINDING],
    ["launch_ref", CODES.WORKER_ASSERTED_BINDING],
    ["retry_id", CODES.WORKER_ASSERTED_BINDING],
    ["subject", CODES.WORKER_ASSERTED_BINDING],
    ["write_scope", CODES.WORKER_ASSERTED_BINDING],
    ["expected", CODES.WORKER_ASSERTED_BINDING],
    ["message", CODES.WORKER_SUPPLIED_MESSAGE],
    ["commit_message", CODES.WORKER_SUPPLIED_MESSAGE]
  ];

  for (const [key, code] of refused) {
    expectGuardCode(() => assertClosedInputSchema({ [key]: "worker-controlled" }), code);
  }

  expectGuardCode(() => assertClosedInputSchema({ surprise: true }), CODES.CLOSED_SCHEMA_VIOLATION);
  expectGuardCode(() => assertClosedInputSchema("commit this"), CODES.CLOSED_SCHEMA_VIOLATION);
  expectGuardCode(() => assertClosedInputSchema(["message"]), CODES.CLOSED_SCHEMA_VIOLATION);
  assert.doesNotThrow(() => assertClosedInputSchema());
  assert.doesNotThrow(() => assertClosedInputSchema(null));
  assert.doesNotThrow(() => assertClosedInputSchema({}));
});

test("bare commit call resolves full binding from server credential and generates trusted message", () => {
  const fake = resolver();
  const admitted = admitWorkerCommitCall({ credential: CREDENTIAL, deps: fake.deps });

  assert.deepEqual(fake.calls, [CREDENTIAL]);
  assert.equal(admitted.schema_version, COMMIT_TOOL_EXPOSURE_GUARD_SCHEMA_VERSION);
  assert.equal(admitted.tool_name, WORKER_COMMIT_TOOL_NAME);
  assert.equal(admitted.server_generated_message, `agent-launch worker delivery: WK-1430#SLICE-001 (base ${BASE_SHA.slice(0, 12)})`);
  assert.deepEqual(admitted.binding, {
    launch_ref: "launch-WK-1430-SLICE-001",
    run_id: "wkdb_WK1430_SLICE001",
    retry_id: 0,
    output_branch: "wk/IN-0017/WK-1430",
    worktree_path: "/worktrees/WK-1430-SLICE-001",
    write_scope: ["tests/commit-tool-exposure-guard.test.mjs"],
    subject: "WK-1430#SLICE-001",
    base_sha: BASE_SHA,
    initiative: "IN-0017"
  });
  assert.ok(Object.isFrozen(admitted));
  assert.ok(Object.isFrozen(admitted.binding));
  assert.ok(Object.isFrozen(admitted.binding.write_scope));
});

test("binding resolution fails closed on missing resolver, resolver throw, invalid credential, and incomplete tuple", () => {
  expectGuardCode(() => resolveServerBinding({ credential: CREDENTIAL }), CODES.MISSING_RESOLVER);
  expectGuardCode(
    () => resolveServerBinding({ credential: CREDENTIAL, deps: { resolveBinding: () => { throw new Error("boom"); } } }),
    CODES.BINDING_INCOMPLETE
  );
  expectGuardCode(() => resolveServerBinding({ credential: "", deps: resolver().deps }), CODES.INVALID_CREDENTIAL);
  expectGuardCode(() => resolveServerBinding({ credential: [], deps: resolver().deps }), CODES.INVALID_CREDENTIAL);

  const missing = binding({ base_sha: "", write_scope: [] });
  delete missing.subject;
  expectGuardCode(() => resolveServerBinding({ credential: CREDENTIAL, deps: resolver(missing).deps }), CODES.BINDING_INCOMPLETE);
});

test("worker-asserted binding components are refused before resolver authority is used", () => {
  const fake = resolver();
  expectGuardCode(
    () => admitWorkerCommitCall({ credential: CREDENTIAL, workerArgs: { run_id: "forged" }, deps: fake.deps }),
    CODES.WORKER_ASSERTED_BINDING
  );
  assert.deepEqual(fake.calls, []);
});

test("worker surface construction registers exactly commit and never instantiates excluded surfaces", () => {
  const constructed = [];
  const surface = constructWorkerCommitToolSurface({
    commitToolFactory() {
      constructed.push(WORKER_COMMIT_TOOL_NAME);
      return { name: WORKER_COMMIT_TOOL_NAME };
    }
  });

  assert.deepEqual(WORKER_TOOL_ALLOWLIST, [WORKER_COMMIT_TOOL_NAME]);
  assert.deepEqual(Object.keys(surface), [WORKER_COMMIT_TOOL_NAME]);
  assert.deepEqual(constructed, [WORKER_COMMIT_TOOL_NAME]);
  assert.ok(Object.isFrozen(surface));

  constructed.length = 0;
  expectGuardCode(
    () =>
      constructWorkerCommitToolSurface({
        requestedToolNames: [WORKER_COMMIT_TOOL_NAME, "read_file", "write_file", "list_files", "exec"],
        commitToolFactory() {
          constructed.push(WORKER_COMMIT_TOOL_NAME);
          return { name: WORKER_COMMIT_TOOL_NAME };
        }
      }),
    CODES.TOOL_SURFACE_VIOLATION
  );
  assert.deepEqual(constructed, [], "disallowed fs/exec surface request must fail before commit construction");
});

test("production worker wiki MCP profile exposes exactly commit and excludes non-commit tools", () => {
  const profile = parseToolProfile({ WIKI_MCP_TOOL_PROFILE: "worker" });
  const nonCommitWikiTools = [
    "workspace_submit_for_review",
    "workspace_read_page",
    "workspace_get_record",
    "workspace_search_repo",
    "workspace_tools_list",
    "workspace_tools_describe",
    "workspace_tools_query",
    "workspace_work_record_validate",
    "workspace_run_validation",
    "workspace_agent_dispatch",
    "workspace_agent_run_status",
    "workspace_lint_repo",
    "workspace_generate_and_lint",
    "workspace_record_review_attestation",
    "workspace_create_record"
  ];

  assert.equal(profile, "worker");
  assert.deepEqual(WORKER_TOOL_ALLOWLIST, [WORKER_COMMIT_TOOL_NAME]);
  assert.equal(shouldExposeTool(profile, WORKER_COMMIT_TOOL_NAME), true);
  for (const name of nonCommitWikiTools) {
    assert.equal(shouldExposeTool(profile, name), false, `${name} must not be registered for worker profile`);
  }
});
