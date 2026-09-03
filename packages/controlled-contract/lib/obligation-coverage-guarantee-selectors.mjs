import {
  AdmittedProofPackError,
  assertAdmittedProofPackSnapshot
} from "./admitted-proof-packs.mjs";
import {
  ExactBindingError,
  compareCodeUnits,
  deepFreeze,
  unsupportedObjectKeys
} from "./deterministic-projection-primitives.mjs";
import {
  assertCapturedExactBindingResult
} from "./exact-binding.mjs";
import {
  StableVerificationError,
  assertVerificationProfileV1Result
} from "./verification-profile-v1.mjs";
import { recognizedObligationGuaranteeSelectorPacks } from
  "./multi-pack-assessment.mjs";

const OBLIGATION_GUARANTEE_SELECTOR_INDEX_VERSION =
  "obligation-guarantee-selector-index.v1";
const PROFILE_EVALUATION_RESULT_VERSION =
  "controlled-contract-verification-profile-result.v1";
const OBLIGATION_GUARANTEE_SELECTOR_KINDS = Object.freeze([
  "reference_binding", "claim", "relation", "collection", "resolver_fact",
  "evidence"
]);
const SELECTOR_FIELDS = Object.freeze({
  reference_binding: "reference_binding_patterns",
  claim: "claim_patterns",
  relation: "relation_patterns",
  collection: "collection_patterns",
  resolver_fact: "resolver_fact_patterns",
  evidence: "evidence_patterns"
});
const RESOLUTION_STATUSES = Object.freeze([
  "compatible", "incompatible", "mapped_input_missing",
  "mapped_pack_not_evaluated", "profile_proven_exact_binding_missing"
]);
const SELECTOR_INDEXES = new WeakSet();
const COMPONENT_APPLICABILITY_MODES = new WeakMap();

class ObligationGuaranteeSelectorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ObligationGuaranteeSelectorError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new ObligationGuaranteeSelectorError(code, message, details);
}

function object(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("obligation_guarantee_selector_input_invalid", `${name} must be an object`);
  }
  const unsupported = unsupportedObjectKeys(value, keys);
  if (unsupported.length > 0) fail(
    "obligation_guarantee_selector_input_invalid",
    `${name}.${unsupported[0]} is not supported`, { name, key: unsupported[0] }
  );
  return value;
}

function string(value, name) {
  if (typeof value !== "string" || value.length === 0) fail(
    "obligation_guarantee_selector_input_invalid",
    `${name} must be a non-empty string`, { name }
  );
  return value;
}

function strings(value, name, { empty = true } = {}) {
  if (!Array.isArray(value) || !empty && value.length === 0 ||
      value.some((entry) => typeof entry !== "string" || entry.length === 0) ||
      new Set(value).size !== value.length) fail(
    "obligation_guarantee_selector_input_invalid",
    `${name} must be an exact unique string population`, { name }
  );
  return [...value].sort(compareCodeUnits);
}

function canonicalStrings(value, name) {
  const normalized = strings(value, name);
  if (normalized.some((entry, index) => entry !== value[index])) fail(
    "obligation_guarantee_selector_input_invalid",
    `${name} must be in canonical code-unit order`, { name }
  );
  return normalized;
}

function digest(value, name) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) fail(
    "obligation_guarantee_selector_input_invalid",
    `${name} must be a lowercase SHA-256 digest`, { name }
  );
  return value;
}

