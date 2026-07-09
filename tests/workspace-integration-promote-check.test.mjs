import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerIntegrationPromoteCheckTools } from "../packages/wiki-mcp/src/lib/integration-promote-check-tools.mjs";

const fakeZ = { string: () => ({ optional() { return this; } }) };
const evidenceId = "rr:877b78dcde2a26ef13c095b7e6ba8fc7f61a238cd0555fa4027656966c9cd4e3";
const forbiddenFields = "root workspaceRoot workspace_root dir cwd path paths gitDir git_dir worktree worktreePath worktree_path branch branchRef branch_ref ref refs base_ref integration_ref wk_ref sha shas base_sha head_sha tip candidate candidate_sha policy policy_verdict policyVerdict evidence evidence_body evidenceBody identity identity_carrier identityCarrier review review_result review_attestation attestation run_id launch_ref merge merge_instruction rebase rebase_instruction cleanup".split(" ");
const failClosedFacts = "live_refs candidate_identity liveness quiescence lease touched_paths detached_merge_workspace conflict_classification evidence_binding".split(" ");

async function withWorkspace(files, fn) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "workspace-integration-promote-check-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(workspaceDir, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    }
    return await fn(workspaceDir);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

function fixtureRecord(overrides = {}) {
  return JSON.stringify({
    schema_version: "work-record.v1",
    id: "WK-1445",
    repo: "agent-chassis/agent-chassis",
    title: "Promote check fixture",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    created: "2026-07-08",
    updated: "2026-07-08",
    related: ["IN-0021"],
    slices: [{ id: "SLICE-004" }],
    sections: { closure: { validation: [`Review-result evidence ${evidenceId} recorded.`] } },
    ...overrides
  }, null, 2);
}

async function callPromoteCheck(workspaceDir, args) {
  const registrations = new Map();
  registerIntegrationPromoteCheckTools({
    registerTool(name, definition, handler) {
      registrations.set(name, { definition, handler });
    },
    workspaceRepos: [{ repo: "fixture", dir: workspaceDir }],
    z: fakeZ,
    jsonContent: (structuredContent) => ({ structuredContent, isError: false }),
    errorContent: (error) => ({
      isError: true,
      structuredContent: { message: error instanceof Error ? error.message : String(error) }
    }),
    resolveWorkspaceRepo(workspaceRepos, repo) {
      const selected = workspaceRepos.find((entry) => entry.repo === (repo || "fixture"));
      if (!selected) throw new Error(`unknown repo: ${repo}`);
      return selected;
    }
  });
  const tool = registrations.get("workspace_integration_promote_check");
  assert.ok(tool, "workspace_integration_promote_check should be registered");
  return tool.handler(args);
}

function collectKeys(value, keys = []) {
  if (!value || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectKeys(child, keys);
  }
  return keys;
}

const fixtureFiles = { "wiki/work-records/WK-1445.json": fixtureRecord() };

test("workspace_integration_promote_check requires WK input and rejects caller authority fields", async () => {
  await withWorkspace(fixtureFiles, async (workspaceDir) => {
    const missing = await callPromoteCheck(workspaceDir, { repo: "fixture" });
    assert.equal(missing.isError, true);
    assert.match(missing.structuredContent.message, /requires unit or work_record/);

    const conflicting = await callPromoteCheck(workspaceDir, {
      repo: "fixture", unit: "WK-1445", work_record: "WK-1446"
    });
    assert.equal(conflicting.isError, true);
    assert.match(conflicting.structuredContent.message, /one canonical unit\/work_record identity/);

    for (const field of forbiddenFields) {
      const response = await callPromoteCheck(workspaceDir, {
        repo: "fixture", unit: "WK-1445#SLICE-004", [field]: "caller supplied"
      });
      assert.equal(response.isError, true, `${field} should be rejected`);
      assert.match(response.structuredContent.message, /accepts only repo plus unit or work_record/);
      assert.match(response.structuredContent.message, new RegExp(field));
    }
  });
});

