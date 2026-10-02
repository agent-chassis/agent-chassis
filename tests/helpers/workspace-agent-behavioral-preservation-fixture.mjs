

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BehavioralPreservationPairError
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-behavioral-preservation-evidence.mjs";
import {
  buildTestProofRuntimeEvidence,
  projectBoundaryTraversal,
  projectFalsifierExecution,
  projectTestProofInventory,
  stableRuntimeTestId
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-evidence.mjs";
import {
  mintLauncherTestProofAttemptContext,
  mintManagedWorkerTestProofRuntimeAuthority
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import { observeLauncherNodeTestRun } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-observation.mjs";
import {
  TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION,
  describeTestProofModuleFaultAttempt
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-module-fault-contract.mjs";
import launcherTestProofReporter from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-reporter.mjs";
import { mintManagedWorkerTestRunAuthority } from
  "../../packages/agent-launch-cli/src/lib/managed-worker-test-run-authority.mjs";
import { TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST } from
  "../../packages/controlled-contract/current.mjs";
import { TEST_PROOF_PROVIDER_CATALOG } from
  "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";

const SELECTED_TEST_NAME = "pair target";
const DEPENDENCY_PATH = "pair-dependency.mjs";
const FAULT_REASON_CODE = "test_proof_fault.dependency_failure.v1";
const digestBytes = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const currentProvider = (providerId, capability) => {
  const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: id }) => id === providerId);
  if (!descriptor?.capabilities.includes(capability)) {
    throw new Error(`current provider registry has no ${providerId} ${capability} descriptor`);
  }
  return { provider_id: providerId, provider_version: descriptor.provider_version, capability };
};
const providerFacts = (providerId, capability, mechanism, artifactTypes) => ({
  ...currentProvider(providerId, capability),
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
    candidate_execution_provider: currentProvider("launcher.node-test", "candidate_execution"),
    falsifiers: [{ falsifier_id: "falsifier-pair", strategy: "dependency_failure",
      proposition_id: "prop-runtime-fails", expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-pair", mechanism: "module_substitution",
        target_kind: "module", module_path: "pair-dependency.mjs" },
      execution_provider: currentProvider("launcher.node-test-module-fault", "falsifier_execution") }],
    traversal_provider: { mode: "provider",
      ...currentProvider("launcher.node-test-v8-coverage", "boundary_traversal"), boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },

    test_selector: { name: "pair target", nesting: 0 },
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
  return { context, attempt: await buildAttempt(context, worktree, testId, target, verificationId) };
}

const selectedFile = (target) => path.join(process.cwd(), target);
const selectedOutcome = (target, passed) => ({
  type: passed ? "test:pass" : "test:fail",
  data: { file: selectedFile(target), name: SELECTED_TEST_NAME, nesting: 0,
    details: { type: "test", ...(passed ? {} : { error: { code: "ERR_ASSERTION" } }) } }
});
const coverage = (rows) => ({ type: "test:coverage", data: { summary: {
  workingDirectory: process.cwd(), files: rows.map(([modulePath, functions]) => ({
    path: path.join(process.cwd(), modulePath), coveredLineCount: 1, functions })) } } });

async function observeRun(expectation, events) {
  const tests = events.filter(({ type }) => type === "test:pass" || type === "test:fail");
  const failed = tests.filter(({ type }) => type === "test:fail").length;
  async function* source() {
    yield* events;
    yield { type: "test:summary", data: { counts: { passed: tests.length - failed, failed,
      skipped: 0, cancelled: 0, todo: 0, tests: tests.length } } };
  }
  let stdout = "";
  for await (const chunk of launcherTestProofReporter(source())) stdout += chunk;
  const observation = observeLauncherNodeTestRun({ stdout, exitCode: failed > 0 ? 1 : 0,
    expectation });
  if (observation.valid !== true) {
    throw new Error(`launcher observation refused the fixture run: ${observation.code}`);
  }
  return observation;
}

