import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { compiledValidators } from "./compiled-validator-cache.mjs";
import { checkContract } from "../bin/check-contract.mjs";
import { loadAdmittedProofPack } from "./admitted-proof-packs.mjs";
import { captureExactBoundAssessmentInputsV1 } from "./exact-binding-assessment.mjs";
import { projectedEvaluationEnvelopeFor } from "./exact-binding-capture.mjs";
import {
  createGraphSelectionTrace,
  evaluateProjectedEvaluationBinding,
  hasTrustedProjectedSelection
} from "./projected-evaluation-binding.mjs";
import {
  assertCapturedExactBindingResult,
  exactBindingSupplementContext,
  semanticDeclarationDiagnostics
} from "./exact-binding.mjs";
import { resolveClosedPopulationV1 } from "./population-semantics-v1.mjs";
import { canonicalDigest as exactCanonicalDigest }
  from "./exact-binding-common.mjs";
import {
  VOCABULARY_DIGESTS,
  VOCABULARY_VERSION
} from "./vocabulary-v1.mjs";
import {
  StableVerificationError,
  evaluateVerificationProfileV1
} from "./verification-profile-v1.mjs";
import { profileDigest } from "./profile-digest.mjs";
import {
  registerAssessmentSupplementContext
} from "./lossless-supplement-context.mjs";
import {
  compactAssessmentOutput,
  evaluateAdmittedTestValidity,
  markdownAssessment
} from "./test-proof-assessment.mjs";

const ASSESSMENT_SCHEMA_VERSION =
  "controlled-contract-assessment.v1";
const ASSESSMENT_TOOL_VERSION =
  "controlled-contract-assess.v1";
const ASSESSMENT_FORMAT_VERSION =
  "controlled-contract-assessment-bundle.v1";
const ASSESSMENT_REPORT_VERSION =
  "controlled-contract-assessment-full-report.v1";
const ASSESSMENT_MANIFEST_VERSION =
  "controlled-contract-assessment-manifest.v1";
const ARTIFACT_RELATIVE_ROOT = path.join(
  ".cache", "controlled-contract", "assessments", "sha256"
);
const LOSSLESS_FILES = Object.freeze([
  "assessment.json",
  "assessment.md",
  "structural.full.json",
  "admitted-proof.full.json",
  "proof-pack-admission.full.json",
  "manifest.json"
]);
const EXACT_BOUND_LOSSLESS_FILES = Object.freeze([
  ...LOSSLESS_FILES.slice(0, -1),
  "exact-binding.full.json",
  "manifest.json"
]);
const assessmentImplementationSource = await readFile(
  new URL(import.meta.url), "utf8"
);
const ASSESSMENT_IMPLEMENTATION_DIGEST = sha256Bytes(
  assessmentImplementationSource
);
const ASSESSMENT_FORMAT = Object.freeze({
  format_version: ASSESSMENT_FORMAT_VERSION,
  assessment_json: ASSESSMENT_SCHEMA_VERSION,
  markdown: "controlled-contract-assessment-markdown.v1",
  compact_terminal: "controlled-contract-assessment-compact.v1",
  full_report: ASSESSMENT_REPORT_VERSION,
  manifest: ASSESSMENT_MANIFEST_VERSION,
  implementation_sha256: ASSESSMENT_IMPLEMENTATION_DIGEST,
  files: Object.freeze([...LOSSLESS_FILES])
});
const PUBLISHABLE_ASSESSMENTS = new WeakSet();
const PROFILE_SCOPE_STATEMENT =
  "Proven means only that the authored controlled graph satisfied this admitted, " +
  "adequacy-verified profile. It does not establish runtime truth.";
const EDGE_SCOPE_STATEMENT =
  "This is an authored structural verifies edge; it is not runtime evidence.";
const GROUNDING_SCOPE_STATEMENT =
  "Repository grounding means only that the authored proposition references a " +
  "repository_path or code_symbol identity. It does not establish that the " +
  "identity exists or is honest, or that the claim is true.";
const PLANNING_SCOPE_STATEMENT =
  "This planning assessment evaluates authored contract structure and proof-plan " +
  "discrimination. Delivered runtime behavior is outside its scope.";

const assessmentSchemaText = await readFile(new URL(
  "../schema/controlled-contract-assessment.v1.schema.json",
  import.meta.url
), "utf8");
const ASSESSMENT_SCHEMA = deepFreeze(JSON.parse(assessmentSchemaText));
const { validateAssessmentSchema } = await compiledValidators(
  "controlled-contract.contract-assessment.v1",
  { validators: { validateAssessmentSchema: ASSESSMENT_SCHEMA } }
);

