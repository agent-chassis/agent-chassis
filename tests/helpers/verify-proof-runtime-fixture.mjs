import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mintManagedWorkerTestRunAuthority } from
  "../../packages/agent-launch-cli/src/lib/managed-worker-test-run-authority.mjs";
import { mintManagedWorkerTestProofRuntimeAuthority, mintLauncherTestProofAttemptContext } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import { stableRuntimeTestIdFromParts } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-reporter.mjs";
import { sha256 } from "../../packages/controlled-contract/lib/deterministic-projection-primitives.mjs";
import { TEST_PROOF_PROVIDER_CATALOG } from
  "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";
import { loadAdmittedProofPack } from
  "../../packages/controlled-contract/lib/admitted-proof-packs.mjs";
import { executeVerifyProofForContext } from
  "../../packages/wiki-mcp/src/lib/verify-proof-execution.mjs";
import { normalizeFalsifierFacts } from "../../packages/controlled-contract/lib/test-proof-evidence-semantic-kernel.mjs";

const DETECTED_FALSIFIER_FACTS = normalizeFalsifierFacts({ declaredFalsifierIds: ["falsifier"],
  executions: [{ falsifier_id: "falsifier", status: "detected", provider_support: "supported",
    isolated: true, candidate_status: "passed", falsified_status: "failed",
    failure_reason_code: "assertion_failed", mutation: { observed: true } }],
  declaredUnsupported: false });
const digest = value => `sha256:${sha256(value)}`;

export function currentProviderBinding(providerId, capability) {
  const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: id }) => id === providerId);
  if (!descriptor || !descriptor.capabilities.includes(capability)) {
    throw new Error(`current provider registry has no ${providerId} ${capability} descriptor`);
  }
  return { provider_id: descriptor.provider_id, provider_version: descriptor.provider_version, capability };
}