function admittedPackSnapshot(value, name) {
  const field = `${name}.pack_snapshot`;
  try {
    assertAdmittedProofPackSnapshot(value);
  } catch (error) {
    if (!(error instanceof AdmittedProofPackError)) throw error;
    fail(
      "obligation_guarantee_selector_pack_snapshot_unrecognized",
      `${field} must be the exact immutable snapshot returned by the admitted-pack loader`,
      { name, cause: error.code }
    );
  }
  const profile = value.profile;
  const admission = value.admission;
  const catalogEntry = value.catalog_entry;
  for (const [artifact, label] of [
    [profile, "profile"], [admission, "admission"], [catalogEntry, "catalog_entry"]
  ]) if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) fail(
    "obligation_guarantee_selector_artifact_identity_mismatch",
    `${field}.${label} must be an admitted artifact object`, { name, artifact: label }
  );
  const profileId = string(profile.profile_id, `${field}.profile.profile_id`);
  const profileVersion = string(
    profile.profile_version, `${field}.profile.profile_version`
  );
  if (admission.profile_id !== profileId ||
      admission.profile_version !== profileVersion ||
      catalogEntry.profile_id !== profileId ||
      catalogEntry.profile_version !== profileVersion) fail(
    "obligation_guarantee_selector_artifact_identity_mismatch",
    `${field} profile, admission, and catalog identities must match exactly`,
    { profile_id: profileId, profile_version: profileVersion }
  );
  const admissionVersion = value.admission_version;
  if (![1, 2].includes(admissionVersion) ||
      Object.hasOwn(admission, "exact_binding") !== (admissionVersion === 2)) fail(
    "obligation_guarantee_selector_admission_version_conflict",
    `${field} admission version and its exact-binding property must agree`,
    { profile_id: profileId, admission_version: admissionVersion ?? null }
  );
  const applicability = value.component_exclusion_applicability;
  const applicabilityDigest = value.component_exclusion_applicability_digest;
  if ((applicability === null) !== (applicabilityDigest === null)) fail(
    "obligation_guarantee_selector_artifact_identity_mismatch",
    `${field} applicability artifact and digest must be present together`,
    { profile_id: profileId }
  );
  return {
    profile,
    admission,
    profileId,
    profileVersion,
    admissionVersion,
    profileDigest: string(value.profile_digest, `${field}.profile_digest`),
    admissionDigest: string(value.admission_digest, `${field}.admission_digest`),
    exactBindingDeclarationDigest: admissionVersion === 2
      ? string(value.exact_binding_declaration_digest,
        `${field}.exact_binding_declaration_digest`) : null,
    exactBindingCertificationDigest: admissionVersion === 2
      ? string(value.exact_binding_certification_digest,
        `${field}.exact_binding_certification_digest`) : null,
    componentExclusionApplicability: applicability,
    componentExclusionApplicabilityDigest: applicabilityDigest === null ? null
      : digest(applicabilityDigest,
        `${field}.component_exclusion_applicability_digest`)
  };
}

function patternDefinitions(profile, name) {
  const definitions = [];
  for (const kind of OBLIGATION_GUARANTEE_SELECTOR_KINDS) {
    const field = SELECTOR_FIELDS[kind];
    const patterns = profile[field] ?? [];
    if (!Array.isArray(patterns)) fail(
      "obligation_guarantee_selector_profile_invalid",
      `${name}.pack_snapshot.profile.${field} must be an array`
    );
    for (const [index, pattern] of patterns.entries()) {
      const componentId = string(pattern?.pattern_id,
        `${name}.pack_snapshot.profile.${field}[${index}].pattern_id`);
      const stage = string(pattern?.required_by_stage,
        `${name}.pack_snapshot.profile.${field}[${index}].required_by_stage`);
      if (!["pre_dispatch", "post_delivery"].includes(stage) ||
          !profile.evaluation_stages?.includes(stage)) fail(
        "obligation_guarantee_selector_stage_invalid",
        "component stage must be supplied by the exact profile version",
        { kind, component_id: componentId, evaluation_stage: stage }
      );
      definitions.push({ kind, componentId, stage });
    }
  }
  const identities = definitions.map(({ kind, componentId }) => `${kind}\0${componentId}`);
  if (new Set(identities).size !== identities.length) fail(
    "obligation_guarantee_selector_component_duplicate",
    "the exact profile contains duplicate selector component identities"
  );
  return definitions;
}