class AssessmentArtifactError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AssessmentArtifactError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function compareCodeUnits(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map(
      (key) => [key, canonicalValue(value[key])]
    )
  );
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalDigest(value) {
  return sha256Bytes(canonicalJson(value));
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sortByKey(values, key) {
  return [...values].sort((left, right) => compareCodeUnits(left[key], right[key]));
}

function sortCanonical(values) {
  return [...values].sort((left, right) =>
    compareCodeUnits(canonicalJson(left), canonicalJson(right))
  );
}

function normalizeContractForIdentity(contract) {
  const normalized = clone(contract);
  if (Array.isArray(normalized.references)) {
    normalized.references = sortByKey(normalized.references, "reference_id");
  }
  if (Array.isArray(normalized.propositions)) {
    normalized.propositions = normalized.propositions.map((proposition) => {
      const result = clone(proposition);
      if (Array.isArray(result.applicability_context?.operand_reference_ids)) {
        result.applicability_context.operand_reference_ids = [
          ...result.applicability_context.operand_reference_ids
        ].sort(compareCodeUnits);
      }
      if (Array.isArray(result.operands) && result.operator !== "reference:ordered_as") {
        result.operands = sortCanonical(result.operands);
      }
      return result;
    }).sort((left, right) => compareCodeUnits(
      left.proposition_id, right.proposition_id
    ));
  }
  if (Array.isArray(normalized.claims)) {
    normalized.claims = sortByKey(normalized.claims, "claim_id");
  }
  if (Array.isArray(normalized.relations)) {
    normalized.relations = sortByKey(normalized.relations, "relation_id");
  }
  if (Array.isArray(normalized.collections)) {
    normalized.collections = normalized.collections.map((collection) => ({
      ...collection,
      member_claim_ids: collection.collection_kind === "closed_set" &&
          Array.isArray(collection.member_claim_ids)
        ? [...collection.member_claim_ids].sort(compareCodeUnits)
        : collection.member_claim_ids
    })).sort((left, right) => compareCodeUnits(
      left.collection_id, right.collection_id
    ));
  }
  if (Array.isArray(normalized.residue)) {
    normalized.residue = sortByKey(normalized.residue, "residue_id");
  }
  if (Array.isArray(normalized.annotations)) {
    normalized.annotations = sortCanonical(normalized.annotations);
  }
  return canonicalValue(normalized);
}

function normalizeEvaluationInputForIdentity(input) {
  const normalized = clone(input);
  if (Array.isArray(normalized.reference_bindings)) {
    normalized.reference_bindings = normalized.reference_bindings.map((binding) => ({
      ...binding,
      reference_ids: Array.isArray(binding.reference_ids)
        ? [...binding.reference_ids].sort(compareCodeUnits)
        : binding.reference_ids
    })).sort((left, right) => compareCodeUnits(left.role, right.role));
  }
  for (const [field, key] of [
    ["number_bindings", "role"],
    ["claim_pattern_bindings", "pattern_id"]
  ]) if (Array.isArray(normalized[field])) {
    normalized[field] = sortByKey(normalized[field], key);
  }
  for (const field of ["resolver_facts", "delivered_evidence"]) {
    if (Array.isArray(normalized[field])) normalized[field] = sortCanonical(normalized[field]);
  }
  return canonicalValue(normalized);
}

function qualifyPassed(result, gate) {
  const qualified = clone(result);
  if (Object.hasOwn(qualified, "passed")) {
    const satisfied = qualified.passed;
    delete qualified.passed;
    qualified.qualified_outcome = {
      gate,
      satisfied,
      authority: "non_authoritative"
    };
  }
  return qualified;
}

function normalizeStructuralResult(structuralResult, contractDigest) {
  const result = qualifyPassed(structuralResult, "structural_contract_evaluation");
  result.input = {
    content_reference: `controlled-contract-input://sha256/${contractDigest}`,
    canonical_sha256: contractDigest
  };
  if (result.schema) {
    result.schema.path = `package:schema/${path.basename(result.schema.path)}`;
  }
  return canonicalValue(result);
}

function structureAxis(structural) {
  if (structural.outcome === "schema_invalid" ||
      structural.validation?.schema_valid === false) return "invalid";
  if ((structural.validation?.diagnostics?.length ?? 0) > 0 ||
      (structural.decomposition?.diagnostics?.length ?? 0) > 0) {
    return "not_proven";
  }
  return "proven";
}

function residueAxis(residue) {
  if (residue.length === 0) return "none";
  const reviewOnlyCount = residue.filter(
    ({ reason }) => reason === "review_only"
  ).length;
  if (reviewOnlyCount === residue.length) return "review_required";
  if (reviewOnlyCount === 0) return "resolution_required";
  return "review_and_resolution_required";
}

function bindingDiagnostics(pack, evaluation) {
  const diagnostics = [];
  const expect = (field, expected, actual) => {
    if (expected !== actual) diagnostics.push({
      code: "assessment_digest_binding_mismatch",
      field,
      expected,
      actual: actual ?? null
    });
  };
  expect("pack.profile_digest", pack.profile.schema_version ===
    "controlled-contract-test-validity-profile.v1"
    ? canonicalDigest(pack.profile) : profileDigest(pack.profile), pack.profile_digest);
  expect("admission.profile_digest", pack.profile_digest, pack.admission.profile_digest);
  expect("admission.profile_id", pack.profile.profile_id, pack.admission.profile_id);
  expect("admission.profile_version", pack.profile.profile_version,
    pack.admission.profile_version);
  expect("admission.guarantee_digest", sha256Bytes(pack.admission.guarantee),
    pack.admission.guarantee_digest);
  expect("pack.admission_digest", canonicalDigest(pack.admission),
    pack.admission_digest);
  expect("evaluation.profile_digest", pack.profile_digest, evaluation?.admission?.profile_digest);
  expect("evaluation.profile_id", pack.profile.profile_id, evaluation?.profile?.profile_id);
  expect(
    "evaluation.profile_version",
    pack.profile.profile_version,
    evaluation?.profile?.profile_version
  );
  return diagnostics;
}

function collectDiagnostics(structural, evaluation, bindings) {
  const tagged = [];
  const add = (source, values) => {
    for (const detail of values ?? []) tagged.push({ source, detail: clone(detail) });
  };
  add("structural_schema", structural.validation?.schema_errors);
  add("structural_validation", structural.validation?.diagnostics);
  add("structural_decomposition", structural.decomposition?.diagnostics);
  add("admitted_profile_evaluation", evaluation?.diagnostics);
  add("assessment_binding", bindings);
  return tagged.sort((left, right) => compareCodeUnits(
    `${left.source}\0${canonicalJson(left.detail)}`,
    `${right.source}\0${canonicalJson(right.detail)}`
  ));
}

function coveredClaims(evaluation) {
  const patternsByClaim = new Map();
  for (const result of evaluation?.pattern_results ?? []) {
    if (result.pattern_kind !== "claim" || result.status !== "satisfied") continue;
    for (const claimId of result.matched_ids ?? []) {
      const patternIds = patternsByClaim.get(claimId) ?? [];
      patternIds.push(result.pattern_id);
      patternsByClaim.set(claimId, patternIds);
    }
  }
  return [...patternsByClaim.entries()].map(([claimId, patternIds]) => ({
    claim_id: claimId,
    pattern_ids: [...new Set(patternIds)].sort(compareCodeUnits)
  })).sort((left, right) => compareCodeUnits(left.claim_id, right.claim_id));
}

function verifiedEdges(contract) {
  return (contract.relations ?? []).filter(({ role }) => role === "verifies")
    .map((relation) => ({
      relation_id: relation.relation_id,
      source_verification_claim_id: relation.source_claim_id,
      target_claim_id: relation.target_claim_id,
      scope_statement: EDGE_SCOPE_STATEMENT
    })).sort((left, right) => compareCodeUnits(left.relation_id, right.relation_id));
}

function mandatoryClaimCategories(contract, covered, edges) {
  const patternsByClaim = new Map(covered.map(
    ({ claim_id: claimId, pattern_ids: patternIds }) => [claimId, patternIds]
  ));
  const edgesByTarget = new Map();
  for (const edge of edges) {
    const ids = edgesByTarget.get(edge.target_claim_id) ?? [];
    ids.push(edge.relation_id);
    edgesByTarget.set(edge.target_claim_id, ids);
  }
  const result = {
    matched_profile_covered: [],
    structurally_verified_outside_profile: [],
    outside_selected_profile: []
  };
  const mandatory = (contract.claims ?? []).filter(
    ({ modality }) => modality === "MUST" || modality === "MUST_NOT"
  );
  for (const claim of mandatory) {
    const projection = {
      claim_id: claim.claim_id,
      kind: claim.kind,
      modality: claim.modality,
      proposition_id: claim.proposition_id,
      profile_pattern_ids: patternsByClaim.get(claim.claim_id) ?? [],
      structural_verification_edge_ids: (edgesByTarget.get(claim.claim_id) ?? [])
        .sort(compareCodeUnits)
    };
    if (projection.profile_pattern_ids.length > 0) {
      result.matched_profile_covered.push(projection);
    } else if (projection.structural_verification_edge_ids.length > 0) {
      result.structurally_verified_outside_profile.push(projection);
    } else {
      result.outside_selected_profile.push(projection);
    }
  }
  for (const values of Object.values(result)) values.sort(
    (left, right) => compareCodeUnits(left.claim_id, right.claim_id)
  );
  const categorizedIds = Object.values(result).flat().map(({ claim_id: id }) => id);
  if (categorizedIds.length !== mandatory.length ||
      new Set(categorizedIds).size !== mandatory.length) {
    throw new Error("mandatory claim categorization is not total and disjoint");
  }
  return result;
}

function proofExclusions(pack) {
  return (pack?.admission?.explicit_exclusions ?? []).map((exclusionId) => ({
    exclusion_id: exclusionId,
    adequacy_control_outcome: "release_certified"
  })).sort((left, right) => compareCodeUnits(left.exclusion_id, right.exclusion_id));
}

function propositionReferenceIds(proposition) {
  return [...new Set([
    proposition.subject_reference_id,
    ...(proposition.applicability_context?.operand_reference_ids ?? []),
    ...(proposition.operands ?? []).filter(({ kind }) => kind === "reference")
      .map(({ reference_id: referenceId }) => referenceId)
  ].filter(Boolean))].sort(compareCodeUnits);
}

function repositoryGrounding(contract) {
  const propositionById = new Map((contract.propositions ?? []).map(
    (proposition) => [proposition.proposition_id, proposition]
  ));
  const referenceById = new Map((contract.references ?? []).map(
    (reference) => [reference.reference_id, reference]
  ));
  const claims = (contract.claims ?? []).filter(({ kind, modality }) =>
    kind === "behavior" && ["MUST", "MUST_NOT"].includes(modality)
  ).map((claim) => {
    const proposition = propositionById.get(claim.proposition_id);
    const repositoryReferenceIds = proposition === undefined ? []
      : propositionReferenceIds(proposition).filter((referenceId) =>
          ["repository_path", "code_symbol"].includes(
            referenceById.get(referenceId)?.identity?.kind
          )
        );
    return {
      claim_id: claim.claim_id,
      proposition_id: claim.proposition_id,
      repository_reference_ids: repositoryReferenceIds
    };
  }).sort((left, right) => compareCodeUnits(left.claim_id, right.claim_id));
  const groundedIds = claims.filter(
    ({ repository_reference_ids: ids }) => ids.length > 0
  ).map(({ claim_id: claimId }) => claimId);
  const ungroundedIds = claims.filter(
    ({ repository_reference_ids: ids }) => ids.length === 0
  ).map(({ claim_id: claimId }) => claimId);
  return {
    status: claims.length > 0 && groundedIds.length === claims.length
      ? "all"
      : groundedIds.length === 0 ? "none" : "some",
    scope_statement: GROUNDING_SCOPE_STATEMENT,
    grounded_mandatory_behavior_claim_ids: groundedIds,
    ungrounded_mandatory_behavior_claim_ids: ungroundedIds,
    grounded_count: groundedIds.length,
    total_mandatory_behavior_count: claims.length,
    claims
  };
}

function collectionReviewSignals(structural) {
  const attachments = structural.decomposition?.facts?.collection_overlay
    ?.attachments ?? [];
  return attachments.flatMap((attachment) => {
    const population = attachment.verification_population;
    const membersWithVerification = new Set((population?.members ?? [])
      .filter(({ verification_claim_ids: ids }) => ids.length > 0)
      .map(({ behavior_claim_id: claimId }) => claimId));
    const memberIds = (population?.members_without_exclusive_falsifier_ids ?? [])
      .filter((claimId) => membersWithVerification.has(claimId));
    if (memberIds.length === 0) return [];
    return [{
      code: "shared_falsifier_scope_review",
      collection_id: attachment.collection_id,
      member_claim_ids: [...memberIds].sort(compareCodeUnits),
      shared_verification_claim_ids: [
        ...(population.shared_verification_claim_ids ?? [])
      ].sort(compareCodeUnits),
      shared_falsifying_proposition_ids: [
        ...(population.shared_falsifying_proposition_ids ?? [])
      ].sort(compareCodeUnits),
      scope_statement: "Members without an exclusive falsifier are a review signal only. Shared verification may legitimately cover related behaviors; profile-specific adequacy remains the responsibility of an admitted proof pack."
    }];
  }).sort((left, right) => compareCodeUnits(
    `${left.collection_id}\0${canonicalJson(left.member_claim_ids)}`,
    `${right.collection_id}\0${canonicalJson(right.member_claim_ids)}`
  ));
}

function action({ code, description, subjectIds = [], claimIds = [],
  populationReferenceIds = [], collectionIds = [], applicabilityContexts = [],
  requiredBindings = [], populationFacts = null }) {
  return {
    code,
    remediation_code: code,
    description,
    subject_ids: [...new Set(subjectIds)].sort(compareCodeUnits),
    claim_ids: [...new Set(claimIds)].sort(compareCodeUnits),
    population_reference_ids: [...new Set(populationReferenceIds)]
      .sort(compareCodeUnits),
    collection_ids: [...new Set(collectionIds)].sort(compareCodeUnits),
    applicability_contexts: sortCanonical(applicabilityContexts.map(clone)),
    required_bindings: [...new Set(requiredBindings)].sort(compareCodeUnits),
    ...(populationFacts === null ? {} : {
      accepted_membership_operators: [
        "reference:contains", "reference:member_of"
      ],
      declared_member_reference_ids:
        [...(populationFacts.declared_member_reference_ids ?? [])]
          .sort(compareCodeUnits),
      membership_claim_ids: [...(populationFacts.membership_claim_ids ?? [])]
        .sort(compareCodeUnits),
      declared_cardinality: populationFacts.declared_cardinality ?? null,
      declared_cardinality_values:
        [...(populationFacts.declared_cardinality_values ?? [])]
          .sort((left, right) => left - right),
      observed_member_count: populationFacts.observed_member_count ?? 0
    })
  };
}

function structuralDiagnosticAction(diagnostic, contract) {
  const { detail } = diagnostic;
  if (!["structural_validation", "structural_decomposition"].includes(
    diagnostic.source
  )) return null;
  const population = detail.population_reference_id
    ? [detail.population_reference_id] : [];
  const contexts = detail.applicability_context
    ? [detail.applicability_context] : [];
  const resolvedPopulation = detail.population_reference_id &&
      detail.applicability_context
    ? resolveClosedPopulationV1(
        contract, detail.population_reference_id, detail.applicability_context
      )
    : null;
  const declaredCardinalityValues = detail.values ?? [
    detail.exact_cardinality ?? resolvedPopulation?.exact_cardinality
  ].filter((value) => value !== null && value !== undefined);
  const populationFacts = {
    declared_member_reference_ids:
      resolvedPopulation?.member_reference_ids ?? [],
    membership_claim_ids: resolvedPopulation?.membership_claim_ids ?? [],
    declared_cardinality: declaredCardinalityValues.length === 1
      ? declaredCardinalityValues[0] : null,
    declared_cardinality_values: declaredCardinalityValues,
    observed_member_count: resolvedPopulation?.member_reference_ids.length ?? 0
  };
  if (detail.code === "population_definition_missing") return action({
    code: "declare_complete_population_definition",
    description: "Declare complete membership with reference:contains or reference:member_of and the exact cardinality, or explicitly declare cardinality zero if the intended population is empty; adding an arbitrary cardinality alone is not sufficient.",
    subjectIds: population,
    populationReferenceIds: population,
    applicabilityContexts: contexts,
    requiredBindings: ["complete_population_membership", "exact_population_cardinality"],
    populationFacts
  });
  if (detail.code === "population_exact_cardinality_missing") return action({
    code: "declare_population_exact_cardinality",
    description: "Declare the exact cardinality that matches the complete authored population membership.",
    subjectIds: population,
    claimIds: detail.claim_ids ?? [],
    populationReferenceIds: population,
    applicabilityContexts: contexts,
    requiredBindings: ["exact_population_cardinality"],
    populationFacts
  });
  if (detail.code === "population_membership_incomplete") return action({
    code: "declare_complete_population_membership",
    description: "Declare complete population membership with reference:contains or reference:member_of matching the authored exact cardinality.",
    subjectIds: population,
    claimIds: detail.claim_ids ?? [],
    populationReferenceIds: population,
    applicabilityContexts: contexts,
    requiredBindings: ["complete_population_membership"],
    populationFacts
  });
  if (["population_exact_cardinality_ambiguous",
    "population_exact_cardinality_invalid"].includes(detail.code)) return action({
    code: "correct_population_exact_cardinality",
    description: "Replace the conflicting or invalid cardinality declarations with one non-negative exact cardinality matching the complete membership.",
    subjectIds: population,
    claimIds: detail.claim_ids ?? [],
    populationReferenceIds: population,
    applicabilityContexts: contexts,
    requiredBindings: ["exact_population_cardinality"],
    populationFacts
  });
  if (detail.code === "mandatory_behavior_unverified") return action({
    code: "bind_mandatory_behavior_verification",
    description: "Add a qualifying authored verification edge for the mandatory behavior claim.",
    subjectIds: [detail.claim_id],
    claimIds: [detail.claim_id],
    requiredBindings: ["qualifying_verification_edge"]
  });
  return null;
}

function reviewActions(grounding, reviewSignals) {
  const actions = [];
  if (grounding.ungrounded_mandatory_behavior_claim_ids.length > 0) actions.push(action({
    code: "confirm_or_bind_repository_grounding",
    description: "Confirm that each ungrounded mandatory behavior is intentionally generic, or bind its proposition to an appropriate repository_path or code_symbol identity. Such a reference remains a structural anchor, not proof of existence or honesty.",
    subjectIds: grounding.ungrounded_mandatory_behavior_claim_ids,
    claimIds: grounding.ungrounded_mandatory_behavior_claim_ids,
    requiredBindings: ["repository_grounding_disposition"]
  }));
  for (const signal of reviewSignals) actions.push(action({
    code: "confirm_shared_falsifier_scope",
    description: "Confirm that the shared verifier or falsifier legitimately discriminates the related collection members; this review does not replace admitted proof-pack adequacy.",
    subjectIds: signal.member_claim_ids,
    claimIds: signal.member_claim_ids,
    collectionIds: [signal.collection_id],
    requiredBindings: ["shared_falsifier_scope_disposition"]
  }));
  return actions;
}

function requiredNextEvidence({ structure, profileDiscrimination, exactBinding, categories,
  exclusions, residue, diagnostics, contract }) {
  const required = [];
  const structuralDiagnostics = diagnostics.filter(({ source }) =>
    ["structural_schema", "structural_validation", "structural_decomposition"]
      .includes(source)
  );
  const mapped = structuralDiagnostics.map((diagnostic) =>
    structuralDiagnosticAction(diagnostic, contract));
  required.push(...mapped.filter(Boolean));
  if (structure !== "proven" && (structuralDiagnostics.length === 0 ||
      mapped.some((value) => value === null))) required.push(action({
    code: "structural_contract_remediation",
    description: "Resolve the reported schema, carrier, or decomposition diagnostics without a more specific mechanical mapping.",
    requiredBindings: ["controlled_contract"]
  }));
  if (profileDiscrimination === "not_proven") required.push(action({
    code: "admitted_profile_remediation",
    description: "Supply a satisfied evaluation under a current release-certified proof pack.",
    requiredBindings: ["immutable_proof_pack", "evaluation_input"]
  }));
  if (profileDiscrimination === "not_assessed") required.push(action({
    code: "admitted_profile_assessment",
    description: "Run an admitted, adequacy-verified proof profile against the controlled graph.",
    requiredBindings: ["immutable_proof_pack", "evaluation_input"]
  }));
  if (exactBinding === "not_proven") required.push(action({
    code: "exact_binding_remediation",
    description: "Supply every declared exact-binding source and satisfy each captured content or identity relation.",
    requiredBindings: ["exact_binding_sources", "deterministic_capture"]
  }));
  if (categories.outside_selected_profile.length > 0) required.push(action({
    code: "mandatory_claims_outside_profile",
    description: "Provide separate evidence or an admitted profile covering each mandatory claim outside the selected profile.",
    subjectIds: categories.outside_selected_profile.map(({ claim_id: id }) => id),
    claimIds: categories.outside_selected_profile.map(({ claim_id: id }) => id),
    requiredBindings: ["claim_specific_evidence_or_profile"]
  }));
  for (const exclusion of exclusions) required.push(action({
    code: "proof_exclusion_requires_separate_evidence",
    description: "The selected proof pack explicitly excludes this subject from its guarantee.",
    subjectIds: [exclusion.exclusion_id],
    requiredBindings: ["separate_evidence"]
  }));
  for (const entry of residue) required.push(action(entry.reason === "review_only" ? {
    code: "residue_review_required",
    description: "Complete the explicitly externalized review for this residue entry.",
    subjectIds: [entry.residue_id],
    requiredBindings: ["residue_review_disposition"]
  } : {
    code: "residue_resolution_required",
    description: "Resolve this controlled-representation gap or retain an explicit disposition.",
    subjectIds: [entry.residue_id],
    requiredBindings: ["residue_disposition"]
  }));
  return [...new Map(required.map((entry) => [canonicalJson(entry), entry])).values()];
}

function overallCode(structure, profileDiscrimination, exactBinding, residueStatus) {
  const axes = [
    `structure_${structure}`,
    `profile_${profileDiscrimination}`
  ];
  if (exactBinding !== "not_applicable") axes.push(`exact_binding_${exactBinding}`);
  return [
    ...axes,
    `residue_${residueStatus}`
  ].join("__");
}

function expectedExactBindingContext(pack, contract, evaluationInput) {
  return {
    contract_digest: exactCanonicalDigest(contract),
    profile_digest: profileDigest(pack.profile),
    evaluation_input_digest: exactCanonicalDigest(evaluationInput),
    vocabulary_version: VOCABULARY_VERSION,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete,
    admission_digest: pack.admission_digest,
    exact_binding_declaration_digest: pack.exact_binding_declaration_digest,
    exact_binding_certification_digest: pack.exact_binding_certification_digest
  };
}

function coverageShape(coverage) {
  return canonicalJson({
    role: coverage.role,
    projection: coverage.projection,
    population_id: coverage.population_id ?? null,
    projection_id: coverage.projection_id ?? null
  });
}

function declarationBindingDiagnostics(pack, result) {
  if (result === null || result.satisfaction !== "satisfied") return [];
  const diagnostics = [];

  for (const detail of semanticDeclarationDiagnostics(pack.declaration ?? {})) {
    diagnostics.push({
      code: "exact_binding_declaration_result_mismatch",
      field: "declaration.schema",
      declaration_diagnostic_code: detail.code
    });
  }
  const mismatch = (field, requirementId) => diagnostics.push({
    code: "exact_binding_declaration_result_mismatch",
    field,
    ...(requirementId === undefined ? {} : { requirement_id: requirementId })
  });

  for (const [field, expected] of [
    ["declaration.profile_id", pack.profile?.profile_id],
    ["declaration.profile_version", pack.profile?.profile_version],
    ["declaration.profile_digest", profileDigest(pack.profile)]
  ]) {
    const actual = pack.declaration?.[field.slice("declaration.".length)];
    if (actual !== expected) mismatch(field);
  }
  const declared = new Map((pack.declaration?.requirements ?? []).map(
    (requirement) => [requirement.requirement_id, requirement]
  ));
  const captured = new Map((result.bindings ?? []).map(
    (binding) => [binding.requirement_id, binding]
  ));
  for (const requirementId of captured.keys()) {
    if (!declared.has(requirementId)) mismatch("requirements", requirementId);
  }
  for (const [requirementId, requirement] of declared) {
    const binding = captured.get(requirementId);
    if (!binding) {
      mismatch("requirements", requirementId);
      continue;
    }
    if (binding.binding_kind !== requirement.binding_kind) {
      mismatch("binding_kind", requirementId);
    }

    if (requirement.expected_content_sha256 !== undefined &&
        requirement.expected_content_sha256 !== binding.content_sha256) {
      mismatch("expected_content_sha256", requirementId);
    }
    const declaredCoverage = requirement.role_coverage.map(coverageShape).sort();
    const capturedCoverage = binding.role_coverage.map(coverageShape).sort();
    if (canonicalJson(declaredCoverage) !== canonicalJson(capturedCoverage)) {
      mismatch("role_coverage", requirementId);
    }
  }
  const capturedRelations = new Map((result.relation_results ?? []).map(
    (relation) => [relation.relation_id, relation]
  ));
  for (const relation of pack.declaration?.relations ?? []) {
    const observed = capturedRelations.get(relation.relation_id);
    if (!observed || observed.operator !== relation.operator) {
      mismatch("relations");
      continue;
    }
    const declaredOperands = relation.operator === "deterministic_projection"
      ? canonicalJson({
          transformer_id: relation.transformer_id,
          source_requirement_ids: relation.source_requirement_ids,
          result_requirement_id: relation.result_requirement_id
        })
      : canonicalJson({ requirement_ids: relation.requirement_ids });
    const observedOperands = relation.operator === "deterministic_projection"
      ? canonicalJson({
          transformer_id: observed.transformer_id,
          source_requirement_ids: observed.source_requirement_ids,
          result_requirement_id: observed.result_requirement_id
        })
      : canonicalJson({ requirement_ids: observed.requirement_ids });
    if (declaredOperands !== observedOperands) mismatch("relations");
  }
  for (const relationId of capturedRelations.keys()) {
    if (!(pack.declaration?.relations ?? []).some(
      ({ relation_id: id }) => id === relationId
    )) mismatch("relations");
  }
  return diagnostics;
}

function exactBindingDiagnostics(pack, contract, evaluationInput, result) {
  if (result === null) return [];
  assertCapturedExactBindingResult(result);
  const expected = expectedExactBindingContext(pack, contract, evaluationInput);
  return Object.entries(expected).flatMap(([field, value]) =>
    result.context?.[field] === value ? [] : [{
      field: `exact_binding.context.${field}`,
      expected: value,
      actual: result.context?.[field] ?? null
    }]
  );
}

function assertAssessmentValid(assessment) {
  if (!validateAssessmentSchema(assessment)) throw new Error(
    `assessment projector emitted schema-invalid output: ${JSON.stringify(
      validateAssessmentSchema.errors
    )}`
  );
}

function projectContractAssessment({
  mode,
  contract,
  structuralResult,
  structuralInputSource,
  evaluationInput = null,
  proofPack = null,
  exactBindingResult = null,
  exactBindingSources = null
}) {
  if (!["structural_only", "admitted_profile", "exact_bound_profile"].includes(mode)) {
    throw new Error("mode must be structural_only, admitted_profile, or exact_bound_profile");
  }
  if (sha256Bytes(canonicalJson(ASSESSMENT_SCHEMA)) !==
      sha256Bytes(canonicalJson(JSON.parse(assessmentSchemaText)))) {
    throw new Error("assessment schema source changed during module initialization");
  }
  if (typeof structuralInputSource !== "string" ||
      structuralResult?.input?.sha256 !== sha256Bytes(structuralInputSource)) {
    throw new Error("structural result is not bound to the supplied contract source bytes");
  }
  let parsedStructuralInput;
  try {
    parsedStructuralInput = JSON.parse(structuralInputSource);
  } catch (error) {
    throw new Error(`structural contract source is not JSON: ${error.message}`);
  }
  if (canonicalJson(parsedStructuralInput) !== canonicalJson(contract)) {
    throw new Error("structural result source and supplied contract value differ");
  }
  if (mode === "structural_only" &&
      (evaluationInput !== null || proofPack !== null || exactBindingResult !== null ||
        exactBindingSources !== null)) {
    throw new Error("structural_only mode rejects proof-profile inputs");
  }
  if (mode !== "structural_only" &&
      (!evaluationInput || !proofPack)) {
    throw new Error("admitted_profile mode requires evaluation input and proof pack admission");
  }
  if (mode === "admitted_profile" && proofPack?.admission_version === 2) {
    throw new Error("v2 proof packs require exact capture inputs and exact_bound_profile mode");
  }
  if (mode === "admitted_profile" && exactBindingSources !== null) {
    throw new Error("admitted_profile mode rejects exact-binding sources");
  }
  if (mode === "exact_bound_profile" &&
      (proofPack?.admission_version !== 2 || !exactBindingResult ||
        !exactBindingSources)) {
    throw new Error("exact_bound_profile requires a v2 pack and captured exact-binding result");
  }

  const contractSnapshot = clone(contract);
  const structuralSnapshot = clone(structuralResult);
  const pack = proofPack;
  const evaluationInputSnapshot = evaluationInput === null ? null : clone(evaluationInput);
  const contractDigest = canonicalDigest(normalizeContractForIdentity(contractSnapshot));
  const assessmentSchemaDigest = canonicalDigest(ASSESSMENT_SCHEMA);
  const selectionTrace = mode === "exact_bound_profile"
    ? createGraphSelectionTrace() : null;
  let evaluation = null;
  if (mode !== "structural_only") try {
    evaluation = pack.profile.schema_version === "controlled-contract-test-validity-profile.v1"
      ? evaluateAdmittedTestValidity({
          contract: clone(contractSnapshot),
          evaluationInput: clone(evaluationInputSnapshot),
          proofPack: pack
        })
      : evaluateVerificationProfileV1({
          contract: clone(contractSnapshot),
          profile: clone(pack.profile),
          evaluation_input: clone(evaluationInputSnapshot)
        }, selectionTrace === null ? {} : { graphSelectionSink: selectionTrace.sink });
  } catch (error) {
    if (!(error instanceof StableVerificationError)) throw error;
    evaluation = {
      satisfaction: "invalid",
      profile: null,
      admission: null,
      diagnostics: clone(error.details?.diagnostics?.diagnostics ?? [{
        code: error.code, message: error.message
      }])
    };
  }
  const bindings = mode !== "structural_only"
    ? bindingDiagnostics(pack, evaluation)
    : [];
  const admissionValid = mode !== "structural_only" && bindings.length === 0;
  const structure = structureAxis(structuralSnapshot);
  const exactBindings = mode === "exact_bound_profile"
    ? [
      ...exactBindingDiagnostics(
        pack, contractSnapshot, evaluationInputSnapshot, exactBindingResult
      ),
      ...declarationBindingDiagnostics(pack, exactBindingResult)
    ]
    : [];
  const projectedEnvelope = mode === "exact_bound_profile"
    ? projectedEvaluationEnvelopeFor(exactBindingResult) : null;
  const projectedEvaluation = mode === "exact_bound_profile"
    ? evaluateProjectedEvaluationBinding({
        declaredOptIn: pack.declaration?.projected_evaluation_binding ?? null,
        envelope: projectedEnvelope,
        exactBindingResult,
        expectedContext: expectedExactBindingContext(
          pack, contractSnapshot, evaluationInputSnapshot
        ),
        contract: contractSnapshot,
        profile: pack.profile,
        evaluation,
        trace: selectionTrace.snapshot()
      })
    : { applicable: false, diagnostics: [] };
  const exactBinding = mode === "exact_bound_profile"
    ? exactBindings.length === 0 &&
        bindings.length === 0 &&
        projectedEvaluation.diagnostics.length === 0 &&
        exactBindingResult.provenance?.capture_verified === true &&
        exactBindingResult.satisfaction === "satisfied"
      ? "proven"
      : "not_proven"
    : "not_applicable";
  const profileDiscrimination = mode === "structural_only"
    ? "not_assessed"
    : admissionValid && structure === "proven" &&
        evaluation.satisfaction === "satisfied" && exactBinding !== "not_proven"
      ? "proven"
      : "not_proven";
  const covered = coveredClaims(evaluation);
  const edges = verifiedEdges(contractSnapshot);
  const categories = mandatoryClaimCategories(contractSnapshot, covered, edges);
  const exclusions = proofExclusions(pack);
  const residue = Array.isArray(contractSnapshot.residue)
    ? sortByKey(contractSnapshot.residue.map(clone), "residue_id")
    : [];
  const residueStatus = residueAxis(residue);
  const diagnostics = [
    ...collectDiagnostics(structuralSnapshot, evaluation, bindings),
    ...exactBindings.map((detail) => ({ source: "assessment_binding", detail })),
    ...projectedEvaluation.diagnostics.map((detail) => ({
      source: "assessment_binding",
      detail: { ...detail, field: "exact_binding.projected_evaluation" }
    }))
  ];
  const grounding = repositoryGrounding(contractSnapshot);
  const reviewSignals = collectionReviewSignals(structuralSnapshot);

  const normalizedStructural = normalizeStructuralResult(
    structuralSnapshot, contractDigest
  );
  const normalizedEvaluation = evaluation === null
    ? null
    : canonicalValue(clone(evaluation));
  const normalizedAdmission = pack === null ? null : canonicalValue(clone(pack.admission));
  const normalizedExactBinding = exactBindingResult === null
    ? null : canonicalValue(clone(exactBindingResult));
  const sourceDigests = {
    contract: contractDigest,
    evaluation_input: evaluationInputSnapshot === null
      ? null
      : canonicalDigest(normalizeEvaluationInputForIdentity(evaluationInputSnapshot)),
    profile: pack === null ? null : pack.profile_digest,
    admission: pack === null ? null : pack.admission_digest,
    guarantee: pack === null ? null : pack.admission.guarantee_digest,
    adequacy_declaration: pack === null
      ? null
      : pack.admission.certification.adequacy_declaration_digest,
    adequacy_result: pack === null
      ? null
      : pack.admission.certification.adequacy_result_digest,
    ...(mode === "exact_bound_profile" ? {
      exact_binding_sources: exactCanonicalDigest(exactBindingSources),
      exact_binding_declaration: pack.exact_binding_declaration_digest,
      exact_binding_certification: pack.exact_binding_certification_digest
    } : {}),
    structural_schema: structuralSnapshot.schema.sha256,
    assessment_schema: assessmentSchemaDigest,
    assessment_format: canonicalDigest(ASSESSMENT_FORMAT)
  };
  const resultDigests = {
    structural: canonicalDigest(normalizedStructural),
    admitted_profile: normalizedEvaluation === null
      ? null
      : canonicalDigest(normalizedEvaluation),
    proof_pack_admission: normalizedAdmission === null
      ? null
      : canonicalDigest(normalizedAdmission),
    ...(mode === "exact_bound_profile" ? {
      exact_binding: canonicalDigest(normalizedExactBinding)
    } : {})
  };
  const assessmentIdentity = canonicalDigest({
    assessment_schema_version: ASSESSMENT_SCHEMA_VERSION,
    assessment_tool_version: ASSESSMENT_TOOL_VERSION,
    mode,
    source_digests: sourceDigests,
    result_digests: resultDigests
  });
  const contentReference =
    `controlled-contract-assessment://sha256/${assessmentIdentity}/manifest.json`;
  const assessment = {
    schema_version: ASSESSMENT_SCHEMA_VERSION,
    assessment_identity: assessmentIdentity,
    structure,
    profile_discrimination: profileDiscrimination,
    ...(mode === "exact_bound_profile" ? { exact_binding: exactBinding } : {}),
    assessment_scope: "planning",
    residue_status: residueStatus,
    authority: "non_authoritative",
    overall_code: overallCode(
      structure, profileDiscrimination, exactBinding, residueStatus
    ),
    verification_scope: {
      graph_edge_coverage: "assessed",
      proof_plan_discrimination: admissionValid
        ? "assessed_by_admitted_profile"
        : "not_assessed",
      ...(mode === "exact_bound_profile" ? {
        exact_binding_capture: "assessed_by_deterministic_capture",
        projected_evaluation_binding: projectedEvaluation.applicable
          ? (projectedEvaluation.diagnostics.length === 0
            ? "bound_to_deterministic_projection" : "not_bound")
          : "not_declared"
      } : {})
    },
    categorical_limits: {
      omitted_obligations: "The checker cannot discover an obligation omitted from the authored contract.",
      repository_grounding: GROUNDING_SCOPE_STATEMENT,
      runtime_behavior: "Delivered runtime behavior is outside this planning assessment.",
      implementation_readiness: "A clean structural assessment is not, by itself, proof that a WK is implementation-ready."
    },
    profile_guarantee: pack === null ? null : {
      profile_id: pack.profile.profile_id,
      profile_version: pack.profile.profile_version,
      guarantee: pack.admission.guarantee,
      scope_statement: PROFILE_SCOPE_STATEMENT
    },
    matched_profile_covered_claims: covered,
    structurally_verified_claim_edges: edges,
    mandatory_claim_categories: categories,
    repository_grounding: grounding,
    proof_exclusions: exclusions,
    diagnostics,
    residue,
    review_signals: reviewSignals,
    review_actions: reviewActions(grounding, reviewSignals),
    required_next_evidence: requiredNextEvidence({
      structure,
      profileDiscrimination,
      exactBinding,
      categories,
      exclusions,
      residue,
      diagnostics,
      contract: contractSnapshot
    }),
    digests: {
      algorithm: "sha256-canonical-json-v1",
      source: sourceDigests,
      results: resultDigests
    },
    lossless_report: {
      content_reference: contentReference,
      files: [...(mode === "exact_bound_profile"
        ? EXACT_BOUND_LOSSLESS_FILES : LOSSLESS_FILES)]
    }
  };
  assertAssessmentValid(assessment);
  const reportEnvelope = (reportKind, result, extra = {}) => ({
    report_version: ASSESSMENT_REPORT_VERSION,
    report_kind: reportKind,
    assessment_identity: assessmentIdentity,
    source_digests: clone(sourceDigests),
    ...extra,
    result
  });
  const reports = {
    structural: reportEnvelope("structural", normalizedStructural),
    admittedProof: reportEnvelope(
      "admitted_proof_profile",
      normalizedEvaluation,
      {
        admission: pack === null ? null : {
          release_admission_bound: true,
          release_certification_verified: admissionValid,
          profile_discrimination: profileDiscrimination
        }
      }
    ),
    proofPackAdmission: reportEnvelope(
      "proof_pack_release_admission",
      normalizedAdmission
    ),
    exactBinding: reportEnvelope(
      "exact_binding_capture",
      normalizedExactBinding,
      { exact_binding: exactBinding }
    )
  };
  const projected = deepFreeze({ assessment: clone(assessment), reports: clone(reports) });
  if (mode === "exact_bound_profile" &&
      hasTrustedProjectedSelection(projectedEvaluation) &&
      exactBindings.length === 0 && bindings.length === 0 &&
      exactBindingResult.provenance?.capture_verified === true) {
    const exactSupplementContext = exactBindingSupplementContext({
      result: exactBindingResult,
      declaration: pack.declaration,
      declarationDigest: pack.exact_binding_declaration_digest,
      sourceSet: exactBindingSources
    });
    registerAssessmentSupplementContext(projected, deepFreeze({
      contract: clone(contractSnapshot),
      evaluation_input: clone(evaluationInputSnapshot),
      proof_pack: clone(pack),
      exact_binding_declaration: exactSupplementContext.declaration,
      exact_binding_result: exactSupplementContext.result,
      exact_binding_sources: exactSupplementContext.source_set,
      projected_envelope: projectedEnvelope,
      projected_evaluation: projectedEvaluation
    }));
  }
  return projected;
}

async function readJsonSource(filePath, label) {
  const source = await readFile(filePath, "utf8");
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`invalid JSON in ${label} ${filePath}: ${error.message}`);
  }
  return { source, value };
}

