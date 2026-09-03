import { evaluateStableProofPackFixtureV1 } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION } from
  "../support/proof-pack-adequacy-constants.mjs";
import { buildCompletePaginationProfileFixture } from
  "./complete-pagination-traversal-v1-fixture.mjs";
import {
  COMPLETE_TRAVERSAL_MUTANT_IDS,
  executeCompleteTraversalMutant,
  executeCompleteTraversalPositive
} from "./complete-pagination-traversal-v1-harness.mjs";

const POSITIVE_CASES = Object.freeze({
  "empty-traversal": { member_ids: [], page_sizes: [0] },
  "singleton-traversal": { member_ids: ["member-alpha"], page_sizes: [1] },
  "page-size-one": { page_sizes: [1, 1, 1, 1, 1] },
  "exact-page-multiple": {
    member_ids: ["member-a", "member-b", "member-c", "member-d"],
    page_sizes: [2, 2]
  },
  "partial-final-page": { page_sizes: [2, 2, 1] },
  "multi-page-shape-a": { page_sizes: [1, 3, 1], snapshot_id: "snapshot-shape-a" },
  "multi-page-shape-b": { page_sizes: [3, 1, 1], version_id: "version-shape-b" },
  "multi-page-shape-c": { page_sizes: [1, 1, 3], snapshot_id: "snapshot-shape-c",
    version_id: "version-shape-c" }
});

const PROFILE_WEAKENINGS = Object.freeze({
  "missing-source-authentication-witness-binding": (profile) => {
    profile.reference_roles = profile.reference_roles.filter(
      ({ role }) => role !== "source_authentication_witness"
    );
  },
  "missing-source-of-record-witness-binding": (profile) => {
    profile.reference_roles = profile.reference_roles.filter(
      ({ role }) => role !== "source_of_record_witness"
    );
  },
  "missing-authoritative-population-binding": (profile) => {
    profile.reference_binding_patterns = profile.reference_binding_patterns.filter(
      ({ pattern_id: id }) => id !== "complete-authoritative-occurrence-population"
    );
  },
  "missing-linear-cursor-chain": (profile) => {
    profile.reference_binding_patterns = profile.reference_binding_patterns.filter(
      ({ pattern_id: id }) => id !== "complete-cursor-transition-population"
    );
  },
  "missing-exact-order-equality": (profile) => {
    profile.claim_patterns = profile.claim_patterns.filter(
      ({ pattern_id: id }) => id !== "traversal-has-exact-order"
    );
  },
  "missing-terminal-uniqueness": (profile) => {
    profile.claim_patterns = profile.claim_patterns.filter(
      ({ pattern_id: id }) => id !== "terminal-page-completes-traversal"
    );
  },
  "missing-duplicate-refusal": (profile) => {
    profile.reference_binding_patterns = profile.reference_binding_patterns.filter(
      ({ pattern_id: id }) => id !== "complete-equality-normalized-member-population"
    );
  },
  "missing-snapshot-version-preservation": (profile) => {
    profile.claim_patterns = profile.claim_patterns.filter(({ pattern_id: id }) =>
      !["each-page-resolves-snapshot", "each-page-uses-version"].includes(id)
    );
  },
  "missing-resource-refusal-binding": (profile) => {
    const pattern = profile.claim_patterns.find(
      ({ pattern_id: id }) => id === "verification-reads-exact-traversal-bindings"
    );
    pattern.proposition_template.operands = pattern.proposition_template.operands.filter(
      ({ role }) => ![
        "aggregate_input_accounting", "canonical_result_accounting", "work_accounting"
      ].includes(role)
    );
  }
});

const requiredRoles = Object.freeze([
  "attempt_binding_witness", "authentication_capture", "authentication_witness",
  "source_authentication_witness", "source_of_record_witness",
  "target_resolution_witness"
]);
const requiredBindingPatterns = Object.freeze([
  "complete-authoritative-occurrence-population",
  "complete-cursor-transition-population",
  "complete-equality-normalized-member-population",
  "complete-returned-occurrence-population",
  "complete-returned-page-population"
]);
const requiredClaimPatterns = Object.freeze([
  "authentication-occurrence-authenticates-population",
  "each-page-resolves-snapshot",
  "each-page-uses-version",
  "population-has-authenticated-source-of-record",
  "terminal-page-completes-traversal",
  "traversal-has-exact-order",
  "verification-reads-exact-traversal-bindings"
]);