export function runtimeFixture(t, source, { selector = { name: "selected", nesting: 1 },
  dependencySource = "export function value() { return 42; }\n",
  dependencyPath = "dependency.mjs", falsificationSupport = "provider" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "wk2516-attempt-"));
  const mainRepo = path.join(root, "main");
  const worktree = path.join(root, "worktree");
  mkdirSync(mainRepo); mkdirSync(worktree);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = "nested.test.mjs";
  const selectedId = stableRuntimeTestIdFromParts({ file: target, name: selector.name,
    nesting: selector.nesting });
  writeFileSync(path.join(worktree, target), source);
  mkdirSync(path.dirname(path.join(worktree, dependencyPath)), { recursive: true });
  writeFileSync(path.join(worktree, dependencyPath), dependencySource);
  const launcherLib = "packages/agent-launch-cli/src/lib";
  mkdirSync(path.join(worktree, launcherLib), { recursive: true });
  for (const name of ["workspace-agent-test-proof-error-diagnostic.mjs",
    "workspace-agent-test-proof-node-reporter.mjs",
    "workspace-agent-test-proof-module-fault-loader.mjs", "workspace-agent-test-proof-module-fault-contract.mjs"]) {
    writeFileSync(path.join(worktree, launcherLib, name), readFileSync(path.join(process.cwd(), launcherLib, name)));
  }
  const filename = "WK-2516.controlled-acceptance.json";
  const content = "{}\n";
  const generationId = digest(content).slice(7);
  const relative = `wiki/contracts/.carrier-generations/${generationId}/${filename}`;
  mkdirSync(path.dirname(path.join(worktree, relative)), { recursive: true });
  writeFileSync(path.join(worktree, relative), content);
  const member = { member_kind: "carrier", carrier_kind: "contract", filename,
    path: relative.slice("wiki/contracts/".length), content_digest: digest(content),
    byte_length: Buffer.byteLength(content) };
  const manifestBody = { schema_version: "controlled-contract-carrier-set-manifest.v1",
    repository: "fixture/repo", wk_id: "WK-2516", focus: null,
    profile: { profile_id: "canonical_authoring", profile_version: "1.0.0" },
    generation: { id: generationId, path: `.carrier-generations/${generationId}` },
    carriers: [member], carrier_census: [member] };
  const manifestBytes = `${JSON.stringify({ ...manifestBody,
    manifest_digest: digest(JSON.stringify(manifestBody)) })}\n`;
  writeFileSync(path.join(worktree, "wiki/contracts/WK-2516.carrier-set-manifest.json"), manifestBytes);
  writeFileSync(path.join(worktree, path.dirname(relative), "manifest.json"), manifestBytes);
  const binding = {
    test_proof_id: "test-proof-fixture", verification_claim_id: "claim-verification-fixture",
    system_under_test_boundary: { boundary_id: "sut-boundary-dependency", kind: "module",
      runtime_module_path: dependencyPath, subject_reference_ids: ["ref-dependency"] },
    observable_result: { observable_id: "observable-value", kind: "return_value", proposition_id: "prop-value-is-42" },
    candidate_execution_provider: currentProviderBinding("launcher.node-test", "candidate_execution"),

    ...(falsificationSupport === "registry_unsupported" ? { falsifiers: [],
      falsification_provider: { mode: "registry_unsupported",
        registry_id: "launcher.test-proof-provider-registry", registry_version: "1.3.0" } }
      : { falsifiers: [{ falsifier_id: "falsifier-dependency-failure", strategy: "dependency_failure",
        proposition_id: "prop-value-fails", expected_outcome: "verification_fails",
        mutation: { mutation_id: "mutation-dependency-fault", mechanism: "module_substitution", target_kind: "module", module_path: dependencyPath },
        execution_provider: currentProviderBinding("launcher.node-test-module-fault", "falsifier_execution") }] }),
    traversal_provider: { mode: "provider",
      ...currentProviderBinding("launcher.node-test-v8-coverage", "boundary_traversal"),
      boundary_kind: "module", observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", evidence_artifact_type: "boundary_trace" },
    test_selector: { name: selector.name, nesting: selector.nesting },
    prohibited_shortcuts: ["source_text_inspection"]
  };
  const carrier = { filename, content_digest: digest(content), source_member: {
    schema_version: "controlled-contract-authenticated-runtime-member.v1", storage_mode: "manifest_generation",
    logical_filename: filename, repository_relative_path: relative, content_digest: digest(content),
    manifest_generation: generationId, manifest_content_digest: digest(manifestBytes) } };
  const generation = { schema_version: "controlled-contract-generation.v1", wk_id: "WK-2516",
    carriers: [{ filename, content_digest: digest(content) }] };
  const selection = { status: "complete", wk_id: "WK-2516", focus: null, requested_count: 1, matched_count: 1,
    content_digest: digest(content), controlled_contract_generation: digest(`${JSON.stringify(generation, null, 2)}\n`),
    controlled_contract_generation_schema_version: generation.schema_version,
    controlled_contract_generation_carrier_count: 1, controlled_contract_generation_carriers: [carrier],
    contract_schema_version: "controlled-acceptance-contract.v1", bindings: [binding] };
  const authority = mintManagedWorkerTestProofRuntimeAuthority({ authority: mintManagedWorkerTestRunAuthority({
    mainRepo, commitBinding: { subject: "WK-2516#SLICE-003", write_scope_source: "wiki/work-records/WK-2516.json#SLICE-003",
      worktree_path: worktree, source_digest: digest("commit"), launch_ref: "refs/heads/slice/IN-0038/WK-2516/SLICE-003", run_id: "run-wk2516-fixture" }
  }) });
  const context = mintLauncherTestProofAttemptContext({ authority, target, authorizedTargets: [target],
    controlledContractSelection: selection, verificationId: "claim-verification-fixture" });
  return { context, target, selectedId, worktree, binding, selection, authority,
    definition_digest: digest(JSON.stringify(binding)) };
}