test("workspace_integration_promote_check reports inventory and fail-closed non-authority blockers", async () => {
  await withWorkspace(fixtureFiles, async (workspaceDir) => {
    const response = await callPromoteCheck(workspaceDir, {
      repo: "fixture", work_record: "WK-1445#SLICE-004"
    });
    assert.equal(response.isError, false);

    const body = response.structuredContent;
    assert.equal(body.schema_version, "workspace-integration-promote-check.v1");
    assert.equal(body.unit, "WK-1445#SLICE-004");
    assert.equal(body.expected_wk_ref, "wk/IN-0021/WK-1445");
    assert.equal(body.expected_integration_ref, "integration/IN-0021");
    assert.equal(body.work_record_inventory.initiative_binding.status, "resolved");
    assert.deepEqual(body.evidence_inventory, [{ id: evidenceId, authority: "record_identity_only" }]);
    assert.deepEqual(body.policy_admissibility, {
      status: "not_evaluated",
      authority: "not_available",
      reason: "workspace_integration_promote_check is local coordination only, not policy authority"
    });
    assert.deepEqual(
      Object.fromEntries(Object.entries(body.local_facts).map(([key, fact]) => [key, fact.status])),
      {
        live_refs: "unknown",
        candidate_identity: "unknown",
        liveness: "unknown",
        quiescence: "unknown",
        lease: "not_available",
        touched_paths: "unknown",
        detached_merge_workspace: "not_available",
        conflict_classification: "not_evaluated",
        evidence_binding: "unknown"
      }
    );
    assert.equal(body.local_facts.evidence_binding.authority, "not_available");
    assert.match(
      body.local_facts.live_refs.reason,
      /same-ref-store\/live-workspace resolver/,
      "base-drift inputs must remain unknown without trusted same-ref-store live refs"
    );
    assert.match(
      body.local_facts.candidate_identity.reason,
      /same-ref-store\/live-workspace resolver/,
      "candidate identity must remain unknown without trusted same-ref-store resolution"
    );
    assert.equal(body.local_facts.conflict_classification.status, "not_evaluated");
    assert.match(
      body.local_facts.conflict_classification.reason,
      /trusted live refs and touched paths/,
      "conflict taxonomy must stay unevaluated until resolver facts exist"
    );

    const blockersByFact = Object.fromEntries(body.local_blockers.map((entry) => [entry.fact, entry]));
    for (const fact of failClosedFacts) {
      assert.ok(blockersByFact[fact], `${fact} should be a local blocker`);
      assert.equal(blockersByFact[fact].recommended_action, "blocked_needs_trusted_resolver");
    }
    assert.match(blockersByFact.live_refs.reason, /same-ref-store/);
    assert.match(blockersByFact.candidate_identity.reason, /same-ref-store/);
    assert.match(blockersByFact.conflict_classification.reason, /trusted live refs and touched paths/);
    assert.equal(blockersByFact.conflict_classification.code, "conflict_classification_not_evaluated");
    assert.match(body.local_facts.evidence_binding.reason, /exact live candidate tip\/source digest/);
  });
});

