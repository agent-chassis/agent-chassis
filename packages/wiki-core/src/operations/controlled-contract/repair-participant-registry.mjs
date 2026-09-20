

import {
  CONTROLLED_CONTRACT_CARRIER_KINDS
} from "../../lib/controlled-contract-tools.mjs";
import {
  CONTROLLED_CONTRACT_COVERAGE_FAMILIES
} from "./acceptance-coverage-operations.mjs";
import {
  CONTROLLED_CONTRACT_PROSPECTIVE_COMPILATION_ROLES
} from "./refactor-proof-plan-compilation.mjs";

export const CONTROLLED_CONTRACT_REPAIR_REGISTRY_SCHEMA_VERSION =
  "controlled-contract-repair-participant-registry.v1";

export const CONTROLLED_CONTRACT_REPAIR_STRUCTURAL_ROLES = Object.freeze([

  Object.freeze({ family: "contract", name: "reference_nodes",
    source: "controlled-acceptance-contract-reference-roles" }),
  Object.freeze({ family: "verification", name: "runtime_inventory",
    source: "controlled-contract-verification-bundle" }),
  Object.freeze({ family: "manifest", name: "carrier_set",
    source: "controlled-contract-carrier-set-manifest" }),
  Object.freeze({ family: "derived", name: "assessment_inputs",
    source: "controlled-contract-derived-assessment" }),
  Object.freeze({ family: "derived", name: "workbench_manifest",
    source: "controlled-contract-design-workbench" })
]);

function roleId(family, name) {
  return `${family}:${name}`;
}

export function enumerateControlledContractRepairRoles() {
  const rows = [
    ...CONTROLLED_CONTRACT_CARRIER_KINDS.map((name) => ({ family: "carrier", name,
      source: "CONTROLLED_CONTRACT_CARRIER_KINDS" })),
    ...CONTROLLED_CONTRACT_COVERAGE_FAMILIES.map((name) => ({ family: "coverage", name,
      source: "CONTROLLED_CONTRACT_COVERAGE_FAMILIES" })),
    ...CONTROLLED_CONTRACT_PROSPECTIVE_COMPILATION_ROLES.map((name) =>
      ({ family: "embedded", name,
        source: "CONTROLLED_CONTRACT_PROSPECTIVE_COMPILATION_ROLES" })),
    ...CONTROLLED_CONTRACT_REPAIR_STRUCTURAL_ROLES.map(({ family, name, source }) =>
      ({ family, name, source }))
  ].map((row) => Object.freeze({ ...row, role_id: roleId(row.family, row.name) }));
  return Object.freeze(rows.slice().sort((left, right) =>
    left.role_id.localeCompare(right.role_id)));
}

export const CONTROLLED_CONTRACT_REPAIR_INCUMBENT_OWNERS = Object.freeze([
  "acceptance_coverage",
  "authoring_continuation",
  "buildProspectiveProofPlan",
  "canonical_generation",
  "contract_reference",
  "obligation_coverage",
  "proof_plan",
  "verification_bundle"
]);