function assessmentResults(assessment, snapshot, name) {
  if (assessment === null) return { stage: null, results: new Map() };
  try {
    assertVerificationProfileV1Result(assessment);
  } catch (error) {
    if (!(error instanceof StableVerificationError)) throw error;
    fail(
      "obligation_guarantee_selector_assessment_unrecognized",
      `${name}.assessment must be the exact package-minted verification-profile result`,
      { name, cause: error.code }
    );
  }
  if (assessment.result_version !== PROFILE_EVALUATION_RESULT_VERSION ||
      assessment.profile?.profile_id !== snapshot.profileId ||
      assessment.profile?.profile_version !== snapshot.profileVersion ||
      !Array.isArray(assessment.pattern_results)) fail(
    "obligation_guarantee_selector_assessment_invalid",
    `${name}.assessment must be one frozen ${PROFILE_EVALUATION_RESULT_VERSION} artifact for the exact profile`,
    { name, profile_id: snapshot.profileId }
  );
  if (assessment.admission?.profile_digest !== snapshot.profileDigest) fail(
    "obligation_guarantee_selector_assessment_binding_mismatch",
    `${name}.assessment must carry the exact admitted profile digest`,
    { name, profile_id: snapshot.profileId }
  );
  const results = new Map();
  for (const [index, result] of assessment.pattern_results.entries()) {
    const kind = string(result?.pattern_kind,
      `${name}.assessment.pattern_results[${index}].pattern_kind`);
    const componentId = string(result?.pattern_id,
      `${name}.assessment.pattern_results[${index}].pattern_id`);
    if (kind === "binding_constraint") continue;
    if (!OBLIGATION_GUARANTEE_SELECTOR_KINDS.includes(kind)) fail(
      "obligation_guarantee_selector_assessment_invalid",
      "assessment contains an unsupported pattern-result kind", { kind }
    );
    const key = `${kind}\0${componentId}`;
    if (results.has(key)) fail(
      "obligation_guarantee_selector_result_duplicate",
      "assessment pattern results must be an exact unique population", { key }
    );
    results.set(key, {
      status: string(result.status,
        `${name}.assessment.pattern_results[${index}].status`),
      matchedNodeIds: strings(result.matched_ids,
        `${name}.assessment.pattern_results[${index}].matched_ids`)
    });
  }
  return {
    stage: string(assessment.evaluation_stage, `${name}.assessment.evaluation_stage`),
    results
  };
}

function exactBindingStatus(result, snapshot, name, packId) {
  if (snapshot.admissionVersion === 1) {
    if (result !== null) fail(
      "obligation_guarantee_selector_exact_binding_artifact_mismatch",
      "v1 admissions require a null exact-binding artifact", { pack_id: packId }
    );
    return "not_applicable";
  }
  if (result === null) return "not_assessed";
  try {
    assertCapturedExactBindingResult(result);
  } catch (error) {
    if (!(error instanceof ExactBindingError)) throw error;
    fail(
      "obligation_guarantee_selector_exact_binding_artifact_unrecognized",
      `${name}.exact_binding must be the exact package-minted captured result`,
      { name, pack_id: packId, cause: error.code }
    );
  }
  const context = result.context;
  const expected = {
    profile_digest: snapshot.profileDigest,
    admission_digest: snapshot.admissionDigest,
    exact_binding_declaration_digest: snapshot.exactBindingDeclarationDigest,
    exact_binding_certification_digest: snapshot.exactBindingCertificationDigest
  };
  const mismatched = Object.entries(expected).filter(
    ([field, value]) => context?.[field] !== value
  ).map(([field]) => field);
  if (mismatched.length > 0) fail(
    "obligation_guarantee_selector_exact_binding_binding_mismatch",
    `${name}.exact_binding was captured for another admitted pack`,
    { name, pack_id: packId, mismatched_fields: mismatched }
  );
  return result.provenance?.capture_verified === true &&
    result.satisfaction === "satisfied" ? "proven" : "not_proven";
}