export function contractAround(binding) {

  return {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    test_proof_version: "controlled-contract-test-proof.v1",
    references: [{ reference_id: "ref-dependency", type_term: "cc:runtime_component",
      identity: { kind: "profile_term", term: "dependency" } }],
    propositions: [
      { proposition_id: "prop-value-is-42", subject_reference_id: "ref-dependency",
        operator: "boolean:exists",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "boolean", value: true }] },
      { proposition_id: "prop-value-fails", subject_reference_id: "ref-dependency",
        operator: "boolean:exists",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "boolean", value: false }] }
    ],
    claims: [
      { claim_id: "claim-behavior-fixture", kind: "behavior", modality: "MUST",
        proposition_id: "prop-value-is-42" },
      { claim_id: binding.verification_claim_id, kind: "verification", modality: "MUST",
        verification_method: "test_execution", proposition_id: "prop-value-is-42",
        falsifying_proposition_id: "prop-value-fails" }
    ],
    relations: [{ relation_id: "rel-verifies-fixture", role: "verifies",
      source_claim_id: binding.verification_claim_id,
      target_claim_id: "claim-behavior-fixture" }],
    collections: [], residue: [], annotations: [],
    test_proofs: [binding]
  };
}

export async function executeIndependentProofScenario(t, statuses, {
  relationships = null, attempt = null,
  currentness = null, evaluate = null
} = {}) {
  const pack = await loadAdmittedProofPack("proof.verification.test-validity");
  const generation = `sha256:${"1".repeat(64)}`;
  const contractDigest = `sha256:${"2".repeat(64)}`;
  const proofs = statuses.map((status, index) => {
    const suffix = String(index);
    const target = `proof-${suffix}.test.mjs`;
    const verificationId = `claim-independent-${suffix}`;
    const relationIds = relationships?.[index] ?? [`OBL-${suffix}`];
    return {
      execution_key: `execution-${suffix}`,
      test_proof_id: `test-proof-independent-${suffix}`,
      verification_id: verificationId,
      test_proof: { test_proof_id: `test-proof-independent-${suffix}`,
        verification_claim_id: verificationId,
        test_selector: { name: `selected ${suffix}`, nesting: 0 } },
      declared_target: { status: status === "missing_file" ? "missing" : "resolved",
        target, source_snapshot_digest: `sha256:${"6".repeat(64)}` },
      relationships: relationIds.map((obligationId) => ({ obligation_id: obligationId,
        relation_ids: [], selected_definition: {
          proof_name: pack.profile.profile_id, proof_version: pack.profile.profile_version,
          profile_digest: pack.profile_digest, admission_digest: pack.admission_digest,
          parameter_contract_digest: pack.parameter_contract_digest
        }, resolved_node_identity: `${index}`.padStart(64, "b"), behavior_claim_ids: [] })),
      ...(status === "missing_file" ? { failure: {
        reason_code: "verify_proof.declared_target_missing.v1",
        test_proof_id: `test-proof-independent-${suffix}`
      } } : {})
    };
  });
  const eligible = proofs.filter((_proof, index) => statuses[index] !== "missing_file");
  const ineligible = proofs.filter((_proof, index) => statuses[index] === "missing_file");
  const resolution = {
    schema_version: "controlled-contract-verify-proof-population-resolution.v3",
    status: eligible.length ? "executable" : "not_executable",
    subject: { requested: "WK-2583", kind: "wk", canonical_id: "WK-2583" },
    wk_id: "WK-2583", contract_generation: generation, contract_digest: contractDigest,
    obligation_coverage_digest: `sha256:${"3".repeat(64)}`,
    execution_source_binding: { binding_digest: `sha256:${"4".repeat(64)}`,
      contract_digest: contractDigest },
    execution_pack: pack, proofs, eligible, ineligible,
    diagnostics: ineligible.map((proof) => proof.failure)
  };
  const state = { attempts: [], currentnessChecks: 0, evaluations: [], semanticFacts: [] };
  const runtime = { role: "reviewer", candidateIdentity: "a".repeat(40),
    authority: { wk_id: "WK-2583", selected_unit: "WK-2583#SLICE-004",
      worktree_path: "/frozen", candidate_identity: "a".repeat(40) },
    assertCurrentIdentity: async () => {
      state.currentnessChecks += 1;
      await currentness?.(state);
    } };
  const selection = { status: "complete", requested_count: eligible.length,
    matched_count: eligible.length, controlled_contract_generation: generation,
    content_digest: contractDigest, derived_contract_digest: contractDigest,
    bindings: eligible.map((proof) => proof.test_proof) };
  const result = await executeVerifyProofForContext({ args: { subject: "WK-2583" },
    resolutionContext: {}, runtime, deps: {
      resolveVerifyProofOperation: () => resolution,
      resolveBindings: async () => selection,
      executeLauncherVerifyProofReceiptPopulation: async (input) => {
        const verificationId = input.validationBindings[input.targets[0]][0];
        const proof = proofs.find((row) => row.verification_id === verificationId);
        state.attempts.push(verificationId);
        if (attempt) await attempt({ input, proof, state });
        const selectedId = stableRuntimeTestIdFromParts({ file: proof.declared_target.target,
          name: proof.test_proof.test_selector.name, nesting: 0 });
        const selectedStatus = statuses[proofs.indexOf(proof)] === "failing" ? "failed" : "passed";
        return { evidence_by_target: { [proof.declared_target.target]: [{
          evidence_identity: { evidence_id: `evidence-${verificationId}` },
          capability_limitations: [],
          execution_result: { status: selectedStatus, exit_code: selectedStatus === "passed" ? 0 : 1,
            structured_result: {
              pass_events: selectedStatus === "passed" ? [{ test_id: selectedId,
                file: proof.declared_target.target, name: proof.test_proof.test_selector.name,
                nesting: 0, status: "passed" }] : [],
              fail_events: selectedStatus === "failed" ? [{ test_id: selectedId,
                file: proof.declared_target.target, name: proof.test_proof.test_selector.name,
                nesting: 0, status: "failed" }] : []
            } }
        }] } };
      },
      evaluateSemantics: ({ resolution: relationship, expected }) => {
        state.evaluations.push(relationship.obligation_id);
        const proof = proofs.find((row) => row.verification_id === relationship.verification_id);
        const passed = statuses[proofs.indexOf(proof)] !== "failing";
        const semanticFacts = { schema_version: "controlled-contract-test-proof-semantic-facts.v1",
          status: "facts", authority: "non_authoritative",
          obligation_id: relationship.obligation_id,
          execution_identity: { run_id: "run-independent", attempt: 1,
            candidate: { identity: "a".repeat(40), role: "reviewer" },
            source_snapshot_digest: `sha256:${"6".repeat(64)}` },
          receipt_population: { count: 1, receipt_digests: [`sha256:${"7".repeat(64)}`],
            digest: `sha256:${"8".repeat(64)}` },
          facts: { candidate: { status: passed ? "passed" : "failed", passed },
            inventory: { declared_test_ids: ["selected"], discovered_test_ids: ["selected"],
              executed_test_ids: ["selected"], skipped_test_ids: [], observed_test_count: 1 },
            falsifiers: DETECTED_FALSIFIER_FACTS,
            traversal: { observations: [{ boundary_id: "boundary", observable_id: "observable",
              provider_support: "supported", status: "proven", proven: true }],
              complete: true, all_proven: true },
            prohibited_shortcuts: { observed: [], violated: [] } },
          facts_digest: `sha256:${"9".repeat(64)}` };
        const evaluated = evaluate
          ? evaluate({ relationship, expected, state, semanticFacts })
          : semanticFacts;
        state.semanticFacts.push(structuredClone(evaluated));
        return evaluated;
      }
    } }).catch((error) => {
      Object.defineProperty(error, "verifyProofTestState", { value: state });
      throw error;
    });
  return { result, state, resolution, runtime };
}