async function assessContractFiles({
  inputPath,
  profileId,
  evaluationInputPath
}) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedEvaluationInput = path.resolve(evaluationInputPath);
  const firstContractSource = await readJsonSource(resolvedInput, "controlled contract");
  const [structuralResult, evaluationInputSource, proofPack] = await Promise.all([
    checkContract(resolvedInput),
    readJsonSource(resolvedEvaluationInput, "profile evaluation input"),
    loadAdmittedProofPack(profileId)
  ]);
  const secondContractSource = await readFile(resolvedInput, "utf8");
  if (sha256Bytes(firstContractSource.source) !== sha256Bytes(secondContractSource)) {
    throw new Error("controlled contract changed while it was being structurally checked");
  }
  const projected = projectContractAssessment({
    mode: "admitted_profile",
    contract: firstContractSource.value,
    structuralResult,
    structuralInputSource: firstContractSource.source,
    evaluationInput: evaluationInputSource.value,
    proofPack
  });
  PUBLISHABLE_ASSESSMENTS.add(projected);
  return projected;
}

async function assessExactBoundContractFiles({
  captureRoot,
  contractPath,
  profileId,
  evaluationInputPath,
  exactBindingSources
}) {
  const proofPack = await loadAdmittedProofPack(profileId);
  if (proofPack.admission_version !== 2) throw new Error(
    "exact capture inputs may be used only with a v2 exact-bound proof pack"
  );
  const captured = await captureExactBoundAssessmentInputsV1({
    contractPath,
    evaluationInputPath,
    profileId,
    exactBindingSources
  }, {
    captureRoot: path.resolve(captureRoot),
    proofPack,
    vocabularyIdentity: {
      version: VOCABULARY_VERSION,
      complete_digest: VOCABULARY_DIGESTS.complete
    }
  });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cc-exact-assessment-"));
  try {
    const snapshotPath = path.join(temporary, "contract.json");
    await writeFile(snapshotPath, captured.contractSource, { flag: "wx" });
    const structuralResult = await checkContract(snapshotPath);
    const projected = projectContractAssessment({
      mode: "exact_bound_profile",
      contract: captured.contract,
      structuralResult,
      structuralInputSource: captured.contractSource,
      evaluationInput: captured.evaluationInput,
      proofPack,
      exactBindingResult: captured.exactBindingResult,
      exactBindingSources: captured.exactBindingSources
    });
    PUBLISHABLE_ASSESSMENTS.add(projected);
    return projected;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function assessStructuralContractFile({ inputPath }) {
  const resolvedInput = path.resolve(inputPath);
  const firstContractSource = await readJsonSource(resolvedInput, "controlled contract");
  const structuralResult = await checkContract(resolvedInput);
  const secondContractSource = await readFile(resolvedInput, "utf8");
  if (sha256Bytes(firstContractSource.source) !== sha256Bytes(secondContractSource)) {
    throw new Error("controlled contract changed while it was being structurally checked");
  }
  const projected = projectContractAssessment({
    mode: "structural_only",
    contract: firstContractSource.value,
    structuralResult,
    structuralInputSource: firstContractSource.source
  });
  PUBLISHABLE_ASSESSMENTS.add(projected);
  return projected;
}

function assessmentManifestFor(projected) {
  const { assessment, reports } = projected;
  const entries = [
    ["assessment.json", canonicalJson(assessment)],
    ["assessment.md", markdownAssessment(assessment)],
    ["structural.full.json", canonicalJson(reports.structural)],
    ["admitted-proof.full.json", canonicalJson(reports.admittedProof)],
    ["proof-pack-admission.full.json", canonicalJson(reports.proofPackAdmission)]
  ];
  if (assessment.lossless_report.files.includes("exact-binding.full.json")) {
    entries.push(["exact-binding.full.json", canonicalJson(reports.exactBinding)]);
  }
  const files = new Map(entries);
  return deepFreeze({
    manifest_version: ASSESSMENT_MANIFEST_VERSION,
    assessment_identity: assessment.assessment_identity,
    content_reference: assessment.lossless_report.content_reference,
    source_digests: clone(assessment.digests.source),
    files: [...files].map(([name, contents]) => ({
      name,
      sha256: sha256Bytes(contents),
      bytes: Buffer.byteLength(contents)
    }))
  });
}

function bundleBytes(projected) {
  const { assessment, reports } = projected;
  const files = new Map([
    ["assessment.json", canonicalJson(assessment)],
    ["assessment.md", markdownAssessment(assessment)],
    ["structural.full.json", canonicalJson(reports.structural)],
    ["admitted-proof.full.json", canonicalJson(reports.admittedProof)],
    ["proof-pack-admission.full.json", canonicalJson(reports.proofPackAdmission)]
  ]);
  if (assessment.lossless_report.files.includes("exact-binding.full.json")) {
    files.set("exact-binding.full.json", canonicalJson(reports.exactBinding));
  }
  const manifest = assessmentManifestFor(projected);
  files.set("manifest.json", canonicalJson(manifest));
  return files;
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) &&
    relative !== ".." && !path.isAbsolute(relative));
}