test("workspace_integration_promote_check fails closed for malformed records and branch binding", async () => {
  await withWorkspace({
    "wiki/work-records/WK-1445.json": "{ invalid json",
    "wiki/work-records/WK-1446.json": fixtureRecord({ id: "WK-1446", related: [] }),
    "wiki/work-records/WK-1447.json": fixtureRecord({ id: "WK-1447", related: ["IN-0021", "IN-0022"] })
  }, async (workspaceDir) => {
    const malformed = await callPromoteCheck(workspaceDir, { repo: "fixture", unit: "WK-1445" });
    assert.equal(malformed.isError, false);
    assert.equal(malformed.structuredContent.sources.work_record.readable, false);
    assert.equal(malformed.structuredContent.sources.work_record.error.error_kind, "parse_error");
    assert.ok(malformed.structuredContent.local_blockers.some((entry) =>
      entry.code === "canonical_record_untrusted" && entry.fact === "work_record"
    ));

    for (const [unit, status] of [["WK-1446", "missing"], ["WK-1447", "ambiguous"]]) {
      const response = await callPromoteCheck(workspaceDir, { repo: "fixture", unit });
      assert.equal(response.isError, false);
      assert.equal(response.structuredContent.work_record_inventory.initiative_binding.status, status);
      assert.equal(response.structuredContent.expected_wk_ref, null);
      assert.equal(response.structuredContent.expected_integration_ref, null);
      assert.ok(response.structuredContent.local_blockers.some((entry) =>
        entry.code === "branch_binding_unresolved" && entry.fact === "branch_binding"
      ));
    }
  });
});

test("workspace_integration_promote_check fails closed for missing canonical work records", async () => {
  await withWorkspace({}, async (workspaceDir) => {
    const response = await callPromoteCheck(workspaceDir, { repo: "fixture", unit: "WK-1448" });
    assert.equal(response.isError, false);

    const body = response.structuredContent;
    assert.equal(body.sources.work_record.source_path_relative, "wiki/work-records/WK-1448.json");
    assert.equal(body.sources.work_record.readable, false);
    assert.equal(body.sources.work_record.error.error_kind, "read_error");
    assert.equal(body.sources.work_record.error.error_code, "ENOENT");
    assert.equal(body.work_record_inventory.status, "unknown");
    assert.equal(body.work_record_inventory.initiative_binding.status, "unknown");
    assert.deepEqual(body.evidence_inventory, []);

    const blockersByCode = Object.fromEntries(body.local_blockers.map((entry) => [entry.code, entry]));
    assert.equal(blockersByCode.canonical_record_untrusted.fact, "work_record");
    assert.equal(blockersByCode.canonical_record_untrusted.recommended_action, "repair_canonical_record_then_recheck");
    assert.match(blockersByCode.canonical_record_untrusted.reason, /failed to read canonical work-record inventory/);
    assert.equal(blockersByCode.branch_binding_unresolved.fact, "branch_binding");
  });
});

test("workspace_integration_promote_check exposes bounded actions and no green-light fields", async () => {
  await withWorkspace(fixtureFiles, async (workspaceDir) => {
    const { structuredContent: body } = await callPromoteCheck(workspaceDir, {
      repo: "fixture", unit: "WK-1445"
    });
    assert.deepEqual(body.recommended_actions, [
      "repair_wk_to_initiative_binding_then_recheck",
      "provide_trusted_live_ref_candidate_resolver",
      "provide_trusted_liveness_lease_and_quiescence_resolvers",
      "provide_trusted_touched_path_and_detached_workspace_resolvers",
      "request_review_for_current_candidate_after_exact_candidate_binding"
    ]);
    assert.ok(body.recommended_actions.every((action) => /recheck|provide|repair|request/.test(action)));
    assert.equal(body.recommended_actions.some((action) => /hand|manual|llm|merge|resolve_conflict/i.test(action)), false);
    assert.equal(body.recommended_actions.some((action) => /rebase/i.test(action)), false);
    assert.ok(
      body.recommended_actions.includes("provide_trusted_live_ref_candidate_resolver"),
      "base drift must not recommend rebase until trusted live candidate/base facts are available"
    );
    assert.equal(body.local_facts.conflict_classification.status, "not_evaluated");
    assert.equal(
      body.local_blockers.find((entry) => entry.fact === "conflict_classification").code,
      "conflict_classification_not_evaluated"
    );
    const greenLight = "promotion_authorized policy_admitted review_passed safe_to_merge merge_allowed dispatchable policy_satisfied merge_authorized".split(" ");
    assert.deepEqual(collectKeys(body).filter((key) => greenLight.includes(key)), []);
  });
});
