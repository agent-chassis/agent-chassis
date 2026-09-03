

import test from "node:test";
import assert from "node:assert/strict";
import { WORKER_COMMIT_TOOL_NAME } from "../../packages/agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import { WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION } from "../../packages/wiki-mcp/src/lib/workspace-commit-tool.mjs";
import {
  ASSIGNED_UNIT,
  BASE_SHA,
  COMMIT_SHA,
  TREE_SHA,
  WORKSPACE_DIR,
  exactFullSliceBinding,
  exactSliceBinding,
  installIdentityStoreEnv,
  installState,
  registerCommitTool,
  saveCommitEnv
} from "../helpers/workspace-commit-function-contract-harness.mjs";

test("WK-1537#SLICE-009 closed-input commit composition signal is bounded and immutable", () => {
  assert.equal(Object.isFrozen(WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION), true);
  assert.deepEqual(WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION, {
    schema_version: "workspace-closed-input-commit-composition.v1",
    installed: true,
    tool_name: WORKER_COMMIT_TOOL_NAME,
    input_contract: "closed",
    binding_authority: "server_resolved"
  });
  assert.equal(Object.prototype.hasOwnProperty.call(
    WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION,
    "ref"
  ), false);
  assert.equal(Object.prototype.hasOwnProperty.call(
    WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION,
    "setAvailable"
  ), false);
});

test("WK-1537#SLICE-010 registered description pins exact-slice tuple-resolved delivery", async (t) => {
  const tool = await registerCommitTool(t);
  const description = tool.config.description;

  assert.match(description, /exact slice/);
  assert.match(description, /Materialize and verify the launcher-bound delta/);
  assert.match(description, /advance only the launcher-bound delivery ref/);
  assert.match(description, /successful commit is submit-for-review/);
  assert.match(description, /does not advance the WK ref or authorize integration/);
  assert.match(description, /exact committed slice target must receive a clean findings-only review/);
  assert.match(description, /serialized binding/);
});

test("commit tool is closed-input and accepts no worker-supplied authority fields", async (t) => {
  const binding = exactSliceBinding();
  installIdentityStoreEnv(t, binding);
  const state = installState({ binding });
  const tool = await registerCommitTool(t);

  assert.deepEqual(Object.keys(tool.config.inputSchema?.shape ?? {}), [], "commit input schema must be empty");

  const result = await tool.handler({ branch: "main", write_scope: ["packages/**"], subject: "WK-0001" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /worker-asserted binding component is refused/);
  assert.deepEqual(state.calls, [], "closed input refusal must happen before server binding resolution");
});

test("identity-store exact-slice binding projects subject only after complete identity agreement", async (t) => {
  const binding = exactSliceBinding({
    output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
  });
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    advanced: {
      base_sha: BASE_SHA,
      commit: COMMIT_SHA,
      tree: TREE_SHA,
      ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
      idempotent: false
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.structuredContent.committed, true);
  assert.equal(result.structuredContent.submitted_for_review, true);
  assert.equal(result.structuredContent.assigned_unit, ASSIGNED_UNIT);
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding",
    "materialize",
    "verify_measure",
    "commit_slice_ref",
    "transition"
  ]);
  assert.deepEqual(state.calls[0].args, {
    mainRepo: WORKSPACE_DIR,
    launchRef: binding.launch_ref,
    runId: binding.run_id,
    retryId: binding.retry_id
  });
  assert.equal(
    state.calls.find((call) => call.op === "materialize").args.message,
    `agent-launch worker delivery: ${ASSIGNED_UNIT} (base ${BASE_SHA.slice(0, 12)})\n\nWk-Slice: ${ASSIGNED_UNIT}`
  );
  assert.equal(Object.prototype.hasOwnProperty.call(binding, "subject"), false, "stored binding remains unchanged");
});

