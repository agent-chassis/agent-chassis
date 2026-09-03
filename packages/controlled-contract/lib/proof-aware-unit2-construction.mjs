import { createHash } from "node:crypto";

import {
  canonicalJsonBytes,
  canonicalValue,
  commitment,
  compareCodeUnits,
  domainSeparatedDigest
} from "./proof-aware-digest.mjs";
import {
  DOMAINS as UNIT1_DOMAINS
} from "./projected-selection-constants.mjs";
import {
  validateAssessmentPackCycle
} from "./projected-selection-cycle.mjs";
import {
  validateProjectedSelectionSupplement
} from "./projected-selection-supplement.mjs";
import {
  IMPLEMENTATION_DESCRIPTOR,
  IMPLEMENTATION_IDENTITY,
  MANDATORY_AUTHORITY_EXCLUSIONS,
  PLANNING_POLICY,
  PLANNING_POLICY_IDENTITY,
  resolveUnit2Limits,
  validateImplementationIdentity,
  validatePackagePolicy
} from "./proof-aware-planning-policy.mjs";
import {
  createResolvedCarrier,
  resolvedCarrierDigest
} from "./proof-aware-planning-carrier.mjs";
import {
  anonymizeResolvedCarrier
} from "./proof-aware-anonymization.mjs";

const RESULT_VERSION =
  "controlled-contract-proof-aware-unit2-construction-result.experimental.v2";
const CONSTRUCTION_CYCLE_DOMAIN = "controlled-contract:proof-aware-input-cycle:v2";
const SHA256 = /^[a-f0-9]{64}$/u;
const FACT_ATTRIBUTES = Object.freeze({
  access_mode: null, join_kind: null, cardinality: null, endpoint_role: null,
  branch_state: null, operand_kind: null, scope_role: null, member_role: null,
  associated_role: null, proposition_position_kind: null,
  participation_role: null, occurrence_role: null, association_status: null
});

