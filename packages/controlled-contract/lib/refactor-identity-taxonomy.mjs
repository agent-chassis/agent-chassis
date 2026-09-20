import { compareCodeUnits, deepFreeze } from
  "./deterministic-projection-primitives.mjs";
import { projectStableTestProofSelector } from "./test-proof-contract-v1.mjs";

const REFACTOR_IDENTITY_ROLES = Object.freeze({
  INTERNAL_GRAPH_DECLARATION: "internal_graph_declaration",
  INTERNAL_GRAPH_REFERENCE: "internal_graph_reference",
  CARRIER_LOCAL_DECLARATION: "carrier_local_declaration",
  CARRIER_LOCAL_REFERENCE: "carrier_local_reference",
  EXTERNAL_RUNTIME_SELECTOR: "external_runtime_selector",
  EXTERNAL_CATALOG_IDENTITY: "external_catalog_identity",
  EXTERNAL_REPOSITORY_SELECTOR: "external_repository_selector",
  EXTERNAL_MECHANISM_SELECTOR: "external_mechanism_selector",
  EXTERNAL_EVIDENCE_SELECTOR: "external_evidence_selector"
});

const INTERNAL_GRAPH_DECLARATIONS = Object.freeze({
  annotation_id: ["annotations", "annotation"],
  claim_id: ["claims", "claim"],
  collection_id: ["collections", "collection"],
  node_id: ["nodes", "graph_node"],
  proposition_id: ["propositions", "proposition"],
  reference_id: ["references", "reference"],
  relation_id: ["relations", "relation"],
  requirement_id: ["requirements", "requirement"],
  residue_id: ["residue", "residue"]
});

const INTERNAL_GRAPH_SCALARS = Object.freeze({
  failure_proposition_id: "proposition",
  falsifying_proposition_id: "proposition",
  from_reference_id: "reference",
  member_reference_id: "reference",
  controlled_contract_node_id: "graph_node",
  node_id: "graph_node",
  proposition_id: "proposition",
  raw_reference_id: "reference",
  source_claim_id: "claim",
  source_id: "graph_node",
  source_reference_id: "reference",
  source_verification_claim_id: "claim",
  subject_reference_id: "reference",
  target_claim_id: "claim",
  target_id: "graph_node",
  target_reference_id: "reference",
  target_verification_id: "claim",
  to_reference_id: "reference",
  verification_claim_id: "claim",
  verification_id: "claim"
});

const INTERNAL_GRAPH_ARRAYS = Object.freeze({
  argument_reference_ids: "reference",
  behavior_claim_ids: "claim",
  claim_ids: "claim",
  collection_ids: "collection",
  controlled_contract_node_ids: "graph_node",
  declared_member_reference_ids: "reference",
  grounded_mandatory_behavior_claim_ids: "claim",
  member_claim_ids: "claim",
  member_reference_ids: "reference",
  membership_claim_ids: "claim",
  node_ids: "graph_node",
  operand_reference_ids: "reference",
  population_reference_ids: "reference",
  proposition_ids: "proposition",
  raw_operand_reference_ids: "reference",
  reference_ids: "reference",
  relation_ids: "relation",
  repository_reference_ids: "reference",
  requirement_ids: "requirement",
  shared_falsifying_proposition_ids: "proposition",
  shared_verification_claim_ids: "claim",
  structural_verification_edge_ids: "relation",
  subject_reference_ids: "reference",
  ungrounded_mandatory_behavior_claim_ids: "claim",
  variable_reference_ids: "reference",
  verification_claim_ids: "claim",
  verification_ids: "claim"
});

const CARRIER_LOCAL_SCALARS = Object.freeze({
  acceptance_id: "acceptance_coverage.row",
  assessment_id: "assessment.row",
  binding_id: "carrier.binding",
  boundary_id: "stable_test_proof.boundary",
  contract_generation_id: "carrier_set.generation",
  criterion_id: "acceptance_coverage.criterion",
  criterion_identity: "acceptance_coverage.criterion",
  falsifier_id: "stable_test_proof.falsifier",
  generation_id: "carrier_set.generation",
  mutation_id: "stable_test_proof.mutation",
  obligation_id: "obligation_coverage.row",
  observable_id: "stable_test_proof.observable",
  proof_id: "stable_test_proof.bundle",
  proof_plan_generation_id: "proof_plan.generation",
  proof_plan_id: "proof_plan.document",
  source_assessment_id: "assessment.document",
  source_generation_id: "carrier_set.generation",
  source_proof_plan_id: "proof_plan.document",
  stable_test_proof_id: "stable_test_proof.bundle",
  test_proof_id: "stable_test_proof.bundle"
});
const CARRIER_LOCAL_ARRAYS = Object.freeze({
  acceptance_ids: "acceptance_coverage.row",
  criterion_identities: "acceptance_coverage.criterion",
  obligation_ids: "obligation_coverage.row",
  proof_ids: "stable_test_proof.bundle"
});
const CARRIER_LOCAL_DECLARATION_FIELDS = new Set([
  "acceptance_id", "assessment_id", "binding_id", "boundary_id",
  "criterion_identity", "falsifier_id", "mutation_id", "obligation_id",
  "observable_id", "proof_id", "proof_plan_id", "stable_test_proof_id",
  "test_proof_id"
]);