async function verifyExistingBundle(directory, expectedFiles, artifactRoot) {
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new AssessmentArtifactError(
      "assessment_artifact_collision",
      "existing assessment identity is not a plain directory",
      { directory }
    );
  }
  const resolvedDirectory = await realpath(directory);
  if (!pathIsWithin(artifactRoot, resolvedDirectory)) {
    throw new AssessmentArtifactError(
      "assessment_artifact_path_escape",
      "existing assessment identity resolves outside the fixed artifact root",
      { directory, resolved_directory: resolvedDirectory }
    );
  }
  const names = (await readdir(directory)).sort(compareCodeUnits);
  const expectedNames = [...expectedFiles.keys()].sort(compareCodeUnits);
  if (canonicalJson(names) !== canonicalJson(expectedNames)) {
    throw new AssessmentArtifactError(
      "assessment_artifact_collision",
      "existing assessment bundle has an inconsistent file set",
      { directory, names, expected_names: expectedNames }
    );
  }
  for (const [name, expected] of expectedFiles) {
    const filePath = path.join(directory, name);
    const fileStat = await lstat(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new AssessmentArtifactError(
      "assessment_artifact_collision",
      "existing assessment bundle contains a non-regular file",
      { file: filePath }
    );
    const resolvedFile = await realpath(filePath);
    if (!pathIsWithin(resolvedDirectory, resolvedFile)) throw new AssessmentArtifactError(
      "assessment_artifact_path_escape",
      "existing assessment file resolves outside its identity directory",
      { file: filePath, resolved_file: resolvedFile }
    );
    const actual = await readFile(filePath, "utf8");
    if (actual !== expected) throw new AssessmentArtifactError(
      "assessment_artifact_collision",
      "existing assessment bundle conflicts with the projected bytes",
      { file: filePath }
    );
  }
}