export const CONTROLLED_CONTRACT_REPAIR_ROLE_BINDINGS = Object.freeze({

  "contract:reference_nodes": Object.freeze({ mutable: true,
    semantic_owner: "contract_reference",
    prepare_owner: "prepareControlledContractReferenceAuthoring",
    validate_owner: "validateControlledContractReferenceAuthoringPreparation",
    depends_on: Object.freeze(["carrier:contract", "carrier:evaluation_input"]),
    settlement_participant: "canonical_generation",
    commit_owner: "prepareControlledContractRefactorCarrierSettlement",
    compensation_owner: "prepareControlledContractRefactorCarrierSettlement",
    refusal_class: "unresolved_semantic_choice" }),
  "carrier:contract": Object.freeze({ mutable: true,
    semantic_owner: "buildProspectiveProofPlan",
    prepare_owner: "prepareControlledContractEmbeddedProofEvolution",
    validate_owner: "validateControlledContractEmbeddedProofEvolution",
    depends_on: Object.freeze(["carrier:proof_plan_request"]),
    settlement_participant: "canonical_generation",
    commit_owner: "prepareControlledContractRefactorCarrierSettlement",
    compensation_owner: "prepareControlledContractRefactorCarrierSettlement",
    refusal_class: "inconsistent_owner_facts" }),
  "carrier:evaluation_input": Object.freeze({ mutable: true,
    semantic_owner: "authoring_continuation",
    prepare_owner: "resolveControlledContractAuthoringContinuationMutation",
    validate_owner: "validateAuthorableCarrier",
    depends_on: Object.freeze([]),
    settlement_participant: "canonical_generation",
    commit_owner: "prepareControlledContractRefactorCarrierSettlement",
    compensation_owner: "prepareControlledContractRefactorCarrierSettlement",
    refusal_class: "unresolved_semantic_choice" }),
  "carrier:proof_plan_request": Object.freeze({ mutable: true,
    semantic_owner: "authoring_continuation",
    prepare_owner: "resolveControlledContractAuthoringContinuationMutation",
    validate_owner: "validateAuthorableCarrier",
    depends_on: Object.freeze(["carrier:evaluation_input"]),
    settlement_participant: "canonical_generation",
    commit_owner: "prepareControlledContractRefactorCarrierSettlement",
    compensation_owner: "prepareControlledContractRefactorCarrierSettlement",
    refusal_class: "unresolved_semantic_choice" }),
  "carrier:proof_plan": Object.freeze({ mutable: true,
    semantic_owner: "proof_plan",
    prepare_owner: "prepareControlledContractProofPlanBuild",
    validate_owner: "validateControlledContractProofPlanPreparation",
    depends_on: Object.freeze(["carrier:contract", "carrier:proof_plan_request",
      "carrier:evaluation_input"]),
    settlement_participant: "canonical_generation",
    commit_owner: "prepareControlledContractRefactorCarrierSettlement",
    compensation_owner: "prepareControlledContractRefactorCarrierSettlement",
    refusal_class: "missing_proof_or_evidence" }),
  "coverage:obligation": Object.freeze({ mutable: true,
    semantic_owner: "obligation_coverage",
    prepare_owner: "prepareControlledContractObligationCoverage",
    validate_owner: "validateControlledContractObligationCoveragePreparation",
    depends_on: Object.freeze(["carrier:contract"]),
    settlement_participant: "coverage",
    commit_owner: "prepareControlledContractRefactorCoverageSettlement",
    compensation_owner: "prepareControlledContractRefactorCoverageSettlement",
    refusal_class: "stale_source" }),
  "coverage:acceptance": Object.freeze({ mutable: true,
    semantic_owner: "acceptance_coverage",
    prepare_owner: "prepareControlledContractAcceptanceCoverage",
    validate_owner: "validateControlledContractAcceptanceCoveragePreparation",
    depends_on: Object.freeze(["coverage:obligation"]),
    settlement_participant: "coverage",
    commit_owner: "prepareControlledContractRefactorCoverageSettlement",
    compensation_owner: "prepareControlledContractRefactorCoverageSettlement",
    refusal_class: "stale_source" }),
  "embedded:test_proofs": Object.freeze({ mutable: true,
    semantic_owner: "buildProspectiveProofPlan",
    prepare_owner: "prepareControlledContractEmbeddedProofEvolution",
    validate_owner: "validateControlledContractEmbeddedProofEvolution",
    depends_on: Object.freeze(["carrier:contract"]),
    settlement_participant: "canonical_generation",
    commit_owner: "prepareControlledContractRefactorCarrierSettlement",
    compensation_owner: "prepareControlledContractRefactorCarrierSettlement",
    refusal_class: "unsupported_proof_method" }),
  "embedded:proof_pack_bindings": Object.freeze({ mutable: true,
    semantic_owner: "buildProspectiveProofPlan",
    prepare_owner: "prepareControlledContractEmbeddedProofEvolution",
    validate_owner: "validateControlledContractEmbeddedProofEvolution",
    depends_on: Object.freeze(["carrier:contract", "carrier:proof_plan"]),
    settlement_participant: "canonical_generation",
    commit_owner: "prepareControlledContractRefactorCarrierSettlement",
    compensation_owner: "prepareControlledContractRefactorCarrierSettlement",
    refusal_class: "inconsistent_owner_facts" }),
  "verification:runtime_inventory": Object.freeze({ mutable: true,
    semantic_owner: "verification_bundle",
    prepare_owner: "prepareControlledContractVerificationBundlePatch",
    validate_owner: "validateControlledContractVerificationBundlePreparation",
    depends_on: Object.freeze(["carrier:contract"]),
    settlement_participant: "canonical_generation",
    commit_owner: "prepareControlledContractRefactorCarrierSettlement",
    compensation_owner: "prepareControlledContractRefactorCarrierSettlement",
    refusal_class: "missing_proof_or_evidence" }),
  "manifest:carrier_set": Object.freeze({ mutable: true,
    semantic_owner: "canonical_generation",
    prepare_owner: "compileControlledContractAuthoringProspectiveMembers",
    validate_owner: "validateControlledContractAuthoringProspectiveMembers",
    depends_on: Object.freeze(["carrier:contract", "carrier:proof_plan",
      "carrier:evaluation_input", "carrier:proof_plan_request"]),
    settlement_participant: "canonical_generation",
    commit_owner: "prepareControlledContractRefactorCarrierSettlement",
    compensation_owner: "prepareControlledContractRefactorCarrierSettlement",
    refusal_class: "tooling_or_internal_invariant" }),

  "derived:assessment_inputs": Object.freeze({ mutable: false,
    non_repairable_reason: "recomputed_from_settled_generation" }),
  "derived:workbench_manifest": Object.freeze({ mutable: false,
    non_repairable_reason: "derived_projection_without_canonical_bytes" })
});

