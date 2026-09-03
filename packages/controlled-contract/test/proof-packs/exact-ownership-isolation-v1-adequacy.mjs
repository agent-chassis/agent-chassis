import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateStableProofPackFixtureV1 } from "../support/stable-v1-proof-pack-runtime.mjs";
import {
  buildExactOwnershipIsolationFixture,
  collapseExactOwnershipRole,
  findExactOwnershipClaim,
  findExactOwnershipProposition,
  removeExactOwnershipClaim,
  exactOwnershipRoleReferenceId
} from "./exact-ownership-isolation-v1-fixture.mjs";
import {
  executeExactOwnershipScenario,
  exactOwnershipImplementationPassed
} from "./exact-ownership-isolation-v1-harness.mjs";

const PROFILE_DIGEST =
  "cd82bf41a005361a7f3cddbd32310bc3d2d1d0d3c725184bb525dd1715ecbebc";
const GUARANTEE_DIGEST =
  "5a3b73c64e5fb0057b749b9cc0422bebd0118b282d213e251b7d43a9f2d41e5c";
function evaluateFixture(profile, fixture) {
  return evaluateStableProofPackFixtureV1({ contract: fixture.contract, profile,
    evaluation_input: fixture.input }).satisfaction;
}
function addDecoy(fixture, role, typeTerm) {
  const id = `ref-decoy-${role.replaceAll("_", "-")}`;
  fixture.contract.references.push({ reference_id: id, type_term: typeTerm,
    identity: { kind: "durable_id", domain: "decoy", value: role } });
  return id;
}
function fixtureForExecution(profile, execution, options = {}) {
  const fixture = buildExactOwnershipIsolationFixture({ domain: execution.domain, ...options });
  if (execution.foreign_subject === execution.legitimate_owner) {
    collapseExactOwnershipRole(fixture, "foreign_subject", "legitimate_owner");
  }
  if (!execution.foreign_refused) {
    findExactOwnershipProposition(
      fixture, "refusal-rejects-foreign-attempt"
    ).operator = "reference:accepts";
  }
  if (execution.targeted_resource !== execution.owned_resource) {
    const decoy = addDecoy(fixture, "owned-resource", "cc:resource");
    findExactOwnershipProposition(
      fixture, "foreign-attempt-targets-owned-resource"
    ).operands = [{ kind: "reference", reference_id: decoy }];
  }
  if (execution.writes_before_refusal > 0) {
    findExactOwnershipClaim(fixture, "no-foreign-write-before-refusal").modality = "MUST";
  }
  if (execution.mutations_before_refusal > 0) {
    findExactOwnershipClaim(fixture, "no-foreign-mutation-before-refusal").modality = "MUST";
  }
  if (JSON.stringify(execution.authority_state_before) !==
      JSON.stringify(execution.authority_state_after)) {
    findExactOwnershipProposition(
      fixture, "legitimate-authority-unconsumed"
    ).operator = "reference:not_equals";
    findExactOwnershipProposition(
      fixture, "nonconsumption-verification", true
    ).operator = "reference:equals";
  }
  if (!execution.later_accepted || JSON.stringify(execution.later_result) !==
      JSON.stringify(execution.expected_result)) {
    findExactOwnershipProposition(
      fixture, "later-result-accepts-attempt"
    ).operator = "reference:rejects";
    findExactOwnershipProposition(
      fixture, "later-valid-attempt-succeeds"
    ).operator = "reference:not_equals";
    findExactOwnershipProposition(
      fixture, "later-success-verification", true
    ).operator = "reference:equals";
  }
  return fixture;
}
function observedControl(profile, { controlId, category, domain = "tenant_document",
  strategy = "refuse_foreign_preserve_authority", options = {} }) {
  const execution = executeExactOwnershipScenario({ domain, strategy });
  return { control_id: controlId, category,
    implementation_outcome: exactOwnershipImplementationPassed(execution)
      ? "passed" : "killed",
    profile_satisfaction: evaluateFixture(profile,
      fixtureForExecution(profile, execution, options)) };
}
function positiveControls(profile) {
  return [
    ["tenant-document-isolation", "tenant_document", {}],
    ["cloud-bucket-isolation", "cloud_bucket", { method: "analysis" }],
    ["payment-account-isolation", "payment_account", { method: "proof" }],
    ["verification-method-audit", "tenant_document", { method: "audit" }],
    ["verification-method-demonstration", "cloud_bucket", { method: "demonstration" }],
    ["resource-repository-path-grounding", "tenant_document", {
      identity_kind_overrides: { owned_resource: "repository_path" } }],
    ["owner-code-symbol-grounding", "cloud_bucket", {
      identity_kind_overrides: { legitimate_owner: "code_symbol" } }],
    ["authority-runtime-parameter-grounding", "payment_account", {
      identity_kind_overrides: { legitimate_authority: "runtime_parameter" } }],
    ["capability-typed-authority", "tenant_document", {
      role_type_overrides: { legitimate_authority: "cc:capability" } }],
    ["configuration-owned-resource", "cloud_bucket", {
      role_type_overrides: { owned_resource: "cc:configuration" } }]
  ].map(([controlId, domain, options]) => observedControl(profile, {
    controlId, category: "positive", domain, options
  }));
}
function mutantControls(profile) {
  return [
    ["cross-owner-accepted", "cross_owner_accepted"],
    ["owner-alias-bypass", "alias_bypass"],
    ["wrong-resource-target", "wrong_resource"],
    ["refusal-after-protected-effect", "refusal_after_effect"],
    ["legitimate-authority-consumed", "legitimate_authority_consumed"],
    ["later-valid-attempt-fails", "later_valid_fails"]
  ].map(([controlId, strategy], index) => observedControl(profile, {
    controlId, category: "mutant",
    domain: ["tenant_document", "cloud_bucket", "payment_account"][index % 3],
    strategy
  }));
}
const rejectionMutations = Object.freeze([
  ["status-only-plan", (fixture) => {
    for (const claim of [...fixture.contract.claims]) {
      const id = claim.claim_id.slice("claim-".length);
      if (id !== "refusal-rejects-foreign-attempt") removeExactOwnershipClaim(fixture, id);
    }
  }],
  ["missing-ownership-binding", (fixture) =>
    removeExactOwnershipClaim(fixture, "resource-owned-by-legitimate-owner")],
  ["missing-foreign-authorization-refusal", (fixture) =>
    removeExactOwnershipClaim(fixture, "authority-does-not-authorize-foreign-subject")],
  ["missing-exact-resource-target", (fixture) =>
    removeExactOwnershipClaim(fixture, "foreign-attempt-targets-owned-resource")],
  ["missing-refusal", (fixture) =>
    removeExactOwnershipClaim(fixture, "refusal-rejects-foreign-attempt")],
  ["missing-write-isolation", (fixture) => {
    removeExactOwnershipClaim(fixture, "no-foreign-write-before-refusal");
    removeExactOwnershipClaim(fixture, "write-isolation-verification");
  }],
  ["missing-mutation-isolation", (fixture) => {
    removeExactOwnershipClaim(fixture, "no-foreign-mutation-before-refusal");
    removeExactOwnershipClaim(fixture, "mutation-isolation-verification");
  }],
  ["missing-authority-nonconsumption", (fixture) => {
    removeExactOwnershipClaim(fixture, "legitimate-authority-unconsumed");
    removeExactOwnershipClaim(fixture, "nonconsumption-verification");
  }],
  ["missing-later-success", (fixture) => {
    removeExactOwnershipClaim(fixture, "later-valid-attempt-succeeds");
    removeExactOwnershipClaim(fixture, "later-success-verification");
  }],
  ["wrong-resource-observable", (fixture) => {
    const decoy = addDecoy(fixture, "other-resource", "cc:resource");
    findExactOwnershipProposition(
      fixture, "foreign-attempt-targets-owned-resource"
    ).operands = [{ kind: "reference", reference_id: decoy }];
  }],
  ["shared-verification-reference", (fixture) => collapseExactOwnershipRole(
    fixture, "later_success_verification", "write_verification")],
  ["wrong-write-falsifier-condition", (fixture) => {
    findExactOwnershipProposition(
      fixture, "write-isolation-verification", true
    ).applicability_context = { mode: "when", operand_reference_ids: [
      exactOwnershipRoleReferenceId("later_failure_condition")
    ] };
  }],
  ["competing-proof-sequence", (fixture) => {
    const sequence = structuredClone(fixture.contract.collections.find(
      ({ collection_id: id }) => id === "set-proof-sequence"));
    sequence.collection_id = "set-competing-proof-sequence";
    sequence.member_claim_ids.reverse();
    fixture.contract.collections.push(sequence);
  }],
  ["profile-term-owner-grounding", (fixture) => {
    fixture.contract.references.find(({ reference_id: id }) =>
      id === exactOwnershipRoleReferenceId("legitimate_owner")
    ).identity = { kind: "profile_term", term: "ungrounded:owner" };
  }],
  ["profile-term-resource-grounding", (fixture) => {
    fixture.contract.references.find(({ reference_id: id }) =>
      id === exactOwnershipRoleReferenceId("owned_resource")
    ).identity = { kind: "profile_term", term: "ungrounded:resource" };
  }]
]);
function profileRejectionControls(profile) {
  return rejectionMutations.map(([controlId, mutate]) => {
    const fixture = buildExactOwnershipIsolationFixture();
    mutate(fixture);
    return { control_id: controlId, category: "profile_rejection",
      implementation_outcome: "not_applicable",
      profile_satisfaction: evaluateFixture(profile, fixture) };
  });
}
function exclusionControls(profile) {
  const baseline = evaluateFixture(profile, buildExactOwnershipIsolationFixture());
  return ["concurrent-owner-access", "ownership-discovery-completeness",
    "truthful-identity-and-observation-grounding", "resources-outside-owned-resource",
    "external-authorization-policy", "delivered-evidence-authenticity",
    "pack-applicability"].map((controlId) => ({ control_id: controlId,
    category: "exclusion", implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: baseline }));
}
async function runProofPackAdequacyControls({ profile }) {
  return { schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id, profile_version: profile.profile_version,
    profile_digest: PROFILE_DIGEST, guarantee_digest: GUARANTEE_DIGEST,
    controls: [...positiveControls(profile), ...mutantControls(profile),
      ...profileRejectionControls(profile), ...exclusionControls(profile)] };
}
export { GUARANTEE_DIGEST, PROFILE_DIGEST, evaluateFixture, fixtureForExecution,
  rejectionMutations, runProofPackAdequacyControls };