const EXTERNAL_RUNTIME_SCALARS = Object.freeze({
  observed_test_id: "runtime_inventory.test",
  selected_test_id: "runtime_inventory.test",
  test_id: "runtime_inventory.test"
});
const EXTERNAL_RUNTIME_ARRAYS = Object.freeze({
  candidate_test_reference_ids: "runtime_inventory.test",
  declared_test_ids: "runtime_inventory.test",
  discovered_test_ids: "runtime_inventory.test",
  executed_test_ids: "runtime_inventory.test",
  skipped_test_ids: "runtime_inventory.test"
});

const EXTERNAL_CATALOG_FIELDS = Object.freeze({
  component_id: "proof_pack_catalog.component",
  corpus_id: "proof_pack_catalog.corpus",
  intent_id: "proof_intent_catalog.intent",
  pack_id: "proof_pack_catalog.pack",
  profile_id: "proof_pack_catalog.profile",
  registry_id: "proof_pack_catalog.registry",
  requested_intent: "proof_intent_catalog.intent"
});
const EXTERNAL_CATALOG_ARRAY_FIELDS = Object.freeze({
  requested_intents: "proof_intent_catalog.intent"
});
const EXTERNAL_REPOSITORY_FIELDS = Object.freeze({
  code_symbol_id: "repository.code_symbol",
  repository_id: "repository",
  repository_path_id: "repository.path"
});
const EXTERNAL_REPOSITORY_ARRAY_FIELDS = Object.freeze({
  repository_selector_ids: "repository.selector"
});
const EXTERNAL_MECHANISM_FIELDS = Object.freeze({
  command_id: "runtime_mechanism.command",
  execution_provider_id: "runtime_mechanism.execution_provider",
  mechanism_id: "runtime_mechanism",
  provider_id: "runtime_mechanism.provider"
});
const EXTERNAL_EVIDENCE_FIELDS = Object.freeze({
  artifact_id: "evidence.artifact",
  durable_id: "evidence.durable_record",
  evidence_id: "evidence.record",
  run_id: "evidence.run"
});
const EXTERNAL_EVIDENCE_ARRAY_FIELDS = Object.freeze({
  artifact_ids: "evidence.artifact",
  evidence_artifact_ids: "evidence.artifact"
});

function classification(role, targetDomain, relationship = "reference",
  prospectiveSettlementOwner = null) {
  return deepFreeze({ role, target_domain: targetDomain, relationship,
    ...(prospectiveSettlementOwner === null ? {} : {
      prospective_settlement_owner: prospectiveSettlementOwner
    }) });
}

function declaredGraphDomain(field, pointer) {
  const declaration = INTERNAL_GRAPH_DECLARATIONS[field];
  if (declaration === undefined || !pointer.includes(`/${declaration[0]}/`)) return null;
  return declaration[1];
}

