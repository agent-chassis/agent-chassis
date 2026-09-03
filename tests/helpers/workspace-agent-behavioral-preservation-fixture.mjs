

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BehavioralPreservationPairError
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-behavioral-preservation-evidence.mjs";
import {
  buildTestProofRuntimeEvidence,
  compareTestProofInventories,
  digestTestProofEvidence,
  projectBoundaryTraversal,
  projectFalsifierExecution,
  stableRuntimeTestId
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-evidence.mjs";
import {
  mintLauncherTestProofAttemptContext,
  mintManagedWorkerTestProofRuntimeAuthority
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import { mintManagedWorkerTestRunAuthority } from
  "../../packages/agent-launch-cli/src/lib/managed-worker-test-run-authority.mjs";
import { TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST } from
  "../../packages/controlled-contract/current.mjs";

const digestBytes = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const providerFacts = (providerId, capability, mechanism, artifactTypes) => ({
  provider_id: providerId, provider_version: "1.0.0", capability,
  capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  observation_mechanism: mechanism, evidence_artifact_types: artifactTypes
});

export const pairRefusal = (code) => (error) =>
  error instanceof BehavioralPreservationPairError && error.code === code;

export const forwardedRefusal = (code) => (error) =>
  !(error instanceof BehavioralPreservationPairError) && error.code === code;

export async function mintBehavioralPreservationSide(root, {
  name,
  wkId = "WK-2064",
  sliceId = "SLICE-006",
  runId,
  target = "pair-target.test.mjs",
  verificationId = "claim-verify-slice-006",
  contractBytes = "{}\n",
  repoName = "main"
}) {
  const mainRepo = path.join(root, repoName);
  const worktree = path.join(root, name);
  await mkdir(mainRepo, { recursive: true });
  await mkdir(path.join(worktree, "wiki/contracts"), { recursive: true });
  const filename = `${wkId}.controlled-acceptance.json`;
  await writeFile(path.join(worktree, "wiki/contracts", filename), contractBytes);
  await writeFile(path.join(worktree, target), `// ${name}\n`);
  const testId = stableRuntimeTestId(`${target} :: 0 :: pair target`);
  const binding = {
    test_proof_id: "test-proof-pair",
    verification_claim_id: verificationId,
    system_under_test_boundary: { boundary_id: "sut-boundary-pair", kind: "module",
      runtime_module_path: "pair-dependency.mjs", subject_reference_ids: ["ref-runtime"] },
    observable_result: { observable_id: "observable-test-result", kind: "return_value",
      proposition_id: "prop-runtime" },
    candidate_execution_provider: { provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution" },
    falsifiers: [{ falsifier_id: "falsifier-pair", strategy: "dependency_failure",
      proposition_id: "prop-runtime-fails", expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-pair", mechanism: "module_substitution",
        target_kind: "module", module_path: "pair-dependency.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: "1.0.0", capability: "falsifier_execution" } }],
    traversal_provider: { mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },
    coverage_disposition: { baseline_id: "coverage-baseline-pair",
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: testId, disposition: "preserved" }] },
    prohibited_shortcuts: ["source_text_inspection"]
  };
  const authority = mintManagedWorkerTestProofRuntimeAuthority({
    authority: mintManagedWorkerTestRunAuthority({
      mainRepo,
      commitBinding: { subject: `${wkId}#${sliceId}`,
        write_scope_source: `wiki/work-records/${wkId}.json#${sliceId}`,
        worktree_path: worktree, source_digest: digestBytes("source"),
        launch_ref: `refs/heads/slice/IN-0038/${wkId}/${sliceId}`, run_id: runId }
    })
  });
  const contentDigest = digestBytes(
    await readFile(path.join(worktree, "wiki/contracts", filename))
  );
  const carriers = [{
    filename,
    content_digest: contentDigest,
    source_member: {
      schema_version: "controlled-contract-authenticated-runtime-member.v1",
      storage_mode: "legacy_root",
      logical_filename: filename,
      repository_relative_path: `wiki/contracts/${filename}`,
      content_digest: contentDigest,
      manifest_generation: null,
      manifest_content_digest: null
    }
  }];
  const context = mintLauncherTestProofAttemptContext({
    authority, target, authorizedTargets: [target], verificationId,
    controlledContractSelection: {
      status: "complete", wk_id: wkId, focus: null, requested_count: 1, matched_count: 1,
      content_digest: carriers[0].content_digest,
      controlled_contract_generation: digestBytes(Buffer.from(`${JSON.stringify({
        schema_version: "controlled-contract-generation.v1", wk_id: wkId,
        carriers: carriers.map(({ filename: name, content_digest: digest }) => ({
          filename: name, content_digest: digest
        }))
      }, null, 2)}\n`, "utf8")),
      controlled_contract_generation_schema_version: "controlled-contract-generation.v1",
      controlled_contract_generation_carrier_count: 1,
      controlled_contract_generation_carriers: carriers,
      contract_schema_version: "controlled-acceptance-contract.v1",
      bindings: [binding]
    }
  });
  return { context, attempt: buildAttempt(context, testId, target, verificationId) };
}

function buildAttempt(context, testId, target, verificationId, identityPatch = {}) {
  const artifacts = [["c", "boundary_trace"], ["d", "falsifier_result"],
    ["e", "structured_test_result"]].map(([character, kind]) => ({
    artifact_id: `artifact-${digestTestProofEvidence({ fixture: character }).slice(7)}`,
    kind, digest: digestTestProofEvidence({ fixture: character }), owner: "launcher",
    payload: { fixture: character }
  }));
  return buildTestProofRuntimeEvidence({
    evidenceIdentity: { ...context.evidence_identity, ...identityPatch },
    contractBinding: context.contract_binding,
    executionResult: { status: "passed", exit_code: 0,
      attempt_id: `attempt-${"a".repeat(64)}`,
      structured_result: { mechanism: "node_test_structured_events", exit_code: 0,
        summary: { passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0, tests: 1 },
        pass_events: [{ type: "test:pass", name: "pair target", test_id: testId,
          file: target, nesting: 0, status: "passed" }], fail_events: [] },
      evidence_artifact_ids: [artifacts[2].artifact_id],
      provider: providerFacts("launcher.node-test", "candidate_execution",
        "node_test_structured_events", ["structured_test_result"]) },
    testInventory: compareTestProofInventories({
      baselineId: "coverage-baseline-pair", declaredTestIds: [testId],
      baselineExecutedTestIds: [testId], observedTestIds: [testId],
      executedTestIds: [testId], skippedTestIds: [] }),
    boundaryTraversals: [projectBoundaryTraversal({
      boundaryId: "sut-boundary-pair", observableId: "observable-test-result",
      providerSupport: "supported", authenticated: true, observed: true,
      boundaryKind: "module", observationMechanism: "node_test_v8_coverage",
      observationSeam: "node_test_structured_assertion",
      artifactIds: [artifacts[0].artifact_id],
      provider: providerFacts("launcher.node-test-v8-coverage", "boundary_traversal",
        "node_test_v8_coverage", ["boundary_trace", "structured_test_result"]) })],
    falsifierExecutions: [projectFalsifierExecution({
      falsifierId: "falsifier-pair", attemptId: `attempt-${"f".repeat(64)}`,
      targetVerificationId: verificationId,
      expectedFailureReasonCode: "test_proof_fault.dependency_failure.v1",
      isolated: true, candidateStatus: "passed", falsifiedStatus: "failed",
      observedFailureReasonCode: "test_proof_fault.dependency_failure.v1",
      mutation: { mutation_id: "mutation-pair", strategy: "dependency_failure",
        mechanism: "module_substitution", target_kind: "module",
        module_path: "pair-dependency.mjs" },
      mutationObserved: true, artifactIds: [artifacts[1].artifact_id],
      provider: providerFacts("launcher.node-test-module-fault", "falsifier_execution",
        "node_test_structured_events", ["falsifier_result", "structured_test_result"]) })],
    artifacts
  });
}

export async function mintBehavioralPreservationPair(t, candidateOverrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "behavioral-preservation-pair-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    baseline: await mintBehavioralPreservationSide(root, {
      name: "baseline", runId: "run-baseline"
    }),
    candidate: await mintBehavioralPreservationSide(root, {
      name: "candidate", runId: "run-candidate", ...candidateOverrides
    })
  };
}