export const CONTROLLED_CONTRACT_REPAIR_SEMANTIC_OWNERS = Object.freeze({
  authoring_continuation: Object.freeze([
    "carrier:evaluation_input", "carrier:proof_plan_request"]),
  proof_graph: Object.freeze(["carrier:contract", "embedded:proof_pack_bindings"]),
  proof_plan: Object.freeze(["carrier:proof_plan"]),

  buildProspectiveProofPlan: Object.freeze(["carrier:contract", "carrier:proof_plan",
    "embedded:test_proofs", "embedded:proof_pack_bindings"]),
  proof_authoring: Object.freeze(["carrier:evaluation_input"]),
  contract_carrier: Object.freeze(["carrier:contract"]),

  contract_reference: Object.freeze(["contract:reference_nodes",
    "carrier:contract", "carrier:evaluation_input", "carrier:proof_plan_request",
    "carrier:proof_plan"]),
  test_proof: Object.freeze(["embedded:test_proofs"]),
  verification_bundle: Object.freeze(["verification:runtime_inventory"]),
  obligation_coverage: Object.freeze(["coverage:obligation"]),
  acceptance_coverage: Object.freeze(["coverage:acceptance"]),

  proof_posture: Object.freeze([])
});

const SETTLEMENT_OWNED_ROLES = Object.freeze(["manifest:carrier_set"]);

export class ControlledContractRepairCensusError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ControlledContractRepairCensusError";
    this.code = code;
    this.details = details;
  }
}