test("WK-1622#SLICE-004 identity-store v2 full-checkout binding commits with a null sparse projection", async (t) => {
  const binding = exactFullSliceBinding();
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    advanced: {
      base_sha: BASE_SHA,
      commit: COMMIT_SHA,
      tree: TREE_SHA,
      ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
      idempotent: false
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.structuredContent.committed, true);
  assert.equal(result.structuredContent.submitted_for_review, true);
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding",
    "materialize",
    "verify_measure",
    "commit_slice_ref",
    "transition"
  ]);
  const materialize = state.calls.find((call) => call.op === "materialize").args;
  assert.equal(materialize.sparseBinding, null, "a v2 full-checkout binding materializes with a null sparse projection");
});

test("WK-1622#SLICE-004 identity-store binding mixing v1 sparse and v2 full markers fails closed", async (t) => {
  const mixed = exactFullSliceBinding({ cone_dirs: ["tests"], index_sparse: false });
  installIdentityStoreEnv(t, mixed);
  const state = installState({ binding: mixed });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /credential->binding resolver threw/);
  assert.deepEqual(
    state.calls.map((call) => call.op),
    ["resolve_binding"],
    "a mixed v1/v2 marker binding fails closed before materialization"
  );
});

test("WK-1622#SLICE-009 identity-store checkout discriminator fails closed on every non-exact shape (RV-002)", async (t) => {
  const cases = [
    ["schema-less (markers only, no version)", (binding) => { delete binding.schema_version; }],
    ["schema-less and marker-less", (binding) => {
      delete binding.schema_version;
      delete binding.cone_dirs;
      delete binding.index_sparse;
    }],
    ["unknown schema_version", (binding) => { binding.schema_version = "worktree-identity-binding.v3"; }],
    ["non-string schema_version", (binding) => { binding.schema_version = 1; }],
    ["v1 missing cone_dirs", (binding) => { delete binding.cone_dirs; }],
    ["v1 missing index_sparse", (binding) => { delete binding.index_sparse; }],
    ["v1 missing both sparse pins", (binding) => {
      delete binding.cone_dirs;
      delete binding.index_sparse;
    }],
    ["v1 carrying the v2 checkout_mode marker", (binding) => { binding.checkout_mode = "full"; }],
    ["v1 index_sparse pinned true", (binding) => { binding.index_sparse = true; }],
    ["v2 version under v1 sparse markers", (binding) => {
      binding.schema_version = "worktree-identity-binding.v2";
    }],
    ["v1 version under v2 full markers", (binding) => {
      delete binding.cone_dirs;
      delete binding.index_sparse;
      binding.checkout_mode = "full";
    }],
    ["v2 missing checkout_mode", (binding) => {
      delete binding.cone_dirs;
      delete binding.index_sparse;
      binding.schema_version = "worktree-identity-binding.v2";
    }],
    ["v2 checkout_mode not exactly \"full\"", (binding) => {
      delete binding.cone_dirs;
      delete binding.index_sparse;
      binding.schema_version = "worktree-identity-binding.v2";
      binding.checkout_mode = "sparse";
    }],
    ["v2 carrying a lone cone_dirs pin", (binding) => {
      delete binding.index_sparse;
      binding.schema_version = "worktree-identity-binding.v2";
      binding.checkout_mode = "full";
    }],
    ["v2 carrying a lone index_sparse pin", (binding) => {
      delete binding.cone_dirs;
      binding.schema_version = "worktree-identity-binding.v2";
      binding.checkout_mode = "full";
    }]
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async (t) => {
      const binding = exactSliceBinding();
      mutate(binding);
      installIdentityStoreEnv(t, binding);
      const state = installState({ binding });
      const tool = await registerCommitTool(t);

      const result = await tool.handler({});
      assert.equal(result.isError, true, `${name} must fail closed`);
      assert.match(result.content[0].text, /credential->binding resolver threw/);
      assert.deepEqual(
        state.calls.map((call) => call.op),
        ["resolve_binding"],
        "the checkout-shape refusal must precede materialization and ref mutation"
      );
    });
  }
});