function authenticatedApplicability(value, snapshot, definitions, exclusions, name) {
  if (value === null) {
    if (snapshot.componentExclusionApplicability !== null) fail(
      "obligation_guarantee_selector_artifact_identity_mismatch",
      `${name} omitted the admitted component applicability projection`
    );
    return null;
  }
  const projectionName = `${name}.authenticated_component_exclusion_applicability`;
  object(value, [
    "projection_version", "assessment_cycle_digest", "profile_id",
    "profile_version", "profile_digest", "admission_digest",
    "component_exclusion_applicability_digest", "source_digests", "components"
  ], projectionName);
  if (value.projection_version !==
      "controlled-contract-assessment-component-exclusion-applicability.v1") fail(
    "obligation_guarantee_selector_input_invalid",
    `${projectionName}.projection_version is invalid`
  );
  digest(value.assessment_cycle_digest, `${projectionName}.assessment_cycle_digest`);
  const mismatches = [];
  const expect = (field, expected, actual) => {
    if (expected !== actual) mismatches.push({ field, expected, actual });
  };
  expect("profile_id", snapshot.profileId, value.profile_id);
  expect("profile_version", snapshot.profileVersion, value.profile_version);
  expect("profile_digest", snapshot.profileDigest,
    digest(value.profile_digest, `${projectionName}.profile_digest`));
  expect("admission_digest", snapshot.admissionDigest,
    digest(value.admission_digest, `${projectionName}.admission_digest`));
  expect("component_exclusion_applicability_digest",
    snapshot.componentExclusionApplicabilityDigest,
    digest(value.component_exclusion_applicability_digest,
      `${projectionName}.component_exclusion_applicability_digest`));
  const sourceDigests = object(value.source_digests, [
    "profile", "admission", "guarantee", "adequacy_declaration",
    "adequacy_result", "evaluation_input", "exact_binding_sources",
    "exact_binding_declaration", "exact_binding_certification",
    "component_exclusion_applicability"
  ], `${projectionName}.source_digests`);
  for (const [field, sourceDigest] of Object.entries(sourceDigests)) {
    if (sourceDigest !== null) digest(sourceDigest,
      `${projectionName}.source_digests.${field}`);
  }
  expect("source_digests.profile", snapshot.profileDigest, sourceDigests.profile);
  expect("source_digests.admission", snapshot.admissionDigest,
    sourceDigests.admission);
  expect("source_digests.component_exclusion_applicability",
    snapshot.componentExclusionApplicabilityDigest,
    sourceDigests.component_exclusion_applicability);
  if (!Array.isArray(value.components)) fail(
    "obligation_guarantee_selector_input_invalid",
    `${projectionName}.components must be an array`
  );
  if (snapshot.componentExclusionApplicability === null ||
      JSON.stringify(value.components) !==
        JSON.stringify(snapshot.componentExclusionApplicability.components)) {
    mismatches.push({ field: "components" });
  }
  const applicableByComponent = new Map();
  for (const [index, component] of value.components.entries()) {
    const componentName = `${projectionName}.components[${index}]`;
    object(component, ["selector", "evaluation_stage", "exclusion_ids",
      "applicable_exclusion_ids"], componentName);
    object(component.selector, ["kind", "component_id"],
      `${componentName}.selector`);
    const kind = string(component.selector.kind, `${componentName}.selector.kind`);
    const componentId = string(component.selector.component_id,
      `${componentName}.selector.component_id`);
    const key = `${kind}\0${componentId}`;
    const definition = definitions.find((candidate) =>
      candidate.kind === kind && candidate.componentId === componentId
    );
    if (!definition || definition.stage !== component.evaluation_stage ||
        applicableByComponent.has(key)) mismatches.push({
      field: "components", component: key
    });
    const exclusionIds = canonicalStrings(component.exclusion_ids,
      `${componentName}.exclusion_ids`);
    const applicableIds = canonicalStrings(component.applicable_exclusion_ids,
      `${componentName}.applicable_exclusion_ids`);
    if (exclusionIds.length !== exclusions.length ||
        exclusionIds.some((entry, offset) => entry !== exclusions[offset]) ||
        applicableIds.some((entry) => !exclusionIds.includes(entry))) {
      mismatches.push({ field: "components.exclusion_ids", component: key });
    }
    applicableByComponent.set(key, applicableIds.length > 0);
  }
  const keys = [...applicableByComponent.keys()];
  const sortedKeys = [...keys].sort(compareCodeUnits);
  if (keys.some((entry, index) => entry !== sortedKeys[index])) {
    mismatches.push({ field: "components" });
  }
  if (mismatches.length > 0) fail(
    "obligation_guarantee_selector_artifact_identity_mismatch",
    `${projectionName} is not bound to the exact admitted snapshot`, { mismatches }
  );
  return applicableByComponent;
}