function completeTraversalProfileConforms(profile) {
  const roles = new Set(profile.reference_roles?.map(({ role }) => role));
  const bindings = new Set(profile.reference_binding_patterns?.map(
    ({ pattern_id: id }) => id
  ));
  const claims = new Set(profile.claim_patterns?.map(({ pattern_id: id }) => id));
  const reads = new Set(profile.claim_patterns?.find(({ pattern_id: id }) =>
    id === "verification-reads-exact-traversal-bindings"
  )?.proposition_template.operands.map(({ role }) => role) ?? []);
  return profile.profile_id === "proof.pagination.complete-traversal" &&
    profile.profile_version === "2.0.0" &&
    requiredRoles.every((role) => roles.has(role)) &&
    requiredBindingPatterns.every((id) => bindings.has(id)) &&
    requiredClaimPatterns.every((id) => claims.has(id)) &&
    ["aggregate_input_accounting", "canonical_result_accounting", "work_accounting"]
      .every((role) => reads.has(role));
}

function runCompletePaginationAdequacy(profile) {
  const controls = [];
  for (const [controlId, options] of Object.entries(POSITIVE_CASES)) {
    const execution = executeCompleteTraversalPositive(options);
    const fixture = buildCompletePaginationProfileFixture({ profile, trace_options: options });
    controls.push({
      control_id: controlId,
      category: "positive",
      implementation_outcome: execution.result.policy === "complete_traversal"
        ? "passed" : "failed",
      profile_satisfaction: evaluateStableProofPackFixtureV1({
        contract: fixture.contract, profile, evaluation_input: fixture.input
      }).satisfaction
    });
  }
  for (const controlId of COMPLETE_TRAVERSAL_MUTANT_IDS) {
    const execution = executeCompleteTraversalMutant(controlId);
    controls.push({
      control_id: controlId,
      category: "mutant",
      implementation_outcome: execution.killed ? "killed" : "survived",
      profile_satisfaction: "not_evaluated"
    });
  }
  for (const [controlId, weaken] of Object.entries(PROFILE_WEAKENINGS)) {
    const mutant = structuredClone(profile);
    weaken(mutant);
    controls.push({
      control_id: controlId,
      category: "profile_rejection",
      implementation_outcome: "not_applicable",
      profile_satisfaction: completeTraversalProfileConforms(mutant)
        ? "satisfied" : "invalid"
    });
  }
  return {
    controls,
    passed: completeTraversalProfileConforms(profile) && controls.every((control) =>
      control.implementation_outcome !== "failed" &&
      control.implementation_outcome !== "survived" &&
      control.profile_satisfaction !== "invalid" &&
      control.profile_satisfaction !== "unsatisfied"
    ),
    positive_count: Object.keys(POSITIVE_CASES).length,
    mutant_count: COMPLETE_TRAVERSAL_MUTANT_IDS.length,
    profile_weakening_count: Object.keys(PROFILE_WEAKENINGS).length
  };
}

const GUARANTEE_DIGEST =
  "c5ad980aa18bc912f1364789e814675e45343e85f3ebf56702f932b357323414";

async function runProofPackAdequacyControls({ profile, profile_digest: profileDigest }) {
  const result = runCompletePaginationAdequacy(profile);
  const baseline = buildCompletePaginationProfileFixture({ profile });
  const satisfaction = evaluateStableProofPackFixtureV1({
    contract: baseline.contract,
    profile,
    evaluation_input: baseline.input
  }).satisfaction;
  const exclusions = [
    "caller-declared-population-completeness", "cas-linearizability",
    "cross-contract-result-join", "cross-pack-result-join", "runtime-truth",
    "snapshot-acquisition-atomicity", "traversal-liveness",
    "unrepresented-concurrency"
  ].map((controlId) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: satisfaction
  }));
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest,
    guarantee_digest: GUARANTEE_DIGEST,
    controls: [...result.controls, ...exclusions]
  };
}

export {
  POSITIVE_CASES,
  PROFILE_WEAKENINGS,
  completeTraversalProfileConforms,
  runCompletePaginationAdequacy,
  runProofPackAdequacyControls
};