export function censusControlledContractRepairParticipants({
  roles = enumerateControlledContractRepairRoles(),
  bindings = CONTROLLED_CONTRACT_REPAIR_ROLE_BINDINGS
} = {}) {
  const roleIds = roles.map(({ role_id: id }) => id);
  const duplicated = roleIds.filter((id, index) => roleIds.indexOf(id) !== index);
  if (duplicated.length > 0) {
    throw new ControlledContractRepairCensusError(
      "controlled_contract_repair_role_duplicated",
      "one repair role is produced by more than one schema source",
      { role_ids: [...new Set(duplicated)].sort() });
  }
  const bound = Object.keys(bindings);
  const unclassified = roleIds.filter((id) => !bound.includes(id));
  if (unclassified.length > 0) {
    throw new ControlledContractRepairCensusError(
      "controlled_contract_repair_role_unclassified",
      "a mutable repair-relevant role has no incumbent participant and no explicit non-repairable classification",
      { role_ids: unclassified.sort() });
  }
  const unknown = bound.filter((id) => !roleIds.includes(id));
  if (unknown.length > 0) {
    throw new ControlledContractRepairCensusError(
      "controlled_contract_repair_role_unknown",
      "the registry binds a role no current schema source produces",
      { role_ids: unknown.sort() });
  }
  const rows = roles.map((role) => {
    const binding = bindings[role.role_id];
    if (binding.mutable === true) {

      for (const field of ["semantic_owner", "prepare_owner", "validate_owner",
        "settlement_participant", "commit_owner", "compensation_owner",
        "refusal_class"]) {
        if (typeof binding[field] !== "string" || binding[field].length === 0) {
          throw new ControlledContractRepairCensusError(
            "controlled_contract_repair_role_incomplete",
            "a mutable repair role is missing part of its executable participant contract",
            { role_id: role.role_id, field });
        }
      }
      if (!CONTROLLED_CONTRACT_REPAIR_INCUMBENT_OWNERS.includes(
        binding.semantic_owner)) {
        throw new ControlledContractRepairCensusError(
          "controlled_contract_repair_role_incomplete",
          "a mutable repair role names no declared incumbent owner",
          { role_id: role.role_id, semantic_owner: binding.semantic_owner });
      }
      if (!["canonical_generation", "coverage"].includes(
        binding.settlement_participant)) {
        throw new ControlledContractRepairCensusError(
          "controlled_contract_repair_role_incomplete",
          "a mutable repair role names no existing settlement participant",
          { role_id: role.role_id,
            settlement_participant: binding.settlement_participant });
      }
      if (!Array.isArray(binding.depends_on)) {
        throw new ControlledContractRepairCensusError(
          "controlled_contract_repair_role_incomplete",
          "a mutable repair role declares no dependency population",
          { role_id: role.role_id, field: "depends_on" });
      }
      return Object.freeze({ ...role, mutable: true,
        semantic_owner: binding.semantic_owner,
        prepare_owner: binding.prepare_owner,
        validate_owner: binding.validate_owner,
        depends_on: Object.freeze([...binding.depends_on]),
        settlement_participant: binding.settlement_participant,
        commit_owner: binding.commit_owner,
        compensation_owner: binding.compensation_owner,
        refusal_class: binding.refusal_class,
        non_repairable_reason: null });
    }
    if (typeof binding.non_repairable_reason !== "string" ||
        binding.non_repairable_reason.length === 0) {
      throw new ControlledContractRepairCensusError(
        "controlled_contract_repair_role_incomplete",
        "a non-repairable repair role is missing its explicit classification reason",
        { role_id: role.role_id });
    }
    return Object.freeze({ ...role, mutable: false, semantic_owner: null,
      prepare_owner: null, validate_owner: null, depends_on: Object.freeze([]),
      settlement_participant: null, commit_owner: null,
      compensation_owner: null, refusal_class: null,
      non_repairable_reason: binding.non_repairable_reason });
  });
  const mutable = rows.filter(({ mutable: isMutable }) => isMutable);
  const claimed = new Set(Object.values(CONTROLLED_CONTRACT_REPAIR_SEMANTIC_OWNERS).flat());
  const unclaimedRole = mutable.map(({ role_id: id }) => id).filter((id) =>
    !claimed.has(id) && !SETTLEMENT_OWNED_ROLES.includes(id));
  if (unclaimedRole.length > 0) {
    throw new ControlledContractRepairCensusError(
      "controlled_contract_repair_role_unclaimed",
      "a mutable repair role has no semantic owner permitted to mutate it",
      { role_ids: unclaimedRole.sort() });
  }
  const unknownClaim = [...claimed].filter((id) =>
    !roleIds.includes(id));
  if (unknownClaim.length > 0) {
    throw new ControlledContractRepairCensusError(
      "controlled_contract_repair_role_unknown",
      "a semantic owner claims a role no current schema source produces",
      { role_ids: unknownClaim.sort() });
  }
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_REPAIR_REGISTRY_SCHEMA_VERSION,
    role_count: rows.length,
    mutable_role_count: mutable.length,
    non_repairable_role_count: rows.length - mutable.length,
    settlement_participants: Object.freeze([...new Set(mutable.map(
      ({ settlement_participant: participant }) => participant))].sort()),
    prepare_owners: Object.freeze([...new Set(mutable.map(
      ({ prepare_owner: owner }) => owner))].sort()),
    semantic_owners: Object.freeze(
      Object.keys(CONTROLLED_CONTRACT_REPAIR_SEMANTIC_OWNERS).sort()),
    roles: Object.freeze(rows)
  });
}

export function projectControlledContractRepairParticipantCensus(census) {
  return Object.freeze({
    schema_version: census.schema_version,
    role_count: census.role_count,
    mutable_role_count: census.mutable_role_count,
    non_repairable_role_count: census.non_repairable_role_count,
    settlement_participants: census.settlement_participants,
    role_ids: Object.freeze(census.roles.map(({ role_id: id }) => id))
  });
}