class Unit2Failure extends Error {
  constructor(status, code, stage, detail = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.stage = stage;
    this.detail = detail;
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(structuredClone(value));
}

function sameCanonical(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function authority(kind = "non_authoritative_unit2_construction_result") {
  return {
    kind,
    authoritative: false,
    mandatory_exclusions: MANDATORY_AUTHORITY_EXCLUSIONS
  };
}

function observedCommitments(input) {
  const observed = [];
  const add = (artifactKind, value) => {
    if (SHA256.test(value?.digest ?? "")) observed.push({
      artifact_kind: artifactKind, digest: value.digest
    });
  };
  add("contract", input?.unit1?.root_cycle?.contract);
  add("compiled_proof_plan", input?.unit1?.root_cycle?.compiled_proof_plan);
  add("assessment_manifest", input?.unit1?.root_cycle?.assessment_manifest);
  add("planning_policy", input?.planning_policy_identity);
  add("planning_implementation", input?.planning_implementation_identity);
  for (const cycle of input?.unit1?.assessment_pack_cycles ?? []) {
    add("per_pack_assessment", cycle?.cycle_binding?.per_pack_assessment);
    add("projected_graph", cycle?.cycle_binding?.projected_graph);
  }
  return observed.sort((left, right) => compareCodeUnits(
    `${left.artifact_kind}:${left.digest}`, `${right.artifact_kind}:${right.digest}`
  ));
}

function failureResult(input, failure) {
  const expected = input?.unit1?.root_cycle?.proof_aware_input_cycle_digest;
  const result = {
    result_version: RESULT_VERSION,
    status: failure.status,
    authority: authority(),
    input_binding: {
      validation_stage: failure.stage,
      expected_unit1_cycle_digest: SHA256.test(expected ?? "") ? expected : null,
      available_commitments: observedCommitments(input)
    },
    failure: {
      code: failure.code,
      blocked_stage: failure.stage,
      partial_result_released: false,
      ...failure.detail
    },
    diagnostics: [{
      code: failure.code,
      classification: failure.status,
      subject_digests: observedCommitments(input).map(({ digest }) => digest)
    }]
  };
  return frozenClone(result);
}

function resourceFailure(unit, measured, policy) {
  return new Unit2Failure("resource_limit", policy.diagnostic_code,
    policy.blocked_stage, {
      unit: policy.unit,
      measured,
      limit: policy.limit,
      count_point: policy.count_point
    });
}

function requireCommitment(actual, expected, label) {
  if (!sameCanonical(actual, expected)) throw new Unit2Failure(
    "refused", "PA_DIGEST_MISMATCH", "input_validation", { artifact_kind: label }
  );
}

function commitmentFor(domain, value) {
  return commitment(domain, value);
}

function validateUnit1Root(unit1) {
  const root = unit1.root_cycle;
  if (root?.cycle_version !==
      "controlled-contract-proof-aware-input-cycle.experimental.v2") {
    throw new Unit2Failure("unsupported_input", "PA_UNSUPPORTED_CARRIER_VERSION",
      "input_census", { input_version: root?.cycle_version ?? "missing" });
  }
  if (root.cycle_status !== "supplement_handoff" ||
      root.unit_boundary !== "unit1_supplement_handoff" ||
      root.planning_policy !== null || root.planning_implementation !== null) {
    throw new Unit2Failure("refused", "PA_SAME_CYCLE_MISMATCH",
      "input_validation", { artifact_kind: "unit1_root_cycle" });
  }
  const payload = {
    contract: root.contract,
    compiled_proof_plan: root.compiled_proof_plan,
    assessment_identity: root.assessment_identity,
    assessment_manifest: root.assessment_manifest,
    supplement_census_digest: root.supplement_census_digest,
    planning_pack_census: root.planning_pack_census,
    planning_policy: null,
    planning_implementation: null,
    unit_boundary: "unit1_supplement_handoff"
  };
  if (domainSeparatedDigest(UNIT1_DOMAINS.proofAwareInputCycle, payload) !==
      root.proof_aware_input_cycle_digest) throw new Unit2Failure(
    "refused", "PA_DIGEST_MISMATCH", "input_validation",
    { artifact_kind: "unit1_root_cycle" }
  );
}

function validateSupplementCensus(unit1) {
  const census = unit1.supplement_census;
  const cycles = unit1.assessment_pack_cycles;
  const planning = unit1.planning_pack_cycles;
  if (!Array.isArray(cycles) || !Array.isArray(planning) ||
      census?.complete !== true || census.entry_count !== census.entries?.length ||
      census.entry_count !== cycles.length || census.entry_count !== planning.length ||
      unit1.root_cycle.planning_pack_census?.entry_count !== cycles.length ||
      unit1.root_cycle.planning_pack_census.entries?.length !== cycles.length) {
    throw new Unit2Failure("refused", "PA_INCOMPLETE_CENSUS", "input_census");
  }
  const payload = { entry_count: census.entry_count, entries: census.entries };
  if (domainSeparatedDigest(UNIT1_DOMAINS.supplementCensus, payload) !==
      census.census_digest || census.census_digest !==
      unit1.root_cycle.supplement_census_digest) throw new Unit2Failure(
    "refused", "PA_DIGEST_MISMATCH", "input_validation",
    { artifact_kind: "supplement_census" }
  );
  const packIds = new Set();
  const cycleIds = new Set();
  for (let ordinal = 0; ordinal < cycles.length; ordinal += 1) {
    const cycle = cycles[ordinal];
    const entry = census.entries[ordinal];
    const plan = planning[ordinal];
    const rootEntry = unit1.root_cycle.planning_pack_census.entries[ordinal];
    if (entry.ordinal !== ordinal || rootEntry.ordinal !== ordinal ||
        cycle.payload?.ordinal !== ordinal ||
        entry.assessment_pack_cycle_digest !== cycle.digest ||
        plan.assessment_pack_cycle_digest !== cycle.digest ||
        rootEntry.assessment_pack_cycle_digest !== cycle.digest ||
        rootEntry.planning_pack_cycle_digest !== plan.planning_pack_cycle_digest) {
      throw new Unit2Failure("refused", "PA_REORDERED_CENSUS", "input_census",
        { ordinal });
    }
    if (packIds.has(entry.pack_instance_id) || cycleIds.has(cycle.digest) ||
        entry.pack_instance_id !== cycle.payload.pack_instance_id) {
      throw new Unit2Failure("refused", "PA_DUPLICATE_COMMITMENT", "input_census",
        { ordinal });
    }
    packIds.add(entry.pack_instance_id);
    cycleIds.add(cycle.digest);
    if (!validateAssessmentPackCycle(cycle)) throw new Unit2Failure(
      "refused", "PA_DIGEST_MISMATCH", "input_validation",
      { artifact_kind: "assessment_pack_cycle", ordinal }
    );
    if (entry.requirement !== "required") throw new Unit2Failure(
      "unsupported_input", "PA_ZERO_PACK_OR_NON_PROJECTED_ADAPTER_NOT_IMPLEMENTED",
      "input_validation", { ordinal }
    );
    if (entry.result?.status !== "success") throw new Unit2Failure(
      "missing_lossless_fact", "PA_MISSING_PROJECTED_SELECTION_SUPPLEMENT",
      "input_validation", { ordinal, supplement_status: entry.result?.status ?? "missing" }
    );
    const supplementValidation = validateProjectedSelectionSupplement(entry.result, {
      assessmentPackCycle: cycle
    });
    if (!supplementValidation.valid ||
        entry.result.cycle_binding.assessment_pack_cycle_digest !== cycle.digest) {
      throw new Unit2Failure("refused", "PA_CROSS_CYCLE_SPLICE",
        "input_validation", { ordinal });
    }
    const planningPayload = {
      assessment_pack_cycle_digest: cycle.digest,
      projected_selection: {
        requirement: "required", status: "success",
        supplement_digest: entry.result.supplement_identity.digest
      }
    };
    if (domainSeparatedDigest(UNIT1_DOMAINS.planningPackCycle, planningPayload) !==
        plan.planning_pack_cycle_digest) throw new Unit2Failure(
      "refused", "PA_CROSS_CYCLE_SPLICE", "input_validation", { ordinal }
    );
  }
}

function validateManifestFiles(manifest, files) {
  if (!Array.isArray(manifest?.files) || !Array.isArray(files) ||
      manifest.files.length !== files.length) throw new Unit2Failure(
    "refused", "PA_INCOMPLETE_MANIFEST", "input_census"
  );
  const names = new Set();
  for (let ordinal = 0; ordinal < files.length; ordinal += 1) {
    const supplied = files[ordinal];
    const expected = manifest.files[ordinal];
    if (supplied.ordinal !== ordinal || supplied.locator !== expected.name ||
        names.has(supplied.locator)) throw new Unit2Failure(
      "refused", ordinal === supplied.ordinal ? "PA_DUPLICATE_COMMITMENT" :
        "PA_REORDERED_CENSUS", "input_census", { ordinal }
    );
    if (typeof supplied.exact_bytes !== "string" ||
        Buffer.byteLength(supplied.exact_bytes) !== expected.bytes ||
        sha256Bytes(supplied.exact_bytes) !== expected.sha256) throw new Unit2Failure(
      "refused", "PA_DIGEST_MISMATCH", "input_validation",
      { artifact_kind: supplied.artifact_kind, ordinal }
    );
    names.add(supplied.locator);
  }
}

function validateAssessmentArtifacts(values) {
  const aggregate = values.proof_packs_assessment;
  if (!exactKeys(aggregate, ["admitted_profile", "proof_pack_admission"]) ||
      !sameCanonical(aggregate.admitted_profile,
        values.admitted_profile_assessment) ||
      !sameCanonical(aggregate.proof_pack_admission,
        values.proof_pack_admission)) {
    throw new Unit2Failure("refused", "PA_ASSESSMENT_AGGREGATE_MISMATCH",
      "input_validation", { artifact_kind: "proof_packs_assessment" });
  }
  const expectedValues = {
    assessment_index: values.assessment_index,
    structural_assessment: values.structural_assessment,
    admitted_profile_assessment: values.admitted_profile_assessment,
    proof_pack_admission: values.proof_pack_admission,
    exact_binding_assessment: values.exact_binding_assessment
  };
  if (Object.values(expectedValues).some((value) =>
    value === null || typeof value !== "object" || Array.isArray(value))) {
    throw new Unit2Failure("missing_lossless_fact",
      "PA_MISSING_ASSESSMENT_ARTIFACT", "input_validation");
  }
  const roleByCanonicalValue = new Map();
  for (const [role, value] of Object.entries(expectedValues)) {
    const canonical = JSON.stringify(canonicalValue(value));
    if (roleByCanonicalValue.has(canonical)) throw new Unit2Failure(
      "refused", "PA_CONFLICTING_ASSESSMENT_ARTIFACTS", "input_validation",
      { artifact_kind: role }
    );
    roleByCanonicalValue.set(canonical, role);
  }
  const observedRoles = new Set();
  for (const file of values.assessment_files) {
    let parsed;
    try {
      parsed = JSON.parse(file.exact_bytes);
    } catch {
      parsed = undefined;
    }
    const derivedRole = parsed === undefined ? "informational_rendering" :
      roleByCanonicalValue.get(JSON.stringify(canonicalValue(parsed))) ??
        "informational_rendering";
    if (file.artifact_kind !== derivedRole) throw new Unit2Failure(
      "refused", "PA_ASSESSMENT_ARTIFACT_ROLE_MISMATCH", "input_validation",
      { artifact_kind: file.artifact_kind, ordinal: file.ordinal }
    );
    if (derivedRole === "informational_rendering") continue;
    if (observedRoles.has(derivedRole)) throw new Unit2Failure(
      "refused", "PA_DUPLICATE_ASSESSMENT_ROLE", "input_validation",
      { artifact_kind: derivedRole, ordinal: file.ordinal }
    );
    observedRoles.add(derivedRole);
  }
  for (const role of Object.keys(expectedValues)) if (!observedRoles.has(role)) {
    throw new Unit2Failure("refused", "PA_MISSING_ASSESSMENT_ARTIFACT",
      "input_validation", { artifact_kind: role });
  }
}

function validateAuthoritativeValues(input) {
  const values = input.authoritative_values;
  const root = input.unit1.root_cycle;
  if (values === null || typeof values !== "object") throw new Unit2Failure(
    "missing_lossless_fact", "PA_MISSING_AUTHORITATIVE_INPUT", "input_validation"
  );
  requireCommitment(commitmentFor("controlled-contract:contract-identity:v1",
    values.contract), root.contract, "contract");
  requireCommitment(commitmentFor("controlled-contract:compiled-proof-plan:v1",
    values.compiled_proof_plan), root.compiled_proof_plan, "compiled_proof_plan");
  requireCommitment(commitmentFor("controlled-contract:assessment-manifest:v1",
    values.assessment_manifest), root.assessment_manifest, "assessment_manifest");
  if (values.assessment_index?.assessment_identity !== root.assessment_identity) {
    throw new Unit2Failure("refused", "PA_DIGEST_MISMATCH", "input_validation",
      { artifact_kind: "assessment_index" });
  }
  validateManifestFiles(values.assessment_manifest, values.assessment_files);
  validateAssessmentArtifacts(values);
  if (!Array.isArray(values.packs) ||
      values.packs.length !== input.unit1.assessment_pack_cycles.length) {
    throw new Unit2Failure("refused", "PA_INCOMPLETE_PACK_CENSUS", "input_census");
  }
  for (let ordinal = 0; ordinal < values.packs.length; ordinal += 1) {
    const pack = values.packs[ordinal];
    const cycle = input.unit1.assessment_pack_cycles[ordinal];
    const binding = cycle.cycle_binding;
    if (pack.ordinal !== ordinal || pack.pack_instance_id !== cycle.payload.pack_instance_id) {
      throw new Unit2Failure("refused", "PA_REORDERED_CENSUS", "input_census",
        { ordinal });
    }
    const pairs = [
      ["pack_identity", "controlled-contract:pack-identity:v1", "pack_identity"],
      ["profile_identity", "controlled-contract:profile-identity:v1", "profile_identity"],
      ["guarantee_identity", "controlled-contract:guarantee-identity:v1", "guarantee_identity"],
      ["admission_identity", "controlled-contract:admission-identity:v1", "admission_identity"],
      ["evaluation_input", "controlled-contract:evaluation-input:v1", "evaluation_input"],
      ["per_pack_assessment", "controlled-contract:per-pack-assessment:v1", "per_pack_assessment"],
      ["exact_binding_declaration", "controlled-contract:exact-binding-declaration:v1", "exact_binding_declaration"],
      ["exact_binding_result", "controlled-contract:exact-binding-result:v1", "exact_binding_result"],
      ["exact_capture_source_set", "controlled-contract:exact-capture-source-set:v1", "exact_capture_source_set"]
    ];
    for (const [field, domain, bindingField] of pairs) requireCommitment(
      commitmentFor(domain, pack[field]), binding[bindingField], field
    );
    const supplement = input.unit1.supplement_census.entries[ordinal].result;
    if (!sameCanonical(pack.projected_selection_supplement, supplement) ||
        !sameCanonical(pack.projected_graph, supplement.projected_graph)) {
      throw new Unit2Failure("refused", "PA_CROSS_CYCLE_SPLICE",
        "input_validation", { ordinal });
    }
    if (pack.binding_set_digest !== binding.binding_set_digest ||
        pack.assessment_pack_cycle_digest !== cycle.digest ||
        pack.adequacy_declaration_digest !==
          cycle.payload.adequacy_declaration_digest ||
        pack.adequacy_result_digest !== cycle.payload.adequacy_result_digest ||
        !sameCanonical(pack.profile_result, cycle.payload.profile_result) ||
        !sameCanonical(pack.exact_binding_certification,
          cycle.payload.exact_binding_certification) ||
        !sameCanonical(pack.selected_node_result,
          cycle.payload.selected_node_result) ||
        pack.exact_binding_result?.context?.context_sha256 !==
          cycle.payload.exact_context_digest ||
        cycle.payload.assessment_manifest_census?.entry_count !==
          values.assessment_manifest.files.length ||
        !sameCanonical(cycle.payload.assessment_manifest_census?.entries,
          values.assessment_manifest.files)) throw new Unit2Failure(
      "refused", "PA_SAME_CYCLE_MISMATCH", "input_validation", { ordinal }
    );
  }
}

function validateInput(input, limits) {
  if (input?.input_version ===
      "controlled-contract-anonymous-planning-input.experimental.v0.1") {
    throw new Unit2Failure("unsupported_input", "PA_V01_NOT_PROOF_AWARE",
      "input_census", { input_version: input.input_version });
  }
  if (input?.input_version !==
      "controlled-contract-proof-aware-unit2-input.experimental.v2") {
    throw new Unit2Failure("unsupported_input", "PA_UNSUPPORTED_CARRIER_VERSION",
      "input_census", { input_version: input?.input_version ?? "missing" });
  }
  const inputBytes = canonicalJsonBytes(input).byteLength;
  if (inputBytes > limits.verified_input_bytes.limit) {
    throw resourceFailure("verified_input_bytes", inputBytes,
      limits.verified_input_bytes);
  }
  if (!validatePackagePolicy(input.planning_policy,
    input.planning_policy_identity)) throw new Unit2Failure(
    "refused", "PA_POLICY_IDENTITY_MISMATCH", "input_validation"
  );
  if (!validateImplementationIdentity(input.planning_implementation,
    input.planning_implementation_identity)) throw new Unit2Failure(
    "refused", "PA_IMPLEMENTATION_IDENTITY_MISMATCH", "input_validation"
  );
  if (!sameCanonical(input.authority?.mandatory_exclusions,
      MANDATORY_AUTHORITY_EXCLUSIONS) || input.authority?.authoritative !== false) {
    throw new Unit2Failure("refused", "PA_AUTHORITY_EXCLUSION_INVALID",
      "input_validation");
  }
  validateUnit1Root(input.unit1);
  validateSupplementCensus(input.unit1);
  if (input.unit1.assessment_pack_cycles.length > limits.selected_packs.limit) {
    throw resourceFailure("selected_packs", input.unit1.assessment_pack_cycles.length,
      limits.selected_packs);
  }
  validateAuthoritativeValues(input);
  return inputBytes;
}

function attrs(overrides = {}) {
  return { ...FACT_ATTRIBUTES, ...overrides };
}

function participant(role, nodeId, position, overrides = {}, multiplicity = 1) {
  return {
    role, node_id: nodeId,
    position_path: Array.isArray(position) ? position : [position],
    multiplicity,
    attributes: attrs(overrides)
  };
}

function stateForSelection(status) {
  return ({ selected: "satisfied", inactive_branch: "inactive",
    not_satisfied: "not_proven", ambiguous: "ambiguous",
    not_applicable: "not_applicable" })[status] ?? "invalid";
}

function memberPositionClass(positionKind) {
  return positionKind === "operand" ? "reference_operand" : positionKind;
}

function facetsForKind(kind) {
  if (kind === "authored_behavior_component") return ["behavior_cohesion",
    "implementation_ownership"];
  if (["capture_source_set", "deterministic_transform",
    "exact_binding_requirement"].includes(kind)) return ["exact_capture_atomicity",
    "evidence_acquisition"];
  if (["profile_pattern", "falsifier", "iterated_occurrence",
    "projected_selection"].includes(kind)) return ["proof_atomicity",
    "verification_ownership"];
  if (kind === "resource") return ["evidence_acquisition"];
  if (kind === "planning_boundary") return ["authority_boundary"];
  return ["verification_ownership"];
}

function weightForKind(kind) {
  return {
    behavior: kind === "authored_behavior_component" ? 1 : 0,
    verification: ["obligation", "profile_pattern", "falsifier"].includes(kind) ? 1 : 0,
    capture: ["capture_source_set", "deterministic_transform",
      "exact_binding_requirement", "resource"].includes(kind) ? 1 : 0,
    serialization: 1
  };
}

function extractionBuilder(input, inputBytes) {
  const nodes = new Map();
  const edges = [];
  const incidences = [];
  const constraints = [];
  const unresolved = [];
  const addNode = ({ id, kind, subtype, state = "established", pack = null,
    branch = null, sourceDigest, sourceOrdinal = 0 }) => {
    if (!nodes.has(id)) nodes.set(id, {
      node_id: id, node_kind: kind, subtype, state,
      facets: facetsForKind(kind), pack_instance_id: pack,
      branch_scope_id: branch,
      provenance: { source_class: "canonical_unit1_handoff",
        source_digest: sourceDigest, source_ordinal: sourceOrdinal },
      weight: weightForKind(kind)
    });
    return id;
  };
  const derivation = (ruleId, sourceClass, sourceDigest, state) => ({
    rule_id: ruleId, source_class: sourceClass, source_digest: sourceDigest,
    state_precondition: state
  });
  const addEdge = ({ kind, source, target, state, rule, sourceClass, sourceDigest,
    effect, facet }) => edges.push({
    edge_id: `e:${edges.length}`, edge_kind: kind, source_node_id: source,
    target_node_id: target, state,
    derivation: derivation(rule, sourceClass, sourceDigest, state), effect, facet
  });
  const addIncidence = ({ kind, state, rule, sourceClass, sourceDigest, effect,
    facet, pack = null, branch = null, typed = {}, participants }) => {
    const id = `i:${incidences.length}`;
    incidences.push({ incidence_id: id, incidence_kind: kind, state,
      derivation: derivation(rule, sourceClass, sourceDigest, state), effect, facet,
      pack_instance_id: pack, branch_scope_id: branch,
      typed_attributes: typed, participants });
    return id;
  };
  const addConstraint = (kind, facet, state, rule, sourceClass, sourceDigest,
    incidenceIds, effect) => constraints.push({
    constraint_id: `c:${constraints.length}`, constraint_kind: kind, facet, state,
    derivation: derivation(rule, sourceClass, sourceDigest, state),
    incidence_ids: incidenceIds, normalized_effect: effect
  });

  for (let ordinal = 0; ordinal < input.authoritative_values.packs.length; ordinal += 1) {
    const packValue = input.authoritative_values.packs[ordinal];
    const supplement = packValue.projected_selection_supplement;
    const packId = packValue.pack_instance_id;
    const digest = supplement.supplement_identity.digest;
    const prefix = `pack:${ordinal}:`;
    const packNode = addNode({ id: `${prefix}scope`, kind: "proof_pack",
      subtype: "assessed_pack", state: "proven", pack: packId, sourceDigest: digest });
    const assessmentNode = addNode({ id: `${prefix}assessment`, kind: "assessment_state",
      subtype: "pack_result", state: packValue.per_pack_assessment
        ?.profile_discrimination ?? "not_assessed", pack: packId, sourceDigest: digest });
    const profileState = packValue.per_pack_assessment?.profile_discrimination ??
      "not_assessed";
    const exactState = packValue.per_pack_assessment?.exact_binding ?? "not_assessed";
    const profileStateNode = addNode({ id: `${prefix}assessment:profile`,
      kind: "assessment_state", subtype: "profile_result", state: profileState,
      pack: packId, sourceDigest: digest });
    const exactStateNode = addNode({ id: `${prefix}assessment:exact`,
      kind: "assessment_state", subtype: "exact_binding_result", state: exactState,
      pack: packId, sourceDigest: digest });
    for (const [state, nodeId, sourceClass] of [[profileState, profileStateNode,
      "profile_discrimination"], [exactState, exactStateNode, "exact_binding"]]) {
      if (["not_proven", "not_assessed", "not_applicable", "ambiguous", "residue",
        "missing", "invalid"].includes(state)) unresolved.push({
        fact_id: `u:${unresolved.length}`, state,
        classification: "unresolved_constraint", source_class: sourceClass,
        source_digest: digest, subject_node_ids: [nodeId],
        blocks: ["candidate_generation", "affected_comparison_field"],
        only_permitted_effects: ["diagnostic_only", "unresolved_constraint"]
      });
    }
    addEdge({ kind: "satisfies_pattern", source: packNode, target: assessmentNode,
      state: "proven", rule: "proof_pattern_overlay", sourceClass: "profile_pattern",
      sourceDigest: digest, effect: "overlay_only", facet: "proof_atomicity" });
    for (const [exclusionIndex] of (packValue.per_pack_assessment
      ?.proof_exclusions ?? []).entries()) {
      const boundary = addNode({ id: `${prefix}excluded:${exclusionIndex}`,
        kind: "planning_boundary", subtype: "excluded", state: "excluded",
        pack: packId, sourceDigest: digest, sourceOrdinal: exclusionIndex });
      addEdge({ kind: "outside_guarantee", source: packNode, target: boundary,
        state: "excluded", rule: "exclusion_diagnostic",
        sourceClass: "pack_exclusion", sourceDigest: digest,
        effect: "diagnostic_only", facet: "authority_boundary" });
      unresolved.push({ fact_id: `u:${unresolved.length}`, state: "excluded",
        classification: "diagnostic_boundary", source_class: "exclusion",
        source_digest: digest, subject_node_ids: [packNode, boundary],
        blocks: ["affected_comparison_field"],
        only_permitted_effects: ["diagnostic_only", "unresolved_constraint"] });
    }
    for (const [residueIndex] of (packValue.per_pack_assessment?.residue ?? [])
      .entries()) {
      const boundary = addNode({ id: `${prefix}residue:${residueIndex}`,
        kind: "planning_boundary", subtype: "residue", state: "residue",
        pack: packId, sourceDigest: digest, sourceOrdinal: residueIndex });
      unresolved.push({ fact_id: `u:${unresolved.length}`, state: "residue",
        classification: "review_required_boundary", source_class: "residue",
        source_digest: digest, subject_node_ids: [boundary],
        blocks: ["candidate_generation", "affected_comparison_field"],
        only_permitted_effects: ["diagnostic_only", "unresolved_constraint"] });
    }
    const projectedIds = new Map();
    for (const projected of supplement.projected_graph.nodes) {
      let kind;
      let subtype;
      if (projected.node_kind === "claim") {
        if (projected.claim_kind === "behavior") {
          kind = "authored_behavior_component"; subtype = "behavior_claim";
        } else {
          kind = "obligation"; subtype = projected.claim_kind;
        }
      } else if (projected.node_kind === "proposition") {
        kind = "obligation"; subtype = "proposition";
      } else if (projected.node_kind === "relation") {
        kind = "relation_instance";
        subtype = projected.semantic_payload.relation_role;
      } else if (projected.node_kind === "collection") {
        kind = "collection_instance";
        subtype = projected.semantic_payload.collection_kind;
      } else {
        kind = "resource"; subtype = "acquisition";
      }
      const id = addNode({ id: `${prefix}projected:${projected.projected_node_id}`,
        kind, subtype, pack: packId, sourceDigest: projected.source_contract_node_digest });
      projectedIds.set(projected.projected_node_id, id);
    }
    for (const projected of supplement.projected_graph.incidences) {
      if (projected.incidence_kind === "proposition_structure") {
        const owner = projectedIds.get(projected.proposition_projected_node_id);
        const parts = [participant("proposition", owner, 0), participant("subject",
          projectedIds.get(projected.subject.reference_projected_node_id), 0)];
        projected.operands.forEach((operand, position) => {
          let target = operand.reference_projected_node_id === null ? null :
            projectedIds.get(operand.reference_projected_node_id);
          if (target === null) target = addNode({ id: `${prefix}literal:${
            domainSeparatedDigest("controlled-contract:proof-aware-literal:v2",
              operand.literal_value)}`, kind: "resource", subtype: "evidence",
            pack: packId, sourceDigest: digest });
          parts.push(participant("operand", target, position,
            { operand_kind: operand.operand_kind === "reference" ? "reference" : "literal" }));
        });
        const incidenceId = addIncidence({ kind: "proposition_structure",
          state: "established", rule: "structural_overlay",
          sourceClass: "authored_proposition", sourceDigest: digest,
          effect: "overlay_only", facet: "behavior_cohesion", pack: packId,
          participants: parts });
        addConstraint("ordered_sequence", "behavior_cohesion", "established",
          "structural_overlay", "authored_proposition", digest, [incidenceId],
          "overlay_only");
      } else if (projected.incidence_kind === "applicability_structure") {
        addIncidence({ kind: "applicability_scope", state: "established",
          rule: "structural_overlay", sourceClass: "authored_applicability",
          sourceDigest: digest, effect: "overlay_only", facet: "behavior_cohesion",
          pack: packId, typed: { scope: projected.applicability_mode },
          participants: [participant("applicability_owner",
            projectedIds.get(projected.proposition_projected_node_id), 0),
          ...projected.operands.map((operand, position) => participant(
            "applicability_operand",
            projectedIds.get(operand.reference_projected_node_id), position,
            { scope_role: "operand" }))] });
      } else if (projected.incidence_kind === "claim_proposition_ownership") {
        const claim = projectedIds.get(projected.claim_projected_node_id);
        const proposition = projectedIds.get(projected.proposition_projected_node_id);
        if (projected.claim_kind === "behavior") addEdge({ kind: "must_co_locate",
          source: claim, target: proposition, state: "established",
          rule: "structural_behavior_cohesion", sourceClass: "authored_behavior_relation",
          sourceDigest: digest, effect: "behavior_cohesion", facet: "behavior_cohesion" });
        if (projected.claim_kind === "evidence") addEdge({ kind: "verified_by",
          source: proposition, target: claim, state: "established",
          rule: "verification_overlay", sourceClass: "verification_relation",
          sourceDigest: digest, effect: "overlay_only",
          facet: "verification_ownership" });
        if (projected.claim_kind === "verification") {
          addEdge({ kind: "verified_by", source: proposition, target: claim,
            state: "satisfied", rule: "verification_overlay",
            sourceClass: "verification_relation", sourceDigest: digest,
            effect: "overlay_only", facet: "verification_ownership" });
          const falsifier = addNode({ id: `${prefix}falsifier:${projected.claim_projected_node_id}`,
            kind: "falsifier", subtype: "falsifying_proposition", state: "satisfied",
            pack: packId, sourceDigest: digest });
          const falsifying = projectedIds.get(
            projected.falsifying_proposition_projected_node_id);
          addEdge({ kind: "falsified_by", source: claim, target: falsifier,
            state: "satisfied", rule: "proof_pattern_overlay",
            sourceClass: "falsifier_relation", sourceDigest: digest,
            effect: "overlay_only", facet: "verification_ownership" });
          addIncidence({ kind: "falsifier_occurrence", state: "satisfied",
            rule: "proof_pattern_overlay", sourceClass: "falsifier_relation",
            sourceDigest: digest, effect: "overlay_only", facet: "proof_atomicity",
            pack: packId, participants: [participant("target", proposition, 0),
              participant("verification", claim, 0), participant("falsifier", falsifier, 0),
              participant("occurrence_participant", falsifying, 0, {
                join_kind: "same_occurrence", proposition_position_kind: "subject",
                occurrence_role: "falsifier"
              })] });
        }
      } else if (projected.incidence_kind === "relation_endpoints") {
        const relation = projectedIds.get(projected.relation_projected_node_id);
        const relationNode = supplement.projected_graph.nodes.find((node) =>
          node.projected_node_id === projected.relation_projected_node_id);
        const endpoints = projected.endpoints.map((endpoint, position) => participant(
          "endpoint", projectedIds.get(endpoint.claim_projected_node_id), position,
          { endpoint_role: endpoint.endpoint_role }));
        addIncidence({ kind: "relation_endpoints", state: "established",
          rule: "structural_overlay", sourceClass: "authored_relation_instance",
          sourceDigest: digest, effect: "overlay_only", facet: "behavior_cohesion",
          pack: packId, participants: [participant("relation", relation, 0), ...endpoints] });
        const [source, target] = endpoints.map(({ node_id: nodeId }) => nodeId);
        if (["depends_on", "precedes"].includes(relationNode.semantic_payload.relation_role)) {
          addEdge({ kind: relationNode.semantic_payload.relation_role, source, target,
            state: "established", rule: "structural_directed_cut",
            sourceClass: relationNode.semantic_payload.relation_role === "depends_on"
              ? "authored_dependency" : "authored_precedence", sourceDigest: digest,
            effect: "directed_cut", facet: "implementation_ownership" });
        }
      } else if (projected.incidence_kind === "collection_membership") {
        const incidenceId = addIncidence({ kind: "collection_membership",
          state: "established", rule: "structural_overlay",
          sourceClass: "authored_collection_instance", sourceDigest: digest,
          effect: "overlay_only", facet: "implementation_ownership", pack: packId,
          typed: { ordered: projected.ordered }, participants: [participant("collection",
            projectedIds.get(projected.collection_projected_node_id), 0),
          ...projected.members.map((member, position) => participant("member",
            projectedIds.get(member.claim_projected_node_id), position))] });
        if (projected.ordered) addConstraint("ordered_sequence",
          "implementation_ownership", "established", "structural_overlay",
          "authored_collection_instance", digest, [incidenceId], "overlay_only");
      }
    }
    const patternIds = new Map();
    for (const selection of supplement.pattern_selections) {
      const state = stateForSelection(selection.selection_status);
      const pattern = addNode({ id: `${prefix}pattern:${selection.pattern_instance_id}`,
        kind: "profile_pattern", subtype: selection.pattern_kind, state, pack: packId,
        sourceDigest: digest });
      const selected = addNode({ id: `${prefix}selection:${selection.pattern_instance_id}`,
        kind: "projected_selection", subtype: selection.selection_status, state,
        pack: packId, sourceDigest: digest });
      patternIds.set(selection.pattern_instance_id, pattern);
      const selectedIds = selection.selected_nodes.map(({ projected_node_id: id }) =>
        projectedIds.get(id));
      const incidenceId = addIncidence({ kind: "projected_selection_ownership",
        state, rule: "proof_pattern_overlay", sourceClass: "projected_selection",
        sourceDigest: digest, effect: "overlay_only", facet: "proof_atomicity",
        pack: packId, participants: [participant("pack_scope", packNode, 0),
          participant("pattern", pattern, 0), participant("selection", selected, 0),
          participant("projected_graph", assessmentNode, 0), ...selectedIds.map(
            (id, position) => participant("selected_node", id, position))] });
      selectedIds.forEach((id) => addEdge({ kind: "satisfies_pattern", source: id,
        target: pattern, state, rule: "proof_pattern_overlay",
        sourceClass: "projected_selection", sourceDigest: digest,
        effect: "overlay_only", facet: "proof_atomicity" }));
      if (["not_proven", "not_assessed", "not_applicable", "ambiguous", "residue",
        "missing", "invalid"].includes(state)) unresolved.push({
        fact_id: `u:${unresolved.length}`, state,
        classification: "unresolved_constraint", source_class: "projected_selection",
        source_digest: digest, subject_node_ids: [pattern, selected],
        blocks: ["candidate_generation", "affected_comparison_field"],
        only_permitted_effects: ["diagnostic_only", "unresolved_constraint"]
      });
      const paths = selection.branch_paths;
      for (const path of paths) {
        for (const position of path) {
          const gate = addNode({ id: `${prefix}gate:${selection.pattern_instance_id}:${
            position.gate_depth}`, kind: "logic_gate", subtype: position.gate_operator,
          state, pack: packId, sourceDigest: digest });
          const branch = addNode({ id: `${prefix}branch:${selection.pattern_instance_id}:${
            position.gate_depth}:${position.branch_position}`, kind: "planning_boundary",
          subtype: "branch_scope", state, pack: packId, sourceDigest: digest });
          const establishedBranch = ["established", "proven", "satisfied",
            "inactive"].includes(state);
          const rule = position.gate_operator === "exactly_one" && establishedBranch
            ? "declared_alternative" : position.gate_operator === "any_of" &&
              establishedBranch ? "inclusive_alternative_overlay" :
              "proof_pattern_overlay";
          const sourceClass = position.gate_operator === "exactly_one" &&
              establishedBranch ? "exclusive_logic_gate_branch" :
            position.gate_operator === "any_of" && establishedBranch
              ? "inclusive_logic_gate_branch" : "profile_pattern";
          const effect = position.gate_operator === "exactly_one" && establishedBranch
            ? "separation_signal" : "overlay_only";
          const incidenceId = addIncidence({ kind: "logic_gate_branches", state,
            rule, sourceClass, sourceDigest: digest, effect, facet: "proof_atomicity",
            pack: packId, branch, typed: { operator: position.gate_operator },
            participants: [participant("logic_gate", gate, 0),
              participant("branch_scope", branch, 0, { branch_state:
                state === "inactive" ? "inactive" : state === "satisfied" ? "active" :
                  "unresolved" }), participant("branch_member", pattern, 0,
                { branch_state: state === "inactive" ? "inactive" :
                  state === "satisfied" ? "active" : "unresolved" })] });
          if (position.gate_operator === "exactly_one" && establishedBranch) addConstraint(
            "alternative_group", "proof_atomicity", state, rule, sourceClass,
            digest, [incidenceId], effect
          );
        }
      }
      void incidenceId;
    }
    const roleNodes = new Map();
    const roleNodeFor = (role) => {
      if (!roleNodes.has(role)) {
        const roleDigest = domainSeparatedDigest(
          "controlled-contract:proof-aware-association-role:v1", role
        );
        roleNodes.set(role, addNode({ id: `${prefix}association-role:${roleDigest}`,
          kind: "resource", subtype: "role_binding", state: "established",
          pack: packId, sourceDigest: roleDigest }));
      }
      return roleNodes.get(role);
    };
    let occurrenceCount = 0;
    for (const iteration of supplement.universal_iterations) {
      const state = iteration.vacuous ? "satisfied" : "proven";
      const pattern = patternIds.get(iteration.pattern_instance_id) ?? addNode({
        id: `${prefix}pattern:${iteration.pattern_instance_id}`, kind: "profile_pattern",
        subtype: "claim", state, pack: packId, sourceDigest: digest });
      const population = addNode({ id: `${prefix}population:${iteration.iteration_position}`,
        kind: "population", subtype: iteration.iteration_quantifier, state,
        pack: packId, sourceDigest: digest });
      const memberParticipants = [];
      const memberRoleParticipants = [];
      const occurrenceIncidences = [];
      for (const occurrence of iteration.occurrences) {
        occurrenceCount += 1;
        const occurrenceNode = addNode({ id: `${prefix}occurrence:${
          iteration.iteration_position}:${occurrence.member_occurrence_position}`,
        kind: "iterated_occurrence", subtype: "universal_member", state,
        pack: packId, sourceDigest: digest });
        const memberNode = projectedIds.get(occurrence.member_projected_node_id);
        for (const [memberPositionIndex, memberPosition] of
          occurrence.member_positions.entries()) memberParticipants.push(participant(
          "iteration_member", memberNode,
          [memberParticipants.length, occurrence.member_occurrence_position,
            memberPositionIndex, memberPosition.position],
          { member_role: memberPositionClass(memberPosition.position_kind) }
        ));
        memberRoleParticipants.push(participant("iteration_member_role",
          roleNodeFor(occurrence.member_role), [memberRoleParticipants.length,
            occurrence.member_occurrence_position]));
        const occurrenceIncidence = addIncidence({ kind: "occurrence_participation",
          state, rule: "proven_proof_atomicity",
          sourceClass: "same_occurrence_profile_requirement", sourceDigest: digest,
          effect: "proof_atomicity", facet: "proof_atomicity", pack: packId,
          participants: [participant("occurrence", occurrenceNode, 0),
            participant("occurrence_participant", memberNode, 0,
              { occurrence_role: "universal_member" }),
            ...occurrence.selected_nodes.map((selected, position) => participant(
              "occurrence_participant", projectedIds.get(selected.projected_node_id),
              position + 1, { occurrence_role: "selected_result" }))] });
        occurrenceIncidences.push(occurrenceIncidence);
        addEdge({ kind: "must_preserve_identity", source: occurrenceNode,
          target: memberNode, state, rule: "proven_proof_atomicity",
          sourceClass: "same_occurrence_profile_requirement", sourceDigest: digest,
          effect: "proof_atomicity", facet: "proof_atomicity" });
      }
      const associations = supplement.association_selections.filter((association) =>
        association.universal_iteration_position === iteration.iteration_position);
      const associationParticipants = [];
      const associationMemberRoles = [];
      const associationAssociatedRoles = [];
      for (const [associationIndex, association] of associations.entries()) {
        associationMemberRoles.push(participant("association_member_role",
          roleNodeFor(association.member_role), [associationIndex,
            association.member_occurrence_position,
            association.association_position], {
            member_role: association.member_position,
            cardinality: association.cardinality,
            association_status: association.association_status
          }));
        associationAssociatedRoles.push(participant("association_associated_role",
          roleNodeFor(association.associated_role), [associationIndex,
            association.member_occurrence_position,
            association.association_position], {
            associated_role: association.associated_position,
            cardinality: association.cardinality,
            association_status: association.association_status
          }));
        for (const node of association.associated_nodes) associationParticipants.push(
          participant("association", projectedIds.get(node.projected_node_id),
            [associationParticipants.length, association.member_occurrence_position,
              association.association_position, node.associated_node_position], {
              member_role: association.member_position,
              associated_role: association.associated_position,
              cardinality: association.cardinality,
              association_status: association.association_status
            })
        );
      }
      const iterationIncidence = addIncidence({ kind: "iteration_association", state,
        rule: "proof_pattern_overlay", sourceClass: "profile_pattern",
        sourceDigest: digest, effect: "overlay_only", facet: "proof_atomicity",
        pack: packId, typed: { quantifier: iteration.iteration_quantifier,
          vacuous: iteration.vacuous }, participants: [participant("pattern", pattern, 0),
          participant("population", population, 0), ...memberParticipants,
          ...memberRoleParticipants, ...associationParticipants,
          ...associationMemberRoles, ...associationAssociatedRoles] });
      addConstraint("universal_association", "proof_atomicity", state,
        "proof_pattern_overlay", "profile_pattern", digest,
        [iterationIncidence, ...occurrenceIncidences], "overlay_only");
    }
    const sourceSetDigest = packValue.projected_selection_supplement.cycle_binding
      .exact_capture_source_set.digest;
    const sourceSet = addNode({ id: `${prefix}capture:set`, kind: "capture_source_set",
      subtype: "exact_source_set", state: "proven", pack: packId,
      sourceDigest: sourceSetDigest });
    const transform = addNode({ id: `${prefix}capture:transform`,
      kind: "deterministic_transform", subtype: "projection", state: "proven",
      pack: packId, sourceDigest: digest });
    const resultRequirement = addNode({ id: `${prefix}capture:result-requirement`,
      kind: "exact_binding_requirement", subtype: "result", state: "proven",
      pack: packId, sourceDigest: digest });
    const resultProjection = addNode({ id: `${prefix}capture:result-projection`,
      kind: "resource", subtype: "projection", state: "proven", pack: packId,
      sourceDigest: digest });
    const sourceBindings = packValue.exact_binding_result?.bindings;
    const sourceDescriptors = packValue.exact_capture_source_set;
    if (!Array.isArray(sourceBindings) || sourceDescriptors === null ||
        typeof sourceDescriptors !== "object" || Array.isArray(sourceDescriptors) ||
        sourceBindings.length !==
        Object.keys(sourceDescriptors).length || new Set(sourceBindings.map(
      ({ requirement_id: requirementId }) => requirementId)).size !==
        sourceBindings.length || sourceBindings.some(({ requirement_id: requirementId }) =>
      !Object.hasOwn(sourceDescriptors, requirementId))) throw new Unit2Failure(
      "refused", "PA_EXACT_SOURCE_CENSUS_MISMATCH", "graph_construction"
    );
    const sourceRequirementParticipants = [];
    const capturedSourceParticipants = [];
    const captureResourceIncidences = [];
    for (const [sourcePosition, binding] of sourceBindings.entries()) {
      const sourceRequirement = addNode({ id:
        `${prefix}capture:source-requirement:${sourcePosition}`,
        kind: "exact_binding_requirement",
        subtype: "source", state: "proven", pack: packId,
        sourceDigest: binding.source_descriptor_sha256 });
      const sourceResource = addNode({ id: `${prefix}capture:source:${sourcePosition}`,
        kind: "resource", subtype: "capture", state: "proven", pack: packId,
        sourceDigest: binding.content_sha256 });
      sourceRequirementParticipants.push(participant("source_requirement",
        sourceRequirement, sourcePosition));
      capturedSourceParticipants.push(participant("captured_source", sourceResource,
        sourcePosition));
      addEdge({ kind: "captured_with", source: sourceRequirement, target: sourceSet,
        state: "proven", rule: "proven_capture_atomicity",
        sourceClass: "same_cycle_exact_binding", sourceDigest: digest,
        effect: "capture_atomicity", facet: "exact_capture_atomicity" });
      captureResourceIncidences.push(addIncidence({ kind: "resource_participation",
        state: "proven", rule: "proven_capture_atomicity",
        sourceClass: "same_cycle_exact_binding", sourceDigest: digest,
        effect: "capture_atomicity", facet: "exact_capture_atomicity", pack: packId,
        participants: [participant("resource", sourceResource, 0),
          participant("resource_participant", sourceRequirement, 0,
            { access_mode: "read", participation_role: "capture_source" }),
          participant("resource_participant", transform, 1,
            { access_mode: "execute", participation_role: "transform_input" })] }));
    }
    const exactIncidence = addIncidence({ kind: "exact_binding_source_result",
      state: "proven", rule: "proven_capture_atomicity",
      sourceClass: "same_cycle_exact_binding", sourceDigest: digest,
      effect: "capture_atomicity", facet: "exact_capture_atomicity", pack: packId,
      participants: [...sourceRequirementParticipants, ...capturedSourceParticipants,
        participant("source_set", sourceSet, 0), participant("transform", transform, 0),
        participant("result_requirement", resultRequirement, 0),
        participant("result_projection", resultProjection, 0)] });
    addEdge({ kind: "derived_by", source: resultProjection, target: transform,
      state: "proven", rule: "proven_capture_atomicity",
      sourceClass: "same_cycle_exact_binding", sourceDigest: digest,
      effect: "capture_atomicity", facet: "exact_capture_atomicity" });
    addEdge({ kind: "bound_to_projected_node", source: resultRequirement,
      target: resultProjection, state: "proven", rule: "proof_pattern_overlay",
      sourceClass: "projected_selection", sourceDigest: digest,
      effect: "overlay_only", facet: "proof_atomicity" });
    addEdge({ kind: "must_preserve_identity", source: sourceSet, target: transform,
      state: "proven", rule: "proven_capture_atomicity",
      sourceClass: "same_cycle_exact_binding", sourceDigest: digest,
      effect: "capture_atomicity", facet: "exact_capture_atomicity" });
    addConstraint("exact_capture_occurrence", "exact_capture_atomicity", "proven",
      "proven_capture_atomicity", "same_cycle_exact_binding", digest,
      [exactIncidence, ...captureResourceIncidences], "capture_atomicity");
    void occurrenceCount;
  }
  const packs = input.authoritative_values.packs;
  for (let left = 0; left < packs.length; left += 1) for (
    let right = left + 1; right < packs.length; right += 1
  ) {
    const digest = input.unit1.root_cycle.proof_aware_input_cycle_digest;
    const boundary = addNode({ id: `boundary:${left}:${right}`, kind: "planning_boundary",
      subtype: "non_join", state: "established", sourceDigest: digest });
    const leftNode = `pack:${left}:scope`;
    const rightNode = `pack:${right}:scope`;
    const incidenceId = addIncidence({ kind: "non_join_boundary",
      state: "established", rule: "explicit_non_join",
      sourceClass: "independent_pack_context", sourceDigest: digest,
      effect: "never_group", facet: "authority_boundary",
      typed: { reason: "independent_pack_context" },
      participants: [participant("boundary", boundary, 0),
        participant("left_side", leftNode, 0), participant("right_side", rightNode, 0)] });
    addEdge({ kind: "must_not_infer_join", source: leftNode, target: rightNode,
      state: "established", rule: "explicit_non_join",
      sourceClass: "independent_pack_context", sourceDigest: digest,
      effect: "never_group", facet: "authority_boundary" });
    addConstraint("must_not_infer_join", "authority_boundary", "established",
      "explicit_non_join", "independent_pack_context", digest, [incidenceId],
      "never_group");
  }
  return { nodes: [...nodes.values()], binary_edges: edges,
    typed_incidences: incidences, constraints, unresolved_facts: unresolved,
    universalOccurrenceCount: input.authoritative_values.packs.reduce((sum, pack) =>
      sum + pack.projected_selection_supplement.universal_iterations.reduce(
        (inner, iteration) => inner + iteration.occurrences.length, 0), 0), inputBytes };
}

function constructionCycle(input) {
  const root = input.unit1.root_cycle;
  const payload = {
    unit1_handoff_cycle_digest: root.proof_aware_input_cycle_digest,
    contract: root.contract,
    compiled_proof_plan: root.compiled_proof_plan,
    assessment_identity: root.assessment_identity,
    assessment_manifest: root.assessment_manifest,
    supplement_census_digest: root.supplement_census_digest,
    planning_pack_census: root.planning_pack_census,
    planning_policy: input.planning_policy_identity,
    planning_implementation: input.planning_implementation_identity,
    unit_boundary: "unit2_resolved_carrier_construction"
  };
  return { payload, digest: domainSeparatedDigest(CONSTRUCTION_CYCLE_DOMAIN, payload) };
}

function enforceCounts(extracted, limits) {
  const checks = [
    ["resolved_nodes", extracted.nodes.length],
    ["binary_edges", extracted.binary_edges.length],
    ["incidence_participants", extracted.typed_incidences.reduce((sum, incidence) =>
      sum + incidence.participants.length, 0)],
    ["universal_occurrences", extracted.universalOccurrenceCount]
  ];
  for (const [key, measured] of checks) if (measured > limits[key].limit) {
    throw resourceFailure(key, measured, limits[key]);
  }
}

function constructProofAwarePlanningCarrier(input, { limits: injectedLimits = {} } = {}) {
  let limits;
  try {
    limits = resolveUnit2Limits(injectedLimits);
    const snapshot = structuredClone(input);
    const inputBytes = validateInput(snapshot, limits);
    const cycle = constructionCycle(snapshot);
    const extracted = extractionBuilder(snapshot, inputBytes);
    enforceCounts(extracted, limits);
    const resourceAccounting = {
      verified_input_bytes: inputBytes,
      node_count: extracted.nodes.length,
      binary_edge_count: extracted.binary_edges.length,
      typed_incidence_participant_count: extracted.typed_incidences.reduce(
        (sum, incidence) => sum + incidence.participants.length, 0),
      universal_occurrence_count: extracted.universalOccurrenceCount,
      selected_pack_count: snapshot.authoritative_values.packs.length
    };
    const carrier = createResolvedCarrier({
      input_authority: {
        binding_version: "proof-aware-input-binding.v2-unit2",
        unit1_handoff_cycle_digest:
          snapshot.unit1.root_cycle.proof_aware_input_cycle_digest,
        construction_cycle_digest: cycle.digest,
        contract: snapshot.unit1.root_cycle.contract,
        compiled_proof_plan: snapshot.unit1.root_cycle.compiled_proof_plan,
        assessment_manifest: snapshot.unit1.root_cycle.assessment_manifest,
        supplement_census_digest: snapshot.unit1.supplement_census.census_digest,
        planning_pack_cycle_digests: snapshot.unit1.planning_pack_cycles.map(
          ({ planning_pack_cycle_digest: digest }) => digest),
        planning_policy: snapshot.planning_policy_identity,
        planning_implementation: snapshot.planning_implementation_identity,
        mandatory_exclusions: MANDATORY_AUTHORITY_EXCLUSIONS
      },
      nodes: extracted.nodes,
      binary_edges: extracted.binary_edges,
      typed_incidences: extracted.typed_incidences,
      constraints: extracted.constraints,
      unresolved_facts: extracted.unresolved_facts,
      resource_accounting: resourceAccounting
    });
    const carrierDigest = resolvedCarrierDigest(carrier);
    const anonymous = anonymizeResolvedCarrier(carrier);
    const result = {
      result_version: RESULT_VERSION,
      status: "success",
      authority: authority(),
      input_binding: {
        validated_unit1_cycle_digest:
          snapshot.unit1.root_cycle.proof_aware_input_cycle_digest,
        planning_policy_digest: snapshot.planning_policy_identity.digest,
        planning_implementation_digest:
          snapshot.planning_implementation_identity.digest,
        construction_cycle_digest: cycle.digest,
        resolved_carrier_digest: carrierDigest,
        anonymous_candidate_digest:
          anonymous.anonymous_carrier.candidate_digest
      },
      resolved_carrier: carrier,
      anonymous_carrier: anonymous.anonymous_carrier,
      orbit_input: anonymous.orbit_input,
      resource_accounting: { ...resourceAccounting, successful_output_bytes: 0 },
      diagnostics: []
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const outputBytes = canonicalJsonBytes(result).byteLength;
      if (outputBytes > limits.successful_output_bytes.limit) throw resourceFailure(
        "successful_output_bytes", outputBytes, limits.successful_output_bytes
      );
      if (result.resource_accounting.successful_output_bytes === outputBytes) break;
      result.resource_accounting.successful_output_bytes = outputBytes;
    }
    if (canonicalJsonBytes(result).byteLength !==
        result.resource_accounting.successful_output_bytes) throw new Unit2Failure(
      "refused", "PA_SERIALIZATION_FIXED_POINT_FAILED", "serialization"
    );
    return frozenClone(result);
  } catch (error) {
    const failure = error instanceof Unit2Failure ? error : new Unit2Failure(
      error?.code === "PA_ANONYMIZATION_REFINEMENT_REQUIRES_UNIT3"
        ? "unsupported_input" : "refused",
      error?.code ?? "PA_INVALID_INPUT",
      error?.code === "PA_ANONYMIZATION_REFINEMENT_REQUIRES_UNIT3"
        ? "anonymization" : "graph_construction"
    );
    return failureResult(input, failure);
  }
}

function createUnit2Input({ unit1, authoritativeValues }) {
  return frozenClone({
    input_version: "controlled-contract-proof-aware-unit2-input.experimental.v2",
    authority: authority("non_authoritative_unit2_input"),
    unit1,
    authoritative_values: authoritativeValues,
    planning_policy: PLANNING_POLICY,
    planning_policy_identity: PLANNING_POLICY_IDENTITY,
    planning_implementation: IMPLEMENTATION_DESCRIPTOR,
    planning_implementation_identity: IMPLEMENTATION_IDENTITY
  });
}

export {
  RESULT_VERSION,
  Unit2Failure,
  constructProofAwarePlanningCarrier,
  createUnit2Input
};