async function observeSide(worktree, testId, target) {
  const candidate = await observeRun({ capability: "candidate_execution", target,
    target_test_id: testId }, [selectedOutcome(target, true)]);
  const attempt = describeTestProofModuleFaultAttempt({
    schema_version: TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION, strategy: "dependency_failure",
    mechanism: "module_substitution", mutation_id: "mutation-pair",
    module_path: DEPENDENCY_PATH, failure_reason_code: FAULT_REASON_CODE,
    attempt_nonce: "a".repeat(64)
  }, worktree);
  const falsifier = await observeRun({ capability: "falsifier_execution",
    falsifier_id: "falsifier-pair", strategy: attempt.configuration.strategy,
    configuration: structuredClone(attempt.configuration),
    mutation_attestation_code: attempt.mutation_attestation_code,
    fault_module_identity: attempt.fault_module_identity,
    target, target_test_id: testId }, [selectedOutcome(target, false),
    coverage([[DEPENDENCY_PATH, [{ name: "value", count: 0 }]],
      [DEPENDENCY_PATH, Object.keys(attempt.witness_names).map((base) => ({
        name: `${base}_${attempt.witness_identity}`,
        count: base === "launcherObservedDependencyInvocation" ? 1 : 0 }))]])]);
  const traversal = await observeRun({ capability: "boundary_traversal", target,
    target_test_id: testId, module_path: DEPENDENCY_PATH,
    observation_seam: "node_test_structured_assertion" }, [selectedOutcome(target, true),
    coverage([[DEPENDENCY_PATH, [{ name: "value", count: 1 }]]])]);
  return { candidate, falsifier, traversal };
}

async function buildAttempt(context, worktree, testId, target, verificationId,
  identityPatch = {}) {
  const { candidate, falsifier, traversal } = await observeSide(worktree, testId, target);
  const ids = (artifacts) => artifacts.map(({ artifact_id: id }) => id);
  const artifacts = [...new Map([...candidate.artifacts, ...falsifier.artifacts,
    ...traversal.artifacts].map((artifact) => [artifact.artifact_id, artifact])).values()]
    .map(({ artifact_id: artifactId, kind, digest, payload }) => ({ artifact_id: artifactId,
      kind, digest, owner: "launcher", payload: structuredClone(payload) }));
  return buildTestProofRuntimeEvidence({
    evidenceIdentity: { ...context.evidence_identity, ...identityPatch },
    contractBinding: context.contract_binding,
    executionResult: { status: candidate.status, exit_code: 0,
      attempt_id: `attempt-${"a".repeat(64)}`,
      structured_result: structuredClone(candidate.structured_result),
      evidence_artifact_ids: ids(candidate.artifacts),
      provider: providerFacts("launcher.node-test", "candidate_execution",
        "node_test_structured_events", ["structured_test_result"]) },
    testInventory: projectTestProofInventory({
      selectedTestId: testId, observedTestIds: candidate.test_inventory.observed_test_ids,
      executedTestIds: candidate.test_inventory.executed_test_ids,
      skippedTestIds: candidate.test_inventory.skipped_test_ids }),
    boundaryTraversals: [projectBoundaryTraversal({
      boundaryId: "sut-boundary-pair", observableId: "observable-test-result",
      providerSupport: "supported", authenticated: true,
      observed: traversal.traversal_observed,
      boundaryKind: "module", observationMechanism: "node_test_v8_coverage",
      observationSeam: "node_test_structured_assertion",
      artifactIds: ids(traversal.artifacts),
      provider: providerFacts("launcher.node-test-v8-coverage", "boundary_traversal",
        "node_test_v8_coverage", ["boundary_trace", "structured_test_result"]) })],
    falsifierExecutions: [projectFalsifierExecution({
      falsifierId: "falsifier-pair", attemptId: `attempt-${"f".repeat(64)}`,
      targetVerificationId: verificationId,
      expectedFailureReasonCode: FAULT_REASON_CODE,
      isolated: true, candidateStatus: candidate.selected_status,
      falsifiedStatus: falsifier.status,
      observedFailureReasonCode: falsifier.failure_reason_code,
      mutation: { mutation_id: "mutation-pair", strategy: "dependency_failure",
        mechanism: "module_substitution", target_kind: "module",
        module_path: DEPENDENCY_PATH },
      mutationObserved: falsifier.mutation_observed, artifactIds: ids(falsifier.artifacts),
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