test("WK-1622#SLICE-009 identity-store discriminator fails closed on extended and incomplete key sets (RV-002)", async (t) => {
  const cases = [
    ["v1 with an arbitrary extra field", () => exactSliceBinding({ smuggled_field: "attacker" })],
    ["v2 with an arbitrary extra field", () => exactFullSliceBinding({ smuggled_field: "attacker" })],

    ["v1 carrying serialized-binding-only fields", () => exactSliceBinding({
      worktreePath: "/worktrees/WK-1429-SLICE-004",
      gitDir: "/git/worktrees/WK-1429-SLICE-004"
    })],
    ["v1 carrying a caller-supplied expected envelope", () => exactSliceBinding({
      expected: { schema_version: "expected-envelope.v1", declared_metrics: { changed_line_count: 150 } }
    })],
    ["v1 missing a required identity field", () => {
      const binding = exactSliceBinding();
      delete binding.base_ref;
      return binding;
    }],
    ["v2 missing a required identity field", () => {
      const binding = exactFullSliceBinding();
      delete binding.source_digest;
      return binding;
    }],

    ["v1 carrying the removed run_authority stamp", () => exactSliceBinding({
      retry_id: 1, run_authority: "b9f1c0de-0000-4000-8000-000000000001"
    })],
    ["v2 carrying the removed run_authority stamp", () => exactFullSliceBinding({
      retry_id: 1, run_authority: "b9f1c0de-0000-4000-8000-000000000002"
    })]
  ];

  for (const [name, build] of cases) {
    await t.test(name, async (t) => {
      const binding = build();
      installIdentityStoreEnv(t, binding);
      const state = installState({ binding });
      const tool = await registerCommitTool(t);

      const result = await tool.handler({});
      assert.equal(result.isError, true, `${name} must fail closed`);
      assert.match(result.content[0].text, /credential->binding resolver threw/);
      assert.deepEqual(
        state.calls.map((call) => call.op),
        ["resolve_binding"],
        "the exact-key-set refusal must precede materialization and ref mutation"
      );
    });
  }
});

test("WK-1651 identity-store discriminator admits an exact-shape reissued binding with no enumerated exception", async (t) => {
  for (const [name, build] of [
    ["v1 sparse reissue", () => exactSliceBinding({ retry_id: 1 })],
    ["v2 full reissue", () => exactFullSliceBinding({ retry_id: 1 })]
  ]) {
    await t.test(name, async (t) => {
      const binding = build();
      installIdentityStoreEnv(t, binding);
      const state = installState({
        binding,
        advanced: {
          base_sha: BASE_SHA,
          commit: COMMIT_SHA,
          tree: TREE_SHA,
          ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
          idempotent: false
        }
      });
      const tool = await registerCommitTool(t);

      const result = await tool.handler({});
      assert.equal(result.structuredContent.committed, true, `${name} must still commit`);
    });
  }
});

