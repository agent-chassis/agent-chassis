

import {
  canonicalValue,
  compareCodeUnits,
  deepFreeze,
  sha256
} from "./deterministic-projection-primitives.mjs";
import { stableSemanticKey } from "./equality-normalization-v1.mjs";
import { applyControlledContractCarrierPatch } from "./carrier-patch-v1.mjs";
import { applyStableVerificationBundles } from "./test-proof-contract-v1.mjs";
import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  TEST_PROOF_VERSION_V1,
  VOCABULARY_VERSION_V1,
  validateAndResolveNativeContractV1
} from "./native-contract-carrier-v1.mjs";
import { validateSuppliedProofPackBindings } from
  "./proof-pack-binding-assistance.mjs";
import { buildProofPlan } from "./proof-plan-compiler.mjs";
import {
  PROOF_GRAPH_CARRIER_KINDS,
  validateProofGraphProposal
} from "./proof-graph-proposal-v1.mjs";

const PROOF_GRAPH_COMPOSITION_SCHEMA_VERSION =
  "controlled-proof-graph-composition.v1";

const EVALUATION_INPUT_VERSION_V1 =
  "controlled-contract-verification-profile-input.v1";
const PROOF_PLAN_REQUEST_VERSION_V1 = "controlled-contract-proof-plan-request.v1";

const PROOF_GRAPH_CARRIER_ORDER = PROOF_GRAPH_CARRIER_KINDS;

const PERMITTED_CROSS_CARRIER_JOIN = Object.freeze({
  source_carrier: "evaluation_input",
  source_path: "/reference_bindings/{binding}/reference_ids/{member}",
  target_carrier: "contract",
  target_path: "/references/{index}/reference_id",
  key: "nfc_stable_semantic_key"
});
const FORBIDDEN_CROSS_CARRIER_JOIN_TARGETS = Object.freeze({
  resolver_facts: "argument_reference_ids",
  claim_pattern_bindings: "claim_id",
  delivered_evidence: "verification_claim_id"
});