function normalizedPack(pack, index, { recognizedAssessment = false } = {}) {
  const name = `packs[${index}]`;
  if (!recognizedAssessment &&
      Object.hasOwn(pack ?? {}, "authenticated_component_exclusion_applicability")) {
    fail("obligation_guarantee_selector_assessment_unrecognized",
      "authenticated applicability requires its recognized multi-pack assessment");
  }
  object(pack, [
    "pack_id", "requested_intents", "pack_snapshot", "assessment",
    "evaluation_input_present", "profile_discrimination", "exact_binding",
    ...(recognizedAssessment
      ? ["authenticated_component_exclusion_applicability"] : [])
  ], name);
  const packId = string(pack.pack_id, `${name}.pack_id`);
  const requestedIntents = strings(pack.requested_intents,
    `${name}.requested_intents`);
  if (typeof pack.evaluation_input_present !== "boolean") fail(
    "obligation_guarantee_selector_input_invalid",
    `${name}.evaluation_input_present must be a boolean`
  );
  if (!["proven", "not_proven", "not_assessed"].includes(
    pack.profile_discrimination
  )) fail("obligation_guarantee_selector_input_invalid",
    `${name}.profile_discrimination is invalid`);
  const snapshot = admittedPackSnapshot(pack.pack_snapshot, name);
  const exclusions = strings(snapshot.admission.explicit_exclusions,
    `${name}.pack_snapshot.admission.explicit_exclusions`);

  const exactBindingRequired = snapshot.admissionVersion === 2;
  const exactBinding = exactBindingStatus(pack.exact_binding, snapshot, name, packId);
  const assessment = assessmentResults(pack.assessment, snapshot, name);
  const definitions = patternDefinitions(snapshot.profile, name);
  const authenticated = recognizedAssessment
    ? authenticatedApplicability(
      pack.authenticated_component_exclusion_applicability,
      snapshot, definitions, exclusions, name
    ) : null;
  const definitionKeys = new Set(definitions.map(
    ({ kind, componentId }) => `${kind}\0${componentId}`
  ));
  for (const key of assessment.results.keys()) if (!definitionKeys.has(key)) fail(
    "obligation_guarantee_selector_component_absent",
    "assessment names a component absent from the exact profile version", { key }
  );
  const components = definitions.map(({ kind, componentId, stage }) => {
    const key = `${kind}\0${componentId}`;
    const result = assessment.results.get(key) ?? null;
    const applicableExclusion = recognizedAssessment
      ? authenticated?.get(key) ?? null
      : exclusions.length === 0 ? false : null;
    const component = {
      pack_id: packId,
      profile_id: snapshot.profileId,
      profile_version: snapshot.profileVersion,
      requested_intents: requestedIntents,
      selector: { kind, component_id: componentId },
      evaluation_stage: stage,
      assessed_evaluation_stage: assessment.stage,
      guarantee_applicability_proven: applicableExclusion === false,
      applicable_exclusion: applicableExclusion,
      matched_node_ids: result?.matchedNodeIds ?? null,
      satisfaction: result?.status ?? null,
      evaluation_input_present: pack.evaluation_input_present,
      pack_evaluated: pack.assessment !== null,
      profile_discrimination: pack.profile_discrimination,
      exact_binding_required: exactBindingRequired,
      exact_binding: exactBinding
    };
    COMPONENT_APPLICABILITY_MODES.set(component,
      recognizedAssessment ? authenticated === null ? "missing" : "authenticated"
        : "legacy");
    return component;
  });
  return { pack_id: packId, components };
}

function buildObligationGuaranteeSelectorIndex(input) {
  object(input, ["assessment", "packs"], "input");
  if (input.assessment !== undefined && input.packs !== undefined ||
      input.assessment === undefined && input.packs === undefined) fail(
    "obligation_guarantee_selector_input_invalid",
    "input must select exactly one recognized assessment or pack population"
  );
  let inputPacks = input.packs;
  const recognizedAssessment = input.assessment !== undefined;
  if (recognizedAssessment) {
    try {
      inputPacks = recognizedObligationGuaranteeSelectorPacks(input.assessment);
    } catch (error) {
      fail("obligation_guarantee_selector_assessment_unrecognized",
        "selector construction requires a recognized multi-pack assessment",
        { cause: error.code ?? null });
    }
  }
  if (!Array.isArray(inputPacks)) fail(
    "obligation_guarantee_selector_input_invalid", "input.packs must be an array"
  );
  const packs = inputPacks.map((pack, index) => normalizedPack(pack, index, {
    recognizedAssessment
  }));
  if (new Set(packs.map(({ pack_id: id }) => id)).size !== packs.length) fail(
    "obligation_guarantee_selector_pack_duplicate",
    "selector index packs must have unique stable identities"
  );
  const result = deepFreeze({
    version: OBLIGATION_GUARANTEE_SELECTOR_INDEX_VERSION,
    pack_ids: packs.map(({ pack_id: id }) => id).sort(compareCodeUnits),
    components: packs.flatMap(({ components }) => components).sort((left, right) =>
      compareCodeUnits(left.pack_id, right.pack_id) ||
      compareCodeUnits(left.selector.kind, right.selector.kind) ||
      compareCodeUnits(left.selector.component_id, right.selector.component_id)
    )
  });
  SELECTOR_INDEXES.add(result);
  return result;
}