test("WK-1622#SLICE-009 identity-store discriminator still admits both exact shapes (no drain regression)", async (t) => {
  for (const [name, build, expectedSparse] of [
    ["v1 sparse", () => exactSliceBinding({ output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004" }), true],
    ["v2 full", () => exactFullSliceBinding(), false]
  ]) {
    await t.test(name, async (t) => {
      const binding = build();
      installIdentityStoreEnv(t, binding);
      const state = installState({
        binding,
        advanced: {
          base_sha: BASE_SHA,
          commit: COMMIT_SHA,
          tree: TREE_SHA,
          ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
          idempotent: false
        }
      });
      const tool = await registerCommitTool(t);

      const result = await tool.handler({});
      assert.equal(result.structuredContent.committed, true);
      const materialize = state.calls.find((call) => call.op === "materialize").args;
      if (expectedSparse) {
        assert.deepEqual(materialize.sparseBinding, {
          base_sha: BASE_SHA,
          cone_dirs: binding.cone_dirs,
          index_sparse: binding.index_sparse
        });
      } else {
        assert.equal(materialize.sparseBinding, null);
      }
    });
  }
});

test("identity-store exact-slice projection fails closed for every identity mismatch class", async (t) => {
  const cases = [
    ["missing unit_address", (binding) => { delete binding.unit_address; }, ASSIGNED_UNIT],
    ["malformed unit_address", (binding) => { binding.unit_address = "IN-0011/WK-1429/slice-004"; }, ASSIGNED_UNIT],
    ["WK-only unit_address", (binding) => { binding.unit_address = "IN-0011/WK-1429"; }, ASSIGNED_UNIT],
    ["initiative mismatch", (binding) => { binding.initiative = "IN-0012"; }, ASSIGNED_UNIT],
    ["missing initiative", (binding) => { delete binding.initiative; }, ASSIGNED_UNIT],
    ["record_id mismatch", (binding) => { binding.record_id = "WK-1430"; }, ASSIGNED_UNIT],
    ["missing record_id", (binding) => { delete binding.record_id; }, ASSIGNED_UNIT],
    ["slice_id mismatch", (binding) => { binding.slice_id = "SLICE-005"; }, ASSIGNED_UNIT],
    ["missing slice_id", (binding) => { delete binding.slice_id; }, ASSIGNED_UNIT],
    ["selected_unit mismatch", (binding) => { binding.selected_unit.address = "WK-1429#SLICE-005"; }, ASSIGNED_UNIT],
    ["selected_unit omission", (binding) => { delete binding.selected_unit; }, ASSIGNED_UNIT],
    ["partial selected_unit", (binding) => { delete binding.selected_unit.repo; }, ASSIGNED_UNIT],
    ["assigned-unit mismatch", () => {}, "WK-1429#SLICE-005"],
    ["malformed assigned unit", () => {}, "WK-1429"],
    ["non-canonical assigned unit", () => {}, ` ${ASSIGNED_UNIT} `],
    ["output-branch mismatch", (binding) => { binding.output_branch = "slice/IN-0012/WK-1429/SLICE-004"; }, ASSIGNED_UNIT],
    ["missing output branch", (binding) => { delete binding.output_branch; }, ASSIGNED_UNIT],
    ["conflicting explicit subject", (binding) => { binding.subject = "WK-1429#SLICE-005"; }, ASSIGNED_UNIT]
  ];

  for (const [name, mutate, assignedUnit] of cases) {
    await t.test(name, async (t) => {
      const binding = exactSliceBinding();
      mutate(binding);
      installIdentityStoreEnv(t, binding, assignedUnit);
      const state = installState({ binding });
      const tool = await registerCommitTool(t);

      const result = await tool.handler({});
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /credential->binding resolver threw/);
      assert.deepEqual(
        state.calls.map((call) => call.op),
        ["resolve_binding"],
        "identity refusal must precede commit materialization and ref mutation"
      );
    });
  }
});

test("serialized commit binding environment cannot replace the launcher identity tuple", async (t) => {
  saveCommitEnv(t);
  process.env.WIKI_MCP_ASSIGNED_UNIT = ASSIGNED_UNIT;
  process.env.WIKI_MCP_COMMIT_BINDING = JSON.stringify({
    subject: ASSIGNED_UNIT,
    output_branch: "refs/heads/attacker-selected"
  });
  delete process.env.WIKI_MCP_COMMIT_LAUNCH_REF;
  delete process.env.WIKI_MCP_COMMIT_RUN_ID;
  delete process.env.WIKI_MCP_COMMIT_RETRY_ID;
  process.env.WIKI_MCP_TOOL_PROFILE = "full";
  const state = installState();
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.structuredContent.committed, false);
  assert.equal(result.structuredContent.decision_code, "commit.missing_launcher_binding.v1");
  assert.match(result.structuredContent.reasons[0], /serialized environment bindings/);
  assert.deepEqual(state.calls, []);
});