const EXPECTED_SOURCE_FIELDS = Object.freeze([
  "carrier_kind", "presence", "expected_content_digest"
]);
const EXPECTED_SOURCE_PRESENCE = Object.freeze(["present", "absent"]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const COMPOSITION_REQUEST_FIELDS = Object.freeze([
  "proposal", "sources", "expected_sources"
]);

class ProofGraphCompositionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofGraphCompositionError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

function refuse(code, message, details = {}) {
  throw new ProofGraphCompositionError(code, message, details);
}

function conflict(pointer, reason, details = {}) {
  refuse("controlled_contract_proof_graph_cross_carrier_identity_conflict",
    "a proposed cross-carrier identity join is missing, incompatible, or unowned", {
      carrier_kind: "evaluation_input",
      pointer,
      reason,
      permitted_join: PERMITTED_CROSS_CARRIER_JOIN,
      ...details
    });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function carrierBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function carrierDigest(value) {
  return `sha256:${sha256(carrierBytes(value))}`;
}

function absentCarrierBase(carrierKind) {
  if (carrierKind === "contract") return {
    schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1,
    references: [], propositions: [], claims: [], relations: [],
    collections: [], residue: [], annotations: [],
    test_proof_version: TEST_PROOF_VERSION_V1, test_proofs: []
  };
  if (carrierKind === "evaluation_input") return {
    input_version: EVALUATION_INPUT_VERSION_V1,
    reference_bindings: [], number_bindings: [], claim_pattern_bindings: [],
    resolver_facts: [], delivered_evidence: [], stable_evaluation: {}
  };
  return {
    schema_version: PROOF_PLAN_REQUEST_VERSION_V1,
    requested_intents: [], selected_packs: []
  };
}

function normalizeSources(sources) {
  if (sources === undefined || sources === null) return {};
  if (!isPlainObject(sources)) refuse(
    "controlled_contract_proof_graph_composition_input_invalid",
    "sources must be one closed plain object keyed by carrier kind",
    { pointer: "/sources" });
  const unknown = Reflect.ownKeys(sources)
    .filter((key) => typeof key !== "string" ||
      !PROOF_GRAPH_CARRIER_KINDS.includes(key)).map(String).sort();
  if (unknown.length > 0) refuse(
    "controlled_contract_proof_graph_composition_input_invalid",
    "sources carries an unsupported carrier kind",
    { pointer: "/sources", unknown });
  const normalized = {};
  for (const kind of PROOF_GRAPH_CARRIER_ORDER) {
    if (!Object.hasOwn(sources, kind) || sources[kind] === null) continue;
    if (!isPlainObject(sources[kind])) refuse(
      "controlled_contract_proof_graph_composition_input_invalid",
      "a supplied carrier source must be one plain JSON object",
      { pointer: `/sources/${kind}` });
    normalized[kind] = structuredClone(sources[kind]);
  }
  return normalized;
}

function inputInvalid(pointer, message, details = {}) {
  refuse("controlled_contract_proof_graph_composition_input_invalid", message,
    { pointer, ...details });
}

function normalizeSourceDeclaration(expectedSources) {
  if (!Array.isArray(expectedSources)) inputInvalid("/expected_sources",
    "expected_sources must be the ordered server-owned source declaration");
  const seen = new Set();
  for (const [index, expectation] of expectedSources.entries()) {
    const pointer = `/expected_sources/${index}`;
    if (!isPlainObject(expectation)) inputInvalid(pointer,
      "each source expectation must be one closed plain object");
    const unknown = Reflect.ownKeys(expectation)
      .filter((key) => typeof key !== "string" ||
        !EXPECTED_SOURCE_FIELDS.includes(key)).map(String).sort();
    const missing = EXPECTED_SOURCE_FIELDS.filter(
      (field) => !Object.hasOwn(expectation, field));
    if (unknown.length > 0 || missing.length > 0) inputInvalid(pointer,
      "a source expectation carries unknown or missing closed fields",
      { unknown, missing });
    if (!PROOF_GRAPH_CARRIER_KINDS.includes(expectation.carrier_kind)) {
      inputInvalid(`${pointer}/carrier_kind`, "carrier kind is unsupported", {
        supported: [...PROOF_GRAPH_CARRIER_KINDS],
        actual: expectation.carrier_kind ?? null
      });
    }
    if (seen.has(expectation.carrier_kind)) inputInvalid(`${pointer}/carrier_kind`,
      "expected_sources must carry at most one expectation per carrier",
      { carrier_kind: expectation.carrier_kind });
    seen.add(expectation.carrier_kind);
    if (!EXPECTED_SOURCE_PRESENCE.includes(expectation.presence)) {
      inputInvalid(`${pointer}/presence`, "presence must be present or absent", {
        supported: [...EXPECTED_SOURCE_PRESENCE],
        actual: expectation.presence ?? null
      });
    }
    if (expectation.presence === "present") {
      if (typeof expectation.expected_content_digest !== "string" ||
          !DIGEST_PATTERN.test(expectation.expected_content_digest)) {
        inputInvalid(`${pointer}/expected_content_digest`,
          "an expected-present carrier requires one exact sha256 content digest");
      }
    } else if (expectation.expected_content_digest !== null) {
      inputInvalid(`${pointer}/expected_content_digest`,
        "an expected-absent carrier requires a null content digest");
    }
  }
  return structuredClone(expectedSources);
}

function mismatch(pointer, reason, details = {}) {
  refuse("controlled_contract_proof_graph_source_expectation_mismatch",
    "a declared present/absent source expectation does not hold",
    { pointer, reason, ...details });
}

function assertSourceExpectations(expectedSources, sources) {
  const expectationByKind = new Map(expectedSources.map(
    (expectation) => [expectation.carrier_kind, expectation]));
  for (const [index, expectation] of expectedSources.entries()) {
    const pointer = `/expected_sources/${index}`;
    const supplied = Object.hasOwn(sources, expectation.carrier_kind)
      ? sources[expectation.carrier_kind] : null;
    if (expectation.presence === "present") {
      if (supplied === null) mismatch(pointer, "expected_present_source_absent",
        { carrier_kind: expectation.carrier_kind });
      const observed = carrierDigest(supplied);
      if (observed !== expectation.expected_content_digest) mismatch(pointer,
        "expected_present_source_digest_mismatch", {
          carrier_kind: expectation.carrier_kind,
          expected_content_digest: expectation.expected_content_digest,
          actual_content_digest: observed
        });
      continue;
    }
    if (supplied !== null) mismatch(pointer, "expected_absent_source_present",
      { carrier_kind: expectation.carrier_kind });
  }
  for (const kind of PROOF_GRAPH_CARRIER_ORDER) {
    if (!Object.hasOwn(sources, kind) || expectationByKind.has(kind)) continue;
    mismatch(`/sources/${kind}`, "supplied_source_without_expectation",
      { carrier_kind: kind });
  }
  return expectationByKind;
}

function unresolved(carrierKind, pointer, reason, details = {}) {
  return { ...details, carrier_kind: carrierKind, pointer, reason };
}

function continuationUnresolvedPointers(skeletonContinuation) {
  return skeletonContinuation.unresolved_required_roles.map((entry, index) =>
    unresolved(null, `/skeleton_continuation/unresolved_required_roles/${index}`,
      "selected_pack_required_role_unresolved",
      { role: typeof entry?.role === "string" ? entry.role : null }));
}

function addressedWithoutExpectationPointers(routes, expectationByKind) {
  return routes.filter(({ carrier_kind: kind }) => !expectationByKind.has(kind))
    .map(({ index, carrier_kind: kind }) => unresolved(null,
      `/carrier_operations/${index}/carrier_kind`,
      "addressed_carrier_source_expectation_missing",
      { addressed_carrier_kind: kind }));
}

function referenceIdentityWithoutContractPointers(evaluationInput) {
  const pointers = [];
  for (const [bindingIndex, binding] of
    (evaluationInput.reference_bindings ?? []).entries()) {
    const referenceIds = Array.isArray(binding?.reference_ids)
      ? binding.reference_ids : [];
    for (const memberIndex of referenceIds.keys()) {
      pointers.push(unresolved("evaluation_input",
        `/reference_bindings/${bindingIndex}/reference_ids/${memberIndex}`,
        "reference_identity_contract_source_expectation_missing"));
    }
  }
  return pointers;
}

function applyCarrierOperations({ proposal, prospective }) {
  const patchOperations = new Map(
    PROOF_GRAPH_CARRIER_ORDER.map((kind) => [kind, []]));
  const bundleOperations = [];
  for (const route of proposal.routes) {
    const operation = proposal.carrier_operations[route.index];
    if (route.kind === "verification_bundle") {
      bundleOperations.push({
        op: operation.op,
        verification_id: operation.verification_id,
        bundle: structuredClone(operation.bundle)
      });
      continue;
    }
    const projected = {};
    for (const field of ["op", "target", "id", "value"]) {
      if (Object.hasOwn(operation, field)) {
        projected[field] = structuredClone(operation[field]);
      }
    }
    patchOperations.get(route.carrier_kind).push(projected);
  }
  for (const carrierKind of PROOF_GRAPH_CARRIER_ORDER) {
    const operations = patchOperations.get(carrierKind);
    if (operations.length === 0) continue;
    prospective[carrierKind] = applyControlledContractCarrierPatch({
      content: prospective[carrierKind], carrierKind, operations
    }).content;
  }
  if (bundleOperations.length > 0) {
    prospective.contract = applyStableVerificationBundles({
      contract: prospective.contract, operations: bundleOperations
    }).contract;
  }
  return {
    patch_operations_by_carrier: Object.fromEntries(PROOF_GRAPH_CARRIER_ORDER
      .map((kind) => [kind, patchOperations.get(kind).length])),
    verification_bundle_operations: bundleOperations.length
  };
}

function entryIndex(collection, matcher) {
  const index = (Array.isArray(collection) ? collection : []).findIndex(matcher);
  return index < 0 ? 0 : index;
}

function assertNoUnownedProposedJoins({ proposal, evaluationInput }) {
  for (const route of proposal.routes) {
    if (route.kind !== "carrier_patch") continue;
    if (route.carrier_kind !== "evaluation_input") continue;
    const operation = proposal.carrier_operations[route.index];
    if (operation.op !== "upsert") continue;
    const joinField = FORBIDDEN_CROSS_CARRIER_JOIN_TARGETS[operation.target];
    if (joinField === undefined) continue;
    const collection = evaluationInput?.[operation.target];
    const index = entryIndex(collection, (value) =>
      JSON.stringify(canonicalValue(value)) ===
        JSON.stringify(canonicalValue(operation.value)));
    conflict(`/${operation.target}/${index}/${joinField}`,
      "unowned_semantic_carrier_join", {
        proposal_pointer: `/carrier_operations/${route.index}`,
        target: operation.target
      });
  }
}

function referenceCompatibilityKey(reference) {
  return stableSemanticKey({
    type_term: reference?.type_term ?? null,
    identity_kind: reference?.identity?.kind ?? null,
    identity: reference?.identity ?? null
  });
}

function joinReferenceIdentities({ contract, evaluationInput }) {
  const contractByKey = new Map();
  for (const [index, reference] of (contract.references ?? []).entries()) {
    if (typeof reference?.reference_id !== "string") continue;
    const key = stableSemanticKey(reference.reference_id.normalize("NFC"));
    const rows = contractByKey.get(key) ?? [];
    rows.push({ reference, pointer: `/references/${index}/reference_id` });
    contractByKey.set(key, rows);
  }
  const bindings = new Map();
  const addressedRoles = [];
  for (const [bindingIndex, binding] of
    (evaluationInput.reference_bindings ?? []).entries()) {
    const referenceIds = Array.isArray(binding?.reference_ids)
      ? binding.reference_ids : [];
    for (const [memberIndex, referenceId] of referenceIds.entries()) {
      const pointer =
        `/reference_bindings/${bindingIndex}/reference_ids/${memberIndex}`;
      if (typeof referenceId !== "string") conflict(pointer,
        "evaluation_input_reference_identity_invalid");
      const key = stableSemanticKey(referenceId.normalize("NFC"));
      const rows = contractByKey.get(key) ?? [];
      if (rows.length === 0) conflict(pointer, "contract_reference_missing",
        { reference_id: referenceId });
      const compatibility = new Set(rows.map(
        ({ reference }) => referenceCompatibilityKey(reference)));
      if (compatibility.size > 1) conflict(pointer,
        "contract_reference_identity_incompatible", {
          reference_id: referenceId,
          contract_pointers: rows.map(({ pointer: value }) => value)
        });
      const existing = bindings.get(key);
      if (existing === undefined) {
        bindings.set(key, {
          semantic_key: key,
          reference_id: rows[0].reference.reference_id,
          type_term: rows[0].reference.type_term ?? null,
          identity_kind: rows[0].reference.identity?.kind ?? null,
          contract_pointer: rows[0].pointer,
          evaluation_input_pointers: [pointer]
        });
      } else existing.evaluation_input_pointers.push(pointer);
      if (typeof binding?.role === "string") addressedRoles.push(binding.role);
    }
  }
  return {
    bindings: [...bindings.values()].sort((left, right) =>
      compareCodeUnits(left.semantic_key, right.semantic_key)),
    addressed_roles: [...new Set(addressedRoles)].sort(compareCodeUnits)
  };
}

function delegatedRefusal(owner, error, details = {}) {
  refuse("controlled_contract_proof_graph_prospective_carrier_invalid",
    "a prospective carrier was refused by its existing validation owner", {
      owner,
      cause_code: error?.code ?? null,
      diagnostics: error?.details?.diagnostics ?? [],
      ...details
    });
}

async function authorizeReferenceJoin({ contract, evaluationInput, selectedPack,
  addressedRoles }) {
  let validation;
  try {
    validation = await validateSuppliedProofPackBindings({
      contract,
      profileId: selectedPack.profile_id,
      profileVersion: selectedPack.profile_version,
      evaluationInput
    });
  } catch (error) {
    delegatedRefusal("validateSuppliedProofPackBindings", error);
  }
  if (validation.summary.status !== "valid") delegatedRefusal(
    "validateSuppliedProofPackBindings",
    { code: "proof_pack_binding_summary_not_valid" }, {
      summary: structuredClone(validation.summary),
      evaluation_input_diagnostics:
        structuredClone(validation.evaluation_input_diagnostics)
    });
  const statusByRole = new Map(validation.reference_roles.map(
    ({ role, status }) => [role, status]));
  const unauthorized = addressedRoles.filter(
    (role) => statusByRole.get(role) !== "validly_bound").sort(compareCodeUnits);
  if (unauthorized.length > 0) delegatedRefusal(
    "validateSuppliedProofPackBindings",
    { code: "proof_pack_binding_role_not_validly_bound" },
    { unauthorized_roles: unauthorized });
  return validation;
}

function selectedPackEvaluationInputPaths(request, selectedPack) {
  return (Array.isArray(request?.selected_packs) ? request.selected_packs : [])
    .filter((pack) => pack?.profile_id === selectedPack.profile_id &&
      pack?.profile_version === selectedPack.profile_version)
    .map((pack) => pack?.evaluation_input_path)
    .filter((value) => typeof value === "string" && value.length > 0);
}

function selectedPackCount(request) {
  return (Array.isArray(request?.selected_packs) ? request.selected_packs : []).length;
}

function composedRequestedIntents(proposal, prospective) {
  const carried = Object.hasOwn(prospective, "proof_plan_request") &&
    Array.isArray(prospective.proof_plan_request.requested_intents)
    ? prospective.proof_plan_request.requested_intents
      .filter((value) => typeof value === "string")
    : [];
  return [...new Set([...carried, ...proposal.requested_intents])]
    .sort(compareCodeUnits);
}

function proofPlanDerivability(request, selectedPack) {
  const owned = new Set(selectedPackEvaluationInputPaths(request, selectedPack));
  const unavailable = (Array.isArray(request?.selected_packs)
    ? request.selected_packs : [])
    .filter((pack) => !owned.has(pack?.evaluation_input_path))
    .map((pack) => ({
      profile_id: typeof pack?.profile_id === "string" ? pack.profile_id : null,
      profile_version: typeof pack?.profile_version === "string"
        ? pack.profile_version : null,
      evaluation_input_path: typeof pack?.evaluation_input_path === "string"
        ? pack.evaluation_input_path : null
    }))
    .sort((left, right) => compareCodeUnits(
      `${left.profile_id}\0${left.profile_version}\0${left.evaluation_input_path}`,
      `${right.profile_id}\0${right.profile_version}\0${right.evaluation_input_path}`
    ));
  return { owned: [...owned].sort(compareCodeUnits), unavailable };
}

function incompleteResult(admitted, pointers, requestedIntents, selectedPacks) {
  return deepFreeze({
    schema_version: PROOF_GRAPH_COMPOSITION_SCHEMA_VERSION,
    status: "incomplete",
    reason_code: "controlled_contract_proof_graph_proposal_incomplete",
    wk_id: admitted.wk_id,
    focus: admitted.focus,
    selected_pack: structuredClone(admitted.selected_pack),
    requested_intents: requestedIntents,
    contract_content_digest: admitted.contract_content_digest,
    proposal_operation_count: admitted.operation_count,
    proposal_projection_bytes: admitted.projection_bytes,
    permitted_cross_carrier_join: PERMITTED_CROSS_CARRIER_JOIN,
    counts: {
      carrier_operations: admitted.operation_count,
      carrier_patch_operations: admitted.carrier_patch_operation_count,
      verification_bundle_operations: admitted.verification_bundle_operation_count,
      prospective_carriers: 0,
      changed_carriers: 0,
      selected_packs: selectedPacks,
      cross_carrier_bindings: 0,
      cross_carrier_provenance_pointers: 0,
      unresolved_pointers: pointers.length
    },
    carriers: [],
    manifest_inputs: [],
    cross_carrier_bindings: [],
    delegated_validations: [],
    proof_plan_digest: null,
    proof_plan_derivation: deepFreeze({
      status: "carrier_set_incomplete",
      derived_from_evaluation_input_paths: [],
      unavailable_selected_packs: []
    }),
    unresolved_pointers: pointers,
    no_op: false,
    authority: "non_authoritative",
    carriers_written: false,
    semantics_chosen: false,
    proof_claimed: false,
    dispatch_authorized: false
  });
}

async function composeProofGraphCarrierSet(request, ...unexpectedArguments) {
  if (unexpectedArguments.length > 0 || !isPlainObject(request) ||
      Reflect.ownKeys(request).some((key) => typeof key !== "string" ||
        !COMPOSITION_REQUEST_FIELDS.includes(key))) {
    refuse("controlled_contract_proof_graph_composition_input_invalid",
      "composition accepts exactly one closed {proposal, sources, expected_sources} request",
      { pointer: "" });
  }
  const admitted = validateProofGraphProposal(request.proposal);

  const expectedSources = normalizeSourceDeclaration(request.expected_sources);
  const sources = normalizeSources(request.sources);
  const expectationByKind = assertSourceExpectations(expectedSources, sources);

  const preComposition = [
    ...continuationUnresolvedPointers(admitted.skeleton_continuation),
    ...addressedWithoutExpectationPointers(admitted.routes, expectationByKind)
  ];
  if (preComposition.length > 0) return incompleteResult(admitted, preComposition,
    composedRequestedIntents(admitted, {}), 0);

  const prospective = {};
  const presenceBefore = {};
  for (const kind of PROOF_GRAPH_CARRIER_ORDER) {
    const expectation = expectationByKind.get(kind);
    if (expectation === undefined) continue;
    presenceBefore[kind] = expectation.presence;
    prospective[kind] = expectation.presence === "present"
      ? structuredClone(sources[kind]) : absentCarrierBase(kind);
  }
  const applied = applyCarrierOperations({ proposal: admitted, prospective });

  if (Object.hasOwn(prospective, "evaluation_input")) {
    assertNoUnownedProposedJoins({
      proposal: admitted, evaluationInput: prospective.evaluation_input
    });
  }

  const postComposition = [];
  if (Object.hasOwn(prospective, "evaluation_input") &&
      !Object.hasOwn(prospective.evaluation_input, "evaluation_stage")) {
    postComposition.push(unresolved("evaluation_input", "/evaluation_stage",
      "evaluation_stage_unresolved"));
  }
  if (Object.hasOwn(prospective, "evaluation_input") &&
      !expectationByKind.has("contract")) {
    postComposition.push(...referenceIdentityWithoutContractPointers(
      prospective.evaluation_input));
  }
  if (Object.hasOwn(prospective, "proof_plan_request") &&
      selectedPackEvaluationInputPaths(
        prospective.proof_plan_request, admitted.selected_pack).length === 0) {
    postComposition.push(unresolved("proof_plan_request", "/selected_packs",
      "selected_pack_evaluation_input_path_unresolved"));
  }
  if (postComposition.length > 0) return incompleteResult(admitted, postComposition,
    composedRequestedIntents(admitted, prospective),
    selectedPackCount(prospective.proof_plan_request));

  let join = { bindings: [], addressed_roles: [] };
  const joinable = Object.hasOwn(prospective, "contract") &&
    Object.hasOwn(prospective, "evaluation_input");
  if (joinable) {
    join = joinReferenceIdentities({
      contract: prospective.contract,
      evaluationInput: prospective.evaluation_input
    });
  }

  const delegated = [];
  if (Object.hasOwn(prospective, "contract")) {
    const nativeResult = validateAndResolveNativeContractV1(prospective.contract);
    if (!nativeResult.valid) delegatedRefusal(
      "validateAndResolveNativeContractV1",
      { code: "stable_contract_invalid",
        details: { diagnostics: nativeResult.schema_valid
          ? nativeResult.diagnostics : nativeResult.schema_errors } });
    delegated.push("validateAndResolveNativeContractV1");
  }

  if (joinable) {
    await authorizeReferenceJoin({
      contract: prospective.contract,
      evaluationInput: prospective.evaluation_input,
      selectedPack: admitted.selected_pack,
      addressedRoles: join.addressed_roles
    });
    delegated.push("validateSuppliedProofPackBindings");
  }

  let proofPlanDigest = null;
  let proofPlanDerivation = {
    status: "carrier_set_incomplete",
    derived_from_evaluation_input_paths: [],
    unavailable_selected_packs: []
  };
  if (PROOF_GRAPH_CARRIER_ORDER.every((kind) => Object.hasOwn(prospective, kind))) {
    const derivability = proofPlanDerivability(
      prospective.proof_plan_request, admitted.selected_pack);
    if (derivability.unavailable.length > 0) {
      proofPlanDerivation = {
        status: "selected_pack_evaluation_input_outside_carrier_set",
        derived_from_evaluation_input_paths: derivability.owned,
        unavailable_selected_packs: derivability.unavailable
      };
    } else {
      let plan;
      try {
        plan = await buildProofPlan({
          contract: prospective.contract,
          request: prospective.proof_plan_request,
          evaluationInputs: Object.fromEntries(derivability.owned.map(
            (path) => [path, prospective.evaluation_input]))
        });
      } catch (error) {
        delegatedRefusal("buildProofPlan", error);
      }
      proofPlanDigest = `sha256:${sha256(carrierBytes(canonicalValue(plan)))}`;
      proofPlanDerivation = {
        status: "derived",
        derived_from_evaluation_input_paths: derivability.owned,
        unavailable_selected_packs: []
      };
      delegated.push("buildProofPlan");
    }
  }

  const carriers = [];
  for (const kind of PROOF_GRAPH_CARRIER_ORDER) {
    if (!Object.hasOwn(prospective, kind)) continue;
    const content = canonicalValue(prospective[kind]);
    const bytes = carrierBytes(content);
    const digest = `sha256:${sha256(bytes)}`;
    const before = presenceBefore[kind];
    const priorDigest = before === "present"
      ? `sha256:${sha256(carrierBytes(canonicalValue(sources[kind])))}` : null;
    carriers.push({
      carrier_kind: kind,
      presence_before: before,
      presence_after: "present",
      changed: priorDigest === null || priorDigest !== digest,
      content,
      canonical_bytes: bytes.toString("utf8"),
      byte_length: bytes.byteLength,
      content_digest: digest,
      prior_content_digest: priorDigest
    });
  }

  const changed = carriers.filter(({ changed: value }) => value).length;
  const provenanceCount = join.bindings.reduce(
    (total, binding) => total + binding.evaluation_input_pointers.length, 0);
  return deepFreeze({
    schema_version: PROOF_GRAPH_COMPOSITION_SCHEMA_VERSION,
    status: "composed",
    reason_code: null,
    wk_id: admitted.wk_id,
    focus: admitted.focus,
    selected_pack: structuredClone(admitted.selected_pack),
    requested_intents: composedRequestedIntents(admitted, prospective),
    contract_content_digest: admitted.contract_content_digest,
    proposal_operation_count: admitted.operation_count,
    proposal_projection_bytes: admitted.projection_bytes,
    permitted_cross_carrier_join: PERMITTED_CROSS_CARRIER_JOIN,
    counts: {
      carrier_operations: admitted.operation_count,
      carrier_patch_operations: admitted.carrier_patch_operation_count,
      verification_bundle_operations: applied.verification_bundle_operations,
      prospective_carriers: carriers.length,
      changed_carriers: changed,
      selected_packs: selectedPackCount(prospective.proof_plan_request),
      cross_carrier_bindings: join.bindings.length,
      cross_carrier_provenance_pointers: provenanceCount,
      unresolved_pointers: 0
    },
    carriers,
    manifest_inputs: carriers.map(({ carrier_kind: kind, presence_before: before,
      content_digest: digest, byte_length: length }) => ({
      carrier_kind: kind,
      presence_before: before,
      content_digest: digest,
      byte_length: length
    })),
    cross_carrier_bindings: join.bindings,
    delegated_validations: delegated,
    proof_plan_digest: proofPlanDigest,
    proof_plan_derivation: deepFreeze(proofPlanDerivation),
    unresolved_pointers: [],
    no_op: changed === 0,
    authority: "non_authoritative",
    carriers_written: false,
    semantics_chosen: false,
    proof_claimed: false,
    dispatch_authorized: false
  });
}

export {
  FORBIDDEN_CROSS_CARRIER_JOIN_TARGETS,
  PERMITTED_CROSS_CARRIER_JOIN,
  PROOF_GRAPH_CARRIER_ORDER,
  PROOF_GRAPH_COMPOSITION_SCHEMA_VERSION,
  ProofGraphCompositionError,
  composeProofGraphCarrierSet
};