function classifyControlledContractRefactorIdentityRole({ carrierKind = null,
  field, pointer, arrayMember = false } = {}) {
  if (typeof field !== "string" || typeof pointer !== "string") return null;
  const declaredDomain = !arrayMember ? declaredGraphDomain(field, pointer) : null;
  if (declaredDomain !== null) return classification(
    REFACTOR_IDENTITY_ROLES.INTERNAL_GRAPH_DECLARATION,
    `controlled_contract.${declaredDomain}`, "declaration");
  if (!arrayMember && carrierKind === "assessment" && field === "assessment_id") {
    return classification(REFACTOR_IDENTITY_ROLES.CARRIER_LOCAL_DECLARATION,
      "assessment.document", "declaration");
  }
  if (!arrayMember && carrierKind === "proof_plan" && field === "proof_plan_id") {
    return classification(REFACTOR_IDENTITY_ROLES.CARRIER_LOCAL_DECLARATION,
      "proof_plan.document", "declaration");
  }
  const runtimeDomain = (arrayMember ? EXTERNAL_RUNTIME_ARRAYS :
    EXTERNAL_RUNTIME_SCALARS)[field];
  if (runtimeDomain !== undefined) return classification(
    REFACTOR_IDENTITY_ROLES.EXTERNAL_RUNTIME_SELECTOR, runtimeDomain, "reference");
  const localDomain = (arrayMember ? CARRIER_LOCAL_ARRAYS : CARRIER_LOCAL_SCALARS)[field];
  if (localDomain !== undefined) {
    const declaration = !arrayMember && CARRIER_LOCAL_DECLARATION_FIELDS.has(field) &&
      (pointer.includes("/test_proofs/") || pointer.includes("/obligations/") ||
       pointer.includes("/rows/") || pointer.includes("/assessments/") ||
       pointer.endsWith(`/${field}`));
    return classification(
      declaration
      ? REFACTOR_IDENTITY_ROLES.CARRIER_LOCAL_DECLARATION
      : REFACTOR_IDENTITY_ROLES.CARRIER_LOCAL_REFERENCE,
      localDomain, declaration ? "declaration" : "reference");
  }
  const graphDomain = (arrayMember ? INTERNAL_GRAPH_ARRAYS : INTERNAL_GRAPH_SCALARS)[field];
  if (graphDomain !== undefined) return classification(
    REFACTOR_IDENTITY_ROLES.INTERNAL_GRAPH_REFERENCE,
    `controlled_contract.${graphDomain}`, "reference",
    pointer.includes("/test_proofs/") &&
      ["verification_claim_id", "verification_id"].includes(field)
      ? "prospective_proof_plan_compiler" : null);
  const catalogDomain = (arrayMember ? EXTERNAL_CATALOG_ARRAY_FIELDS :
    EXTERNAL_CATALOG_FIELDS)[field];
  if (catalogDomain !== undefined) return classification(
    REFACTOR_IDENTITY_ROLES.EXTERNAL_CATALOG_IDENTITY, catalogDomain);
  const repositoryDomain = (arrayMember ? EXTERNAL_REPOSITORY_ARRAY_FIELDS :
    EXTERNAL_REPOSITORY_FIELDS)[field];
  if (repositoryDomain !== undefined) return classification(
    REFACTOR_IDENTITY_ROLES.EXTERNAL_REPOSITORY_SELECTOR, repositoryDomain);
  if (!arrayMember && EXTERNAL_MECHANISM_FIELDS[field] !== undefined) {
    return classification(REFACTOR_IDENTITY_ROLES.EXTERNAL_MECHANISM_SELECTOR,
      EXTERNAL_MECHANISM_FIELDS[field]);
  }
  const evidenceDomain = (arrayMember ? EXTERNAL_EVIDENCE_ARRAY_FIELDS :
    EXTERNAL_EVIDENCE_FIELDS)[field];
  if (evidenceDomain !== undefined) return classification(
    REFACTOR_IDENTITY_ROLES.EXTERNAL_EVIDENCE_SELECTOR, evidenceDomain);
  return null;
}

function visitControlledContractRefactorIdentities(value, visitor, {
  carrierKind = null, pointer = "", parentKey = ""
} = {}) {
  if (Array.isArray(value)) {
    value.forEach((member, index) => {
      const child = `${pointer}/${index}`;
      if (typeof member === "string") {
        const identityRole = classifyControlledContractRefactorIdentityRole({
          carrierKind, field: parentKey, pointer: child, arrayMember: true
        });
        if (identityRole !== null) visitor(member, child, parentKey, identityRole);
      }
      visitControlledContractRefactorIdentities(member, visitor, {
        carrierKind, pointer: child, parentKey
      });
    });
    return;
  }
  if (value === null || typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    const member = value[key];
    const child = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (typeof member === "string") {
      const identityRole = classifyControlledContractRefactorIdentityRole({
        carrierKind, field: key, pointer: child, arrayMember: false
      });
      if (identityRole !== null) visitor(member, child, key, identityRole);
    }
    visitControlledContractRefactorIdentities(member, visitor, {
      carrierKind, pointer: child, parentKey: key
    });
  }
}

function inspectStableTestProofExternalGrounding(contract) {
  const groundings = [];
  const refusals = [];
  for (const [index, binding] of (contract?.test_proofs ?? []).entries()) {
    const pointer = `/test_proofs/${index}/test_selector`;
    const row = {
      test_proof_id: binding?.test_proof_id ?? null,
      pointer,
      target_domain: "declared_test_selector",
      owner: "projectStableTestProofSelector"
    };
    try {
      const selector = projectStableTestProofSelector(binding);
      groundings.push({ ...row, selector: { name: selector.name, nesting: selector.nesting },
        status: "declared", reason: "declarative_selector" });
    } catch (error) {
      refusals.push({ ...row, selector: null, status: "invalid",
        reason: error?.code ?? "stable_test_proof_selector_invalid" });
    }
  }
  const order = (rows) => rows.sort((left, right) => compareCodeUnits(
    `${left.test_proof_id ?? ""}\0${left.pointer}`,
    `${right.test_proof_id ?? ""}\0${right.pointer}`
  ));
  return deepFreeze({ groundings: order(groundings), refusals: order(refusals) });
}

export {
  REFACTOR_IDENTITY_ROLES,
  classifyControlledContractRefactorIdentityRole,
  inspectStableTestProofExternalGrounding,
  visitControlledContractRefactorIdentities
};
