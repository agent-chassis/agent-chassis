import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ADVISORY_REVIEW_SOURCE_BINDING_KIND,
  STDIO_MCP_CONDUIT_AUTHORITY_SOURCE_BINDING_KIND,
  digestAdvisoryReviewSourceFacts,
  normalizeAdvisoryReviewSourceFacts,
  LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS,
  LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES,
  LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION,
  canonicalSerializeLauncherAgentSessionContract,
  digestLauncherAgentSessionContract,
  mintLauncherAgentSessionContract,
  mintTrustedStdioMcpConduitAuthority as mintUnboundAuthority,
  bindLauncherAgentSessionExecutionBackend,
  resolveLauncherAgentSessionContract,
  resolveLauncherAgentSessionContractFacts,
  authenticateLauncherAgentSessionContract
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import { createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-provenance.mjs";
function mintTrustedStdioMcpConduitAuthority(input) {
  const authority = mintUnboundAuthority(input);
  bindLauncherAgentSessionExecutionBackend(authority,
    createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn());
  return authority;
}
import {
  bindAdvisoryReviewInputToRun,
  createAdvisoryReviewDescriptor,
  createAdvisoryReviewInput,
  resolveAdvisoryReviewInputRun
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-advisory-review-contract.mjs";

const ADVISORY_UNIT = "WK-2713#SLICE-001";

function preparedAdvisoryInput({ role = "reviewer", repository, checkoutRoot }) {
  const descriptor = createAdvisoryReviewDescriptor({
    role, subject: ADVISORY_UNIT, repository, materialKind: "explicit_sha_range",
    diffBaseSha: "1".repeat(40), reviewedSha: "2".repeat(40), reviewedTreeSha: "3".repeat(40),
    immutableSourceIdentity: Object.freeze({ kind: "git_range" }),
    reviewBrief: Object.freeze({ role, subject: ADVISORY_UNIT, material: Object.freeze({}) })
  });
  return createAdvisoryReviewInput({ descriptor, checkoutRoot, toolProfile: role });
}

function advisoryAuthority({ role = "reviewer", repository, input }) {
  return mintTrustedStdioMcpConduitAuthority({
    family: "codex", role, assignedUnit: ADVISORY_UNIT, workspaceDir: repository,
    advisoryReviewInput: input
  });
}

function sourceBindings(contract, kind) {
  return contract.minting_provenance.trusted_source_bindings.filter((entry) => entry.kind === kind);
}

function authority(role) {
  return mintTrustedStdioMcpConduitAuthority({
    family: "codex",
    role,
    assignedUnit: role === "orchestrator" ? "IN-0038" : "WK-2446#SLICE-005",
    workspaceDir: "/tmp/wk-2446-session-contract",
    canonicalWriteScope: role === "worker" ? ["tests", "packages"] : null
  });
}

function refusalCode(error) {
  return error?.detail?.refusal_code ?? error?.detail?.detail?.refusal_code ?? null;
}

function redigest(contract) {
  const withoutDigest = structuredClone(contract);
  delete withoutDigest.contract_digest;
  return { ...withoutDigest, contract_digest: digestLauncherAgentSessionContract(withoutDigest) };
}

test("v1 projection has the exact closed fields, canonical bytes, and role populations", () => {
  for (const role of ["orchestrator", "worker", "reviewer", "redteam"]) {
    const mintedAuthority = authority(role);
    const contract = resolveLauncherAgentSessionContract(mintedAuthority);
    assert.equal(contract.schema_version, LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION);
    assert.deepEqual(Object.keys(contract).sort(), [...LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS].sort());
    assert.equal(contract.role, role);
    assert.equal(contract.lifecycle.review_purpose,
      role === "reviewer" || role === "redteam" ? "standalone" : null);
    assert.equal(contract.assigned_unit.slice_id,
      role === "orchestrator" ? null : "SLICE-005");
    assert.equal(contract.assigned_unit.record_id,
      role === "orchestrator" ? "IN-0038" : "WK-2446");
    assert.equal(contract.contract_digest, digestLauncherAgentSessionContract(contract));
    assert.equal(
      canonicalSerializeLauncherAgentSessionContract(contract).toString("utf8"),
      JSON.stringify(JSON.parse(canonicalSerializeLauncherAgentSessionContract(contract)))
    );
    assert.deepEqual(
      authenticateLauncherAgentSessionContract({
        contract: structuredClone(contract),
        expectedFacts: resolveLauncherAgentSessionContractFacts(mintedAuthority)
      }),
      contract
    );
  }
});

test("assigned-unit parsing is exact and role-aware", () => {
  assert.equal(
    resolveLauncherAgentSessionContract(authority("orchestrator")).assigned_unit.address,
    "IN-0038"
  );
  for (const assignedUnit of [
    "WK-2446#not-a-slice",
    "WK-2446#SLICE-1",
    "WK-2446#../../x",
    "WK-2446 trailing",
    " IN-0038",
    "IN-0038 "
  ]) {
    const minted = mintUnboundAuthority({
      family: "codex",
      role: "worker",
      assignedUnit,
      workspaceDir: "/tmp/wk-2446-session-contract",
      canonicalWriteScope: []
    });
    assert.throws(() => resolveLauncherAgentSessionContract(minted), assignedUnit);
  }
  for (const role of ["worker", "reviewer", "redteam"]) {
    const minted = mintUnboundAuthority({
      family: "codex",
      role,
      assignedUnit: "IN-0038",
      workspaceDir: "/tmp/wk-2446-session-contract",
      canonicalWriteScope: role === "worker" ? [] : null
    });
    assert.throws(() => resolveLauncherAgentSessionContract(minted), `${role}/IN-0038`);
  }
  const crossRole = mintUnboundAuthority({
    family: "codex",
    role: "orchestrator",
    assignedUnit: "WK-2446",
    workspaceDir: "/tmp/wk-2446-session-contract"
  });
  assert.throws(() => resolveLauncherAgentSessionContract(crossRole), "orchestrator/WK-2446");
});

test("DEC-0182 action binding is closed and digest-bound", () => {
  const mintedAuthority = authority("reviewer");
  const body = {
    decision_id: "DEC-0182",
    action_id: "review-WK-2446",
    authenticated_actor_binding_digest: `sha256:${"a".repeat(64)}`,
    selected_findings_source_digest: `sha256:${"b".repeat(64)}`
  };
  const actionDigest = `sha256:${createHash("sha256").update(JSON.stringify({
      action_id: body.action_id,
      authenticated_actor_binding_digest: body.authenticated_actor_binding_digest,
      decision_id: body.decision_id,
      selected_findings_source_digest: body.selected_findings_source_digest
    })).digest("hex")}`;
  const facts = resolveLauncherAgentSessionContractFacts(mintedAuthority);
  const contract = mintLauncherAgentSessionContract({
    ...facts,
    operatorActionBinding: { ...body, action_binding_digest: actionDigest }
  });
  assert.equal(contract.minting_provenance.operator_action_binding.decision_id, "DEC-0182");
  assert.throws(() => mintLauncherAgentSessionContract({
    ...facts,
    operatorActionBinding: { ...body, action_binding_digest: `sha256:${"0".repeat(64)}` }
  }));
});

test("the neutral consumer exposes the complete ten-code refusal taxonomy", () => {
  assert.deepEqual(new Set(Object.values(LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES)), new Set([
    "session_contract_missing",
    "session_contract_schema_unsupported",
    "session_contract_shape_invalid",
    "session_contract_authority_untrusted",
    "session_contract_fact_mismatch",
    "session_contract_digest_mismatch",
    "session_contract_capability_unknown",
    "session_contract_completion_transport_mismatch",
    "session_contract_operator_action_binding_invalid",
    "session_contract_consumer_version_mismatch"
  ]));
  const mintedAuthority = authority("worker");
  const contract = resolveLauncherAgentSessionContract(mintedAuthority);
  const expectedFacts = resolveLauncherAgentSessionContractFacts(mintedAuthority);
  const cases = [
    [null, {}, "session_contract_missing"],
    [{ ...contract, schema_version: "launcher-stdio-mcp-completion-credential.v2" }, {},
      "session_contract_schema_unsupported"],
    [{ ...contract, extra: true }, {}, "session_contract_shape_invalid"],
    [contract, { expectedFacts: null }, "session_contract_authority_untrusted"],
    [redigest({ ...contract, repository: { repository_id: "other/repo" } }), {},
      "session_contract_fact_mismatch"],
    [redigest({ ...contract, capabilities: ["unknown"] }), {},
      "session_contract_capability_unknown"],
    [redigest({ ...contract, completion_transport: { transport_id: "standalone_findings" } }), {},
      "session_contract_completion_transport_mismatch"],
    [{ ...contract, repository: { repository_id: "other/repo" } }, {},
      "session_contract_digest_mismatch"]
  ];
  for (const [candidate, options, code] of cases) {
    assert.throws(() => authenticateLauncherAgentSessionContract({
      contract: candidate,
      expectedFacts,
      ...options
    }), (error) => refusalCode(error) === code);
  }
  assert.throws(() => authenticateLauncherAgentSessionContract({
    contract,
    expectedFacts,
    consumerVersion: "launcher-agent-session-contract.v2"
  }), (error) => refusalCode(error) === "session_contract_consumer_version_mismatch");
});

test("the advisory source binding is run-bound, required, and digest-bound to the closed facts", (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wk2713-source-binding-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const checkoutRoot = path.join(root, "checkout");
  mkdirSync(repository);
  mkdirSync(checkoutRoot);

  const prepared = preparedAdvisoryInput({ repository, checkoutRoot });
  assert.equal(resolveAdvisoryReviewInputRun(prepared), null);
  assert.throws(() => advisoryAuthority({ repository, input: prepared }),
    (error) => error?.detail?.reason === "advisory_review_input_unbound");

  for (const forged of [{ ...prepared }, Object.freeze({ ...prepared, run_id: "wkdb_run_a" }), null]) {
    assert.throws(() => bindAdvisoryReviewInputToRun(forged, "wkdb_run_a"),
      (error) => error?.code === "advisory_review_input_not_launcher_owned");
    assert.equal(resolveAdvisoryReviewInputRun(forged), null);
  }
  assert.throws(() => bindAdvisoryReviewInputToRun(prepared, ""),
    (error) => error?.code === "advisory_review_run_identity_missing");
  const boundA = bindAdvisoryReviewInputToRun(prepared, "wkdb_run_a");
  assert.equal(Object.isFrozen(boundA), true);
  assert.equal(resolveAdvisoryReviewInputRun(boundA), "wkdb_run_a");
  assert.equal(bindAdvisoryReviewInputToRun(prepared, "wkdb_run_a"), boundA);
  assert.equal(bindAdvisoryReviewInputToRun(boundA, "wkdb_run_a"), boundA);
  for (const input of [prepared, boundA]) {
    assert.throws(() => bindAdvisoryReviewInputToRun(input, "wkdb_run_b"),
      (error) => error?.code === "advisory_review_input_bound_to_another_run");
  }

  const authorityA = advisoryAuthority({ repository, input: boundA });
  const contractA = resolveLauncherAgentSessionContract(authorityA);
  assert.deepEqual(Object.keys(contractA).sort(), [...LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS].sort(),
    "the top-level contract shape is unchanged");
  assert.equal(sourceBindings(contractA, STDIO_MCP_CONDUIT_AUTHORITY_SOURCE_BINDING_KIND).length, 1);
  const [bindingA, ...extra] = sourceBindings(contractA, ADVISORY_REVIEW_SOURCE_BINDING_KIND);
  assert.deepEqual(extra, []);
  const factsA = { role: "reviewer", assigned_unit: ADVISORY_UNIT, run_id: "wkdb_run_a",
    repository_root: repository, materialization_root: checkoutRoot };
  assert.deepEqual(bindingA, { kind: ADVISORY_REVIEW_SOURCE_BINDING_KIND, id: "wkdb_run_a",
    digest: digestAdvisoryReviewSourceFacts(factsA) });

  for (const changed of [{ role: "redteam" }, { assigned_unit: "WK-2713#SLICE-002" },
    { run_id: "wkdb_run_b" }, { repository_root: checkoutRoot }, { materialization_root: repository }]) {
    assert.notEqual(digestAdvisoryReviewSourceFacts({ ...factsA, ...changed }), bindingA.digest,
      JSON.stringify(changed));
  }
  assert.throws(() => normalizeAdvisoryReviewSourceFacts({ ...factsA, extra: true }));

  assert.throws(() => normalizeAdvisoryReviewSourceFacts({ ...factsA,
    captured_population_digest: `sha256:${"a".repeat(64)}` }));
  assert.throws(() => normalizeAdvisoryReviewSourceFacts({ ...factsA, materialization_root: "relative" }));

  const link = path.join(root, "checkout-link");
  symlinkSync(checkoutRoot, link);
  assert.equal(digestAdvisoryReviewSourceFacts({ ...factsA, materialization_root: link }), bindingA.digest);
  rmSync(link);
  symlinkSync(repository, link);
  assert.notEqual(digestAdvisoryReviewSourceFacts({ ...factsA, materialization_root: link }), bindingA.digest);

  const facts = resolveLauncherAgentSessionContractFacts(authorityA);
  const required = facts.trustedSourceBindings;
  const authorityBinding = required.find((entry) => entry.kind === STDIO_MCP_CONDUIT_AUTHORITY_SOURCE_BINDING_KIND);
  const other = `sha256:${"e".repeat(64)}`;
  for (const [label, trustedSourceBindings] of [
    ["advisory removed", [authorityBinding]],
    ["authority removed", [bindingA]],
    ["advisory run substituted", [authorityBinding, { ...bindingA, id: "wkdb_run_b" }]],
    ["advisory digest substituted", [authorityBinding, { ...bindingA, digest: other }]],
    ["authority substituted", [{ ...authorityBinding, digest: other }, bindingA]],
    ["advisory duplicated", [authorityBinding, bindingA, { ...bindingA, id: "wkdb_run_b" }]],
    ["authority duplicated", [authorityBinding, { ...authorityBinding, digest: other }, bindingA]]
  ]) {
    assert.throws(() => mintLauncherAgentSessionContract({ ...facts, trustedSourceBindings }),
      (error) => error?.detail?.kind !== undefined, label);
  }
  assert.deepEqual(mintLauncherAgentSessionContract({ ...facts,
    trustedSourceBindings: [...required, { kind: "other_source", id: "x", digest: other }] })
    .minting_provenance.trusted_source_bindings.map((entry) => entry.kind),
  [ADVISORY_REVIEW_SOURCE_BINDING_KIND, "other_source", STDIO_MCP_CONDUIT_AUTHORITY_SOURCE_BINDING_KIND]);

  const unboundFacts = resolveLauncherAgentSessionContractFacts(authority("reviewer"));
  assert.deepEqual(unboundFacts.trustedSourceBindings.map((entry) => entry.kind),
    [STDIO_MCP_CONDUIT_AUTHORITY_SOURCE_BINDING_KIND]);
  assert.throws(() => mintLauncherAgentSessionContract({ ...unboundFacts,
    trustedSourceBindings: [...unboundFacts.trustedSourceBindings, bindingA] }));

  const boundB = bindAdvisoryReviewInputToRun(preparedAdvisoryInput({ repository, checkoutRoot }), "wkdb_run_b");
  const authorityB = advisoryAuthority({ repository, input: boundB });
  const contractB = resolveLauncherAgentSessionContract(authorityB);
  const [bindingB] = sourceBindings(contractB, ADVISORY_REVIEW_SOURCE_BINDING_KIND);
  assert.equal(bindingB.id, "wkdb_run_b");
  assert.notEqual(bindingB.digest, bindingA.digest);
  assert.notEqual(contractB.contract_digest, contractA.contract_digest);
  for (const presented of [contractA, redigest(structuredClone(contractA))]) {
    assert.throws(() => authenticateLauncherAgentSessionContract({ contract: presented,
      expectedFacts: resolveLauncherAgentSessionContractFacts(authorityB) }),
    (error) => refusalCode(error) === "session_contract_fact_mismatch");
    assert.throws(() => authenticateLauncherAgentSessionContract({ contract: presented,
      expectedContract: contractB }),
    (error) => refusalCode(error) === "session_contract_fact_mismatch");
  }
});