function mappingShape(mapping, nodeIds) {
  object(mapping, ["kind", "pack_id", "requested_intent", "profile_id",
    "profile_version", "selector", "evaluation_stage"], "mapping");
  object(mapping.selector, ["kind", "component_id"], "mapping.selector");
  if (mapping.kind !== "pack_mapping" ||
      !OBLIGATION_GUARANTEE_SELECTOR_KINDS.includes(mapping.selector.kind)) fail(
    "obligation_guarantee_selector_mapping_invalid",
    "mapping must carry one typed package-derived selector"
  );
  return {
    packId: string(mapping.pack_id, "mapping.pack_id"),
    profileId: string(mapping.profile_id, "mapping.profile_id"),
    profileVersion: string(mapping.profile_version, "mapping.profile_version"),
    requestedIntent: string(mapping.requested_intent, "mapping.requested_intent"),
    stage: string(mapping.evaluation_stage, "mapping.evaluation_stage"),
    kind: mapping.selector.kind,
    componentId: string(mapping.selector.component_id,
      "mapping.selector.component_id"),
    nodeIds: strings(nodeIds, "nodeIds", { empty: false })
  };
}

function resolveObligationGuaranteeSelector(input) {
  object(input, ["index", "mapping", "nodeIds"], "input");
  const { index, mapping, nodeIds } = input;
  if (!SELECTOR_INDEXES.has(index)) fail(
    "obligation_guarantee_selector_index_unrecognized",
    "selector resolution requires the exact package-derived index"
  );
  const value = mappingShape(mapping, nodeIds);
  const componentsForPack = index.components.filter(
    ({ pack_id: packId }) => packId === value.packId
  );
  const component = componentsForPack.find(({ selector }) =>
    selector.kind === value.kind && selector.component_id === value.componentId
  );
  let status = "compatible";
  let reason = null;
  if (!component) [status, reason] = ["incompatible", "unknown_selector"];
  else if (component.profile_id !== value.profileId ||
      component.profile_version !== value.profileVersion) {
    [status, reason] = ["incompatible", "profile_identity_mismatch"];
  } else if (!component.requested_intents.includes(value.requestedIntent)) {
    [status, reason] = ["incompatible", "incompatible_intent"];
  } else if (component.evaluation_stage !== value.stage ||
      component.assessed_evaluation_stage !== null &&
      component.assessed_evaluation_stage !== value.stage) {
    [status, reason] = ["incompatible", "stage_mismatch"];
  } else if (COMPONENT_APPLICABILITY_MODES.get(component) === "authenticated" &&
      component.applicable_exclusion !== false) {
    [status, reason] = ["incompatible",
      component.applicable_exclusion === true
        ? "applicable_exclusion" : "exclusion_applicability_unknown"];
  } else if (COMPONENT_APPLICABILITY_MODES.get(component) === "missing") {
    [status, reason] = ["incompatible", "exclusion_applicability_unknown"];
  } else if (!component.evaluation_input_present) {
    [status, reason] = ["mapped_input_missing", "mapped_input_missing"];
  } else if (!component.pack_evaluated || component.matched_node_ids === null) {
    [status, reason] = ["mapped_pack_not_evaluated", "mapped_pack_not_evaluated"];
  } else if (value.nodeIds.some((id) => !component.matched_node_ids.includes(id))) {
    [status, reason] = ["incompatible", "unmatched_node"];
  } else if (component.satisfaction !== "satisfied") {
    [status, reason] = ["incompatible", "component_not_satisfied"];
  } else if (component.exact_binding_required && component.exact_binding !== "proven") {
    [status, reason] = ["profile_proven_exact_binding_missing",
      "required_exact_binding_not_proven"];
  } else if (!component.guarantee_applicability_proven) {
    [status, reason] = ["incompatible", "component_applicability_unproven"];
  }
  return deepFreeze({
    status,
    reason,
    component: component ? structuredClone(component) : null
  });
}

export {
  OBLIGATION_GUARANTEE_SELECTOR_INDEX_VERSION,
  OBLIGATION_GUARANTEE_SELECTOR_KINDS,
  ObligationGuaranteeSelectorError,
  RESOLUTION_STATUSES as OBLIGATION_GUARANTEE_SELECTOR_RESOLUTION_STATUSES,
  buildObligationGuaranteeSelectorIndex,
  resolveObligationGuaranteeSelector
};
