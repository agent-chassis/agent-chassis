import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { registerCommittedSliceIntegrationRoute } from "./dispatch-tools/committed-slice-integration-route.mjs";
import {
  buildDispatchRuntime,
  consumeDispatchCodexTestSeamEvidence
} from "./dispatch-launch-runtime.mjs";
import { bindingFilePath } from
  "@agent-chassis/agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import { jsonContent } from "./mcp-response.mjs";
import {
  fixture,
  git,
  structured
} from "../../../../tests/helpers/committed-slice-review-fixture.mjs";

const SUBJECT = "WK-1784#SLICE-002";
const AMBIENT_AGENT_IDENTITY_ENV_KEYS = Object.freeze([
  "AGENT_ROLE",
  "AGENT_WK",
  "AGENT_OPERATOR_WRITE_SCOPE"
]);

function envWithoutAmbientAgentIdentity(env = process.env) {
  const filtered = { ...env };
  for (const key of AMBIENT_AGENT_IDENTITY_ENV_KEYS) {
    delete filtered[key];
  }
  return filtered;
}

function harness(requestCommittedSliceIntegration, response = (value) => value) {
  const calls = { backend: [], workspace: [] };
  let tool;
  registerCommittedSliceIntegrationRoute({
    registerTool: (name, config, handler) => { tool = { name, config, handler }; },
    workspaceRepos: [], z, jsonContent: response,
    resolveWorkspaceRepo: (...args) => { calls.workspace.push(args); return {}; },
    dispatchBackend: requestCommittedSliceIntegration && {
      requestCommittedSliceIntegration: async (request) => {
        calls.backend.push(request); return requestCommittedSliceIntegration(request);
      }
    },
    committedSliceIntegrationToolName: "workspace_integrate_committed_slice",
    callerNodeEngineAuthorityFields: ["node_engine"],
    callerCommittedSliceAuthorityFields: ["slice_ref"],
    callerCcePolicyAuthorityFields: ["authority"]
  });
  return {
    calls, tool,
    invoke: (args) => tool.handler(tool.config.inputSchema.parse(args))
  };
}