async function ensureConfinedArtifactRoot(repository) {
  let parent = repository;
  for (const segment of ARTIFACT_RELATIVE_ROOT.split(path.sep)) {
    const candidate = path.join(parent, segment);
    try {
      await mkdir(candidate, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stat = await lstat(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AssessmentArtifactError(
      "assessment_artifact_root_escape",
      "fixed assessment artifact root contains a non-directory or symbolic-link component",
      { repository, component: candidate }
    );
    const resolved = await realpath(candidate);
    if (!pathIsWithin(repository, resolved)) throw new AssessmentArtifactError(
      "assessment_artifact_root_escape",
      "fixed assessment artifact root component resolves outside the repository",
      { repository, component: candidate, resolved_component: resolved }
    );
    parent = resolved;
  }
  return parent;
}

async function writeAssessmentBundle(projected, { repositoryRoot }) {
  if (projected === null || typeof projected !== "object" ||
      !PUBLISHABLE_ASSESSMENTS.has(projected)) throw new AssessmentArtifactError(
    "assessment_projection_untrusted",
    "assessment bundles may be written only from a file assessment produced by this module"
  );
  const repository = await realpath(path.resolve(repositoryRoot));
  const actualArtifactRoot = await ensureConfinedArtifactRoot(repository);
  const identity = projected.assessment.assessment_identity;
  if (!/^[a-f0-9]{64}$/u.test(identity)) throw new AssessmentArtifactError(
    "assessment_identity_invalid",
    "assessment identity is not a sha256 digest"
  );
  const target = path.join(actualArtifactRoot, identity);
  if (!pathIsWithin(actualArtifactRoot, target)) throw new AssessmentArtifactError(
    "assessment_artifact_path_escape",
    "assessment artifact target escapes the fixed root",
    { target }
  );
  const files = bundleBytes(projected);
  try {
    await verifyExistingBundle(target, files, actualArtifactRoot);
    return deepFreeze({
      reused: true,
      directory: target,
      content_reference: projected.assessment.lossless_report.content_reference
    });
  } catch (error) {
    if (error instanceof AssessmentArtifactError) throw error;
    if (error?.code !== "ENOENT") throw error;
  }

  const temporary = await mkdtemp(path.join(actualArtifactRoot, `.${identity}.tmp-`));
  const resolvedTemporary = await realpath(temporary);
  if (!pathIsWithin(actualArtifactRoot, resolvedTemporary)) {
    await rm(temporary, { recursive: true, force: true });
    throw new AssessmentArtifactError(
      "assessment_artifact_path_escape",
      "temporary assessment directory escaped the fixed artifact root",
      { temporary, resolved_temporary: resolvedTemporary }
    );
  }
  try {
    for (const [name, contents] of files) await writeFile(
      path.join(temporary, name),
      contents,
      { encoding: "utf8", flag: "wx", mode: 0o600 }
    );
    try {
      await rename(temporary, target);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error?.code)) throw error;
      await verifyExistingBundle(target, files, actualArtifactRoot);
      await rm(temporary, { recursive: true, force: true });
      return deepFreeze({
        reused: true,
        directory: target,
        content_reference: projected.assessment.lossless_report.content_reference
      });
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return deepFreeze({
    reused: false,
    directory: target,
    content_reference: projected.assessment.lossless_report.content_reference
  });
}

export {
  ARTIFACT_RELATIVE_ROOT,
  ASSESSMENT_FORMAT,
  ASSESSMENT_FORMAT_VERSION,
  ASSESSMENT_IMPLEMENTATION_DIGEST,
  ASSESSMENT_MANIFEST_VERSION,
  ASSESSMENT_REPORT_VERSION,
  ASSESSMENT_SCHEMA,
  ASSESSMENT_SCHEMA_VERSION,
  ASSESSMENT_TOOL_VERSION,
  AssessmentArtifactError,
  EXACT_BOUND_LOSSLESS_FILES,
  LOSSLESS_FILES,
  assessContractFiles,
  assessExactBoundContractFiles,
  assessStructuralContractFile,
  bundleBytes,
  canonicalDigest,
  canonicalJson,
  compactAssessmentOutput,
  markdownAssessment,
  normalizeContractForIdentity,
  normalizeEvaluationInputForIdentity,
  projectContractAssessment,
  validateAssessmentSchema,
  writeAssessmentBundle
};