test("committed-slice integration route preserves registration and outcomes", async (t) => {
  await t.test("production post-worker adapter reaches backend-owned authorized integration", async () => {
    const fx = fixture(t, {
      sliceStatus: "todo",
      emptyDelivery: true,
      tempRoot: realpathSync(os.userInfo().homedir)
    });
    const canonicalRecordPath = path.join(
      fx.repo,
      "wiki",
      "work-records",
      `${fx.wkId}.json`
    );
    const initialRecord = JSON.parse(readFileSync(canonicalRecordPath, "utf8"));
    initialRecord.slices.push({
      ...structuredClone(initialRecord.slices[0]),
      id: "SLICE-002",
      title: "Remaining implementation slice"
    });
    writeFileSync(canonicalRecordPath, `${JSON.stringify(initialRecord, null, 2)}\n`);
    mkdirSync(path.join(fx.repo, "src"), { recursive: true });
    writeFileSync(path.join(fx.repo, "src", "base.txt"), "scope parent\n");
    git(fx.repo, "add", "src/base.txt", `wiki/work-records/${fx.wkId}.json`);
    git(fx.repo, "commit", "-m", "add scope parent");
    const provisioningBase = git(fx.repo, "rev-parse", "HEAD");
    git(fx.repo, "branch", "-f", `wk/${fx.initiative}/${fx.wkId}`, provisioningBase);
    git(fx.worktree, "merge", "--ff-only", "main");
    git(
      fx.repo,
      "update-ref",
      `refs/agent-launch/wk-forks/${fx.initiative}/${fx.wkId}`,
      provisioningBase
    );
    const derivedWorktreeRoot = path.join(
      realpathSync(os.userInfo().homedir), ".agent-worktrees", path.basename(fx.repo)
    );
    t.after(() => rmSync(derivedWorktreeRoot, { recursive: true, force: true }));
    const derivedWorktree = path.join(
      derivedWorktreeRoot, `slice-${fx.initiative}-${fx.wkId}-SLICE-001`
    );
    mkdirSync(path.dirname(derivedWorktree), { recursive: true });
    git(fx.repo, "worktree", "move", fx.worktree, derivedWorktree);
    git(
      fx.repo,
      "worktree",
      "add",
      path.join(derivedWorktreeRoot, `wk-${fx.initiative}-${fx.wkId}`),
      `wk/${fx.initiative}/${fx.wkId}`
    );
    writeFileSync(
      path.join(fx.repo, "agent-launch.toml"),
      '[roles.worker]\nmodel = "gpt-5.6-terra"\n[roles.reviewer]\nmodel = "gpt-5.6-terra"\n'
    );
    mkdirSync(path.join(fx.repo, "wiki", "contracts"), { recursive: true });
    mkdirSync(path.join(fx.repo, "docs"), { recursive: true });
    writeFileSync(path.join(fx.repo, ".git", "info", "exclude"), ".cache/\n");
    const env = {
      ...envWithoutAmbientAgentIdentity(),
      WIKI_MCP_WORKSPACE_DIR: fx.repo,
      WIKI_MCP_DISPATCH_CODEX_EXECUTOR_SEAMS: "accept_succeed_test_seams"
    };
    const runtime = buildDispatchRuntime(env);
    const dispatched = await runtime.dispatchBackend.startLaunch({
      caller_session_id: runtime.dispatchSessionIdentity,
      role: "worker",
      app: "codex",
      subject: fx.subject,
      workspace_alias: "fixture",
      workspace_dir: fx.repo,
      readiness: {
        dispatchable: true,
        decision_code: "dispatchable",
        dispatch_role: "read_only",
        record_id: fx.wkId,
        unit: {
          kind: "slice",
          address: fx.subject,
          record_id: fx.wkId,
          slice_id: "SLICE-001"
        },
        recovery: {
          graph_impact: "not_required",
          admission_metrics: "fresh",
          target_resolution: "not_required"
        }
      }
    });
    assert.equal(dispatched.accepted, true, JSON.stringify(dispatched));
    const [launchEvidence] = consumeDispatchCodexTestSeamEvidence();
    let launchClosed = false;
    const closeLaunch = async () => {
      if (launchClosed) return;
      launchClosed = true;
      launchEvidence.close_stdin();
      await launchEvidence.terminal;
      await runtime.dispatchBackend.getRunStatus({
        monitor_handle: dispatched.monitor_handle,
        subject: fx.subject
      });
    };
    t.after(closeLaunch);

    git(
      derivedWorktree,
      "commit",
      "--allow-empty",
      "-m", `agent-launch worker delivery: ${fx.subject} (base ${provisioningBase.slice(0, 12)})`,
      "-m", `Wk-Slice: ${fx.subject}`
    );
    const committed = git(derivedWorktree, "rev-parse", "HEAD");
    const canonicalRecord = JSON.parse(readFileSync(canonicalRecordPath, "utf8"));
    canonicalRecord.slices[0].status = "review";
    writeFileSync(canonicalRecordPath, `${JSON.stringify(canonicalRecord, null, 2)}\n`);

    const status = {
      accepted: true,
      run_id: dispatched.run_id,
      monitor_handle: dispatched.monitor_handle,
      role: "worker",
      subject: fx.subject,
      status: "succeeded",
      terminal: true
    };
    const admission = await runtime.dispatchBackend
      .prepareCanonicalCommittedSliceReviewAdmission({
        subject: fx.subject,
        workspace_dir: fx.repo
      });
    assert.equal(admission.ok, true, JSON.stringify(admission));
    const integratingRuntime = buildDispatchRuntime(env);
    const integrated = await integratingRuntime.dispatchBackend
      .requestCommittedSliceIntegration({ subject: fx.subject });
    assert.equal(integrated.integrated, true, JSON.stringify(integrated));

    const bindingStore = path.dirname(bindingFilePath(
      fx.repo,
      dispatched.monitor_handle,
      `${dispatched.run_id}.slice`,
      0
    ));
    for (const entry of readdirSync(bindingStore)) {
      unlinkSync(path.join(bindingStore, entry));
    }
    const productionRequestCommittedSliceIntegration =
      runtime.dispatchBackend.requestCommittedSliceIntegration;
    let productionCallbackCalls = 0;
    runtime.dispatchBackend.requestCommittedSliceIntegration = async (request) => {
      productionCallbackCalls += 1;
      return productionRequestCommittedSliceIntegration(request);
    };

    const result = await runtime.dispatchBackend.runPostWorkerSliceLifecycle({
      workspace: { repo: "fixture", dir: fx.repo },
      status
    });

    assert.equal(productionCallbackCalls, 1,
      "the buildDispatchRuntime post-worker callback must invoke the backend-owned integration route");
    assert.equal(result.integrated, true, JSON.stringify(result));
    assert.equal(result.integration.integrated, true, JSON.stringify(result));
    assert.equal(
      git(fx.repo, "rev-parse", `refs/heads/wk/${fx.initiative}/${fx.wkId}`),
      result.integration.wk_sha
    );
    assert.equal(result.integration.delivery_sha, committed);
    await closeLaunch();
  });

  await t.test("production route composes through the real dispatch backend", async () => {
    const fx = fixture(t, {
      sliceStatus: "review",
      tempRoot: realpathSync(os.userInfo().homedir)
    });
    const derivedWorktreeRoot = path.join(
      realpathSync(os.userInfo().homedir), ".agent-worktrees", path.basename(fx.repo)
    );
    t.after(() => rmSync(derivedWorktreeRoot, { recursive: true, force: true }));
    const derivedWorktree = path.join(
      derivedWorktreeRoot, `slice-${fx.initiative}-${fx.wkId}-SLICE-001`
    );
    mkdirSync(path.dirname(derivedWorktree), { recursive: true });
    git(fx.repo, "worktree", "move", fx.worktree, derivedWorktree);
    const runtime = buildDispatchRuntime({
      ...envWithoutAmbientAgentIdentity(),
      WIKI_MCP_WORKSPACE_DIR: fx.repo
    });
    assert.equal(typeof runtime.dispatchBackend?.requestCommittedSliceIntegration, "function");
    let tool;
    registerCommittedSliceIntegrationRoute({
      registerTool: (name, config, handler) => { tool = { name, config, handler }; },
      workspaceRepos: [], z, jsonContent,
      resolveWorkspaceRepo: () => ({}),
      dispatchBackend: runtime.dispatchBackend,
      committedSliceIntegrationToolName: "workspace_integrate_committed_slice",
      callerNodeEngineAuthorityFields: ["node_engine"],
      callerCommittedSliceAuthorityFields: ["slice_ref"],
      callerCcePolicyAuthorityFields: ["authority"]
    });
    const result = structured(await tool.handler(
      tool.config.inputSchema.parse({ subject: fx.subject })
    ));
    assert.equal(result.accepted, true, JSON.stringify(result));
    assert.equal(result.subject, fx.subject);
    assert.equal(result.outcome, "integrated");
    assert.equal(
      git(fx.repo, "rev-parse", `refs/heads/wk/${fx.initiative}/${fx.wkId}`),
      fx.reviewed
    );
    const persistedRecord = JSON.parse(readFileSync(
      path.join(fx.repo, "wiki", "work-records", `${fx.wkId}.json`), "utf8"
    ));
    assert.equal(persistedRecord.slices[0].status, "done");
  });

  await t.test("caller-authority refusal", async () => {
    const h = harness(async () => assert.fail("backend called"));
    assert.equal(h.tool.name, "workspace_integrate_committed_slice");
    assert.throws(() => h.tool.config.inputSchema.parse({ subject: SUBJECT, extra: true }));
    const result = await h.invoke({ subject: SUBJECT, slice_ref: "caller-ref", authority: {} });
    assert.deepEqual(result.blocker.detail.refused_fields, ["slice_ref", "authority"]);
    assert.deepEqual(h.calls, { backend: [], workspace: [] });
  });
  await t.test("invalid subject", async () => {
    const h = harness(async () => assert.fail("backend called"));
    const result = await h.invoke({ subject: "WK-1784" });
    assert.equal(result.blocker.reason, "committed_slice_integration_subject_invalid");
    assert.deepEqual(h.calls, { backend: [], workspace: [] });
  });
  await t.test("missing backend", async () => {
    const h = harness(null); const result = await h.invoke({ subject: SUBJECT, repo: "demo" });
    assert.equal(result.blocker.code, "backend_unavailable");
    assert.equal(h.calls.workspace.length, 1);
  });
  await t.test("accepted integration", async () => {
    const integration = {
      integrated: true, outcome: "integrated", empty_delivery: false,
      policy_posture: "free_substrate",
      closeout_continuation: { stage: "resume_original_worker_monitor" },
      advisory_review_evidence: {
        committed_target_digest: "sha256:target",
        reviews: [{
          structured_result_digest: "sha256:evidence",
          finding_counts: { total: 2 }, findings: [{ id: "F-1" }, { id: "F-2" }],
          reviewer_prose: "must not escape"
        }]
      },
      orchestrator_dispositions: [
        { review_run_id: "review-1", finding_id: "F-1", disposition: "defer" }
      ],
      replay_fields: { receipt: "must not escape" }
    };
    const h = harness(async () => integration);
    const dispositions = [{ review_run_id: "review-1", finding_id: "F-1", disposition: "defer" }];
    const result = await h.invoke({ subject: SUBJECT, dispositions });
    assert.deepEqual(result, {
      schema_version: "workspace-integrate-committed-slice.v2", accepted: true,
      subject: SUBJECT, outcome: "integrated", empty_delivery: false,
      closeout: { stage: "resume_original_worker_monitor" },
      evidence_correlation: {
        structured_result_digest: "sha256:evidence", review_count: 1, finding_count: 2
      },
      disposition_summary: { total: 1, accept: 0, reject: 0, defer: 1 }
    });
    assert.deepEqual(h.calls.backend, [{ subject: SUBJECT, dispositions }]);
  });
  await t.test("large evidence is projected through production jsonContent", async () => {
    const evidence = {
      committed_target_digest: "sha256:target",
      reviews: [{
        structured_result_digest: "sha256:evidence",
        finding_counts: { total: 1000 },
        findings: Array.from({ length: 1000 }, (_, index) => ({
          id: `F-${index}`, prose: "large reviewer prose ".repeat(1000), receipt: "secret"
        }))
      }]
    };
    const h = harness(async () => ({
      integrated: true, outcome: "integrated", empty_delivery: true,
      advisory_review_evidence: evidence
    }), (value) => jsonContent(value, {
      env: { ...process.env, WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "16384" }
    }));
    const wrapper = await h.invoke({ subject: SUBJECT });
    assert.ok(Buffer.byteLength(JSON.stringify(wrapper, null, 2), "utf8") <= 16384);
    assert.deepEqual(wrapper.structuredContent.evidence_correlation, {
      structured_result_digest: "sha256:evidence", review_count: 1, finding_count: 1000
    });
    const serialized = JSON.stringify(wrapper);
    for (const forbidden of ["advisory_review_evidence", "large reviewer prose", "receipt", "replay_fields"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
  await t.test("backend refusal", async () => {
    const refusal = {
      code: "cce_policy_denied", classification: "validation_failure", reason: "policy_denied"
    };
    const h = harness(async () => ({ integrated: false, refusal }));
    const result = await h.invoke({ subject: SUBJECT });
    assert.deepEqual(result, {
      schema_version: "workspace-integrate-committed-slice.v2",
      accepted: false,
      blocker: { code: "validation_failure", reason: "policy_denied", detail: { code: refusal.code } },
      transport: "mcp"
    });
  });
  await t.test("invalid advisory disposition is classified locally", async () => {
    const h = harness(async () => ({
      integrated: false,
      refusal: {
        code: "agent_launch.slice_integration.advisory_disposition_invalid.v1",
        classification: "validation_failure",
        reason: "orchestrator advisory dispositions do not match retained exact-target findings",
        detail: { finding_id: "F-1" }
      }
    }));
    const result = await h.invoke({ subject: SUBJECT });
    assert.equal(result.schema_version, "workspace-integrate-committed-slice.v2");
    assert.deepEqual(result.blocker, {
      code: "validation_failure",
      reason: "orchestrator advisory dispositions do not match retained exact-target findings",
      detail: { code: "agent_launch.slice_integration.advisory_disposition_invalid.v1", detail: { finding_id: "F-1" } }
    });
    assert.equal(result.transport, "mcp");
  });
  await t.test("zero and multiple review evidence do not mislabel a target digest", async () => {
    const make = (reviews) => harness(async () => ({
      integrated: true, outcome: "integrated", empty_delivery: false,
      advisory_review_evidence: { committed_target_digest: "sha256:target", reviews }
    }));
    const zero = await make([]).invoke({ subject: SUBJECT });
    assert.deepEqual(zero.evidence_correlation, {
      structured_result_digest: null, review_count: 0, finding_count: 0
    });
    const multiple = await make([
      { structured_result_digest: "sha256:one", finding_counts: { total: 1 } },
      { structured_result_digest: "sha256:two", finding_counts: { total: 2 } }
    ]).invoke({ subject: SUBJECT });
    assert.deepEqual(multiple.evidence_correlation, {
      structured_result_digest: null, review_count: 2, finding_count: 3
    });
  });
  await t.test("projects exact launcher classifications without inspecting diagnostic text", async () => {
    const cases = [
      ["operator_recovery_needed", "operator_recovery_needed"],
      ["validation_failure", "validation_failure"],
      ["backend_unavailable", "backend_unavailable"],
      ["caller_supplied_identity", "caller_supplied_identity"]
    ];
    for (const [classification, expected] of cases) {
      const h = harness(async () => ({
        integrated: false,
        refusal: {
          classification,
          code: `diagnostic_${classification}_unavailable_invalid_denied`,
          reason: "unavailable invalid denied target_mismatch"
        }
      }));
      const result = await h.invoke({ subject: SUBJECT });
      assert.equal(result.blocker.code, expected);
    }
    const misleading = harness(async () => ({
      integrated: false,
      refusal: {
        classification: "operator_recovery_needed",
        code: "cce_policy_denied_and_backend_unavailable",
        reason: "invalid malformed missing"
      }
    }));
    const result = await misleading.invoke({ subject: SUBJECT });
    assert.equal(result.blocker.code, "operator_recovery_needed");
  });
  await t.test("fresh backend zero-delta repeats have equivalent public projections", async () => {
    const create = () => harness(async () => ({
      integrated: true, outcome: "integrated", empty_delivery: true,
      replay_fields: { receipt: "must not escape" }
    }), (value) => jsonContent(value, {
      env: { ...process.env, WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "16384" }
    }));
    const first = await create().invoke({ subject: SUBJECT });
    const second = await create().invoke({ subject: SUBJECT });
    assert.deepEqual(first, second);
    for (const wrapper of [first, second]) {
      assert.ok(Buffer.byteLength(JSON.stringify(wrapper, null, 2), "utf8") <= 16384);
      assert.deepEqual(wrapper.structuredContent, {
        schema_version: "workspace-integrate-committed-slice.v2",
        accepted: true,
        subject: SUBJECT,
        outcome: "integrated",
        empty_delivery: true
      });
      assert.equal(JSON.stringify(wrapper).includes("replay_fields"), false);
    }
  });
  await t.test("oversized refusal stays bounded through production jsonContent", async () => {
    const h = harness(async () => ({
      integrated: false,
      refusal: {
        code: "agent_launch.slice_integration.cce_policy_denied.v1",
        reason: "policy_denied",
        detail: { policy_id: "p", diagnostic: "x".repeat(100000) }
      }
    }), (value) => jsonContent(value, {
      env: { ...process.env, WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "16384" }
    }));
    const wrapper = await h.invoke({ subject: SUBJECT });
    assert.ok(Buffer.byteLength(JSON.stringify(wrapper, null, 2), "utf8") <= 16384);
    assert.equal(wrapper.structuredContent.response_spilled, true);
  });
  await t.test("route owns projection and refusal classification", async () => {
    const source = readFileSync(new URL("./dispatch-tools/committed-slice-integration-route.mjs", import.meta.url), "utf8");
    assert.equal(source.includes("buildBlockedDispatchResult"), false);
    assert.equal(source.includes("buildBlockedRunStatusResult"), false);
    assert.equal(source.includes("compactRunStatusReviewResult"), false);
    assert.equal(source.includes("mapBackendRefusalToDispatchCode"), false);
    assert.equal(source.includes("summarizeRunStatusFinalResult"), false);
    assert.equal(source.includes("resolveSliceReviewEvidenceSet"), false);
  });
  await t.test("thrown exception", async () => {
    const h = harness(async () => { throw new Error("integration exploded"); });
    const result = await h.invoke({ subject: SUBJECT });
    assert.deepEqual([result.blocker.code, result.blocker.reason],
      ["operator_recovery_needed", "dispatch_tool_exception"]);
  });
});
