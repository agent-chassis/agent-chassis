import { validateCompleteNativeContract, validateCompleteNativeTestProof } from './native-test-proof-authoring.mjs';
import {
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  sha256,
  unsupportedObjectKeys
} from "./deterministic-projection-primitives.mjs";
import { projectBoundedDiagnostics } from "./bounded-diagnostic-projection.mjs";
import { validateStableV1ContractFamily } from "./stable-v1-family-validation.mjs";
import STABLE_CONTRACT_SCHEMA from "./stable-contract-schema-v1.mjs";
import {
  NODE_TEST_SELECTOR_KIND,
  PROVIDER_REFUSAL_PRECEDENCE,
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  resolveNativeTestSelector,
  resolveTestProofProviderCompatibility,
  testProofFalsifierProvider,
  testProofProviderFamily,
  testProofSelectorKind,
  testProofStrategySelectorKinds
} from "./test-proof-provider-registry.mjs";

const STABLE_TEST_PROOF_AUTHORING_LIMITS = Object.freeze({
  verification_ids: 64,
  replacement_operations: 64,
  verification_bundle_operations: 64,
  query_result_bytes: 16384,
  diagnostic_items: 64,
  diagnostic_envelope_bytes: 65536,
  diagnostic_encoded_field_bytes: 4096
});
const WORK_RECORD_ID_RE = /^WK-[0-9]{4}$/u;
const CONTROLLED_CONTRACT_FOCUS_RE =
  /^(?!wk-[0-9])(?!slice-[0-9]+$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONTROLLED_CONTRACT_AUTHORING_QUERY_TOOL =
  "workspace_controlled_contract_obligation_coverage_query";

const REFUSAL_ORDER = Object.freeze([
  "stable_test_proof_input_invalid",
  "stable_family_experimental_substitution",
  "stable_family_identity_unknown",
  "stable_family_mixed_state",
  "stable_family_partial_state",
  "stable_family_schema_invalid",
  "stable_test_proof_selector_invalid",
  "stable_test_proof_contract_invalid",
  "stable_test_proof_verification_ids_invalid",
  "stable_test_proof_verification_unknown",
  "stable_test_proof_verification_not_test_execution",
  "stable_test_proof_query_too_large",
  "stable_test_proof_replacements_invalid",
  "stable_test_proof_replacement_target_missing",
  "stable_test_proof_replacement_identity_mismatch",
  "stable_test_proof_replacement_duplicate",
  "stable_test_proof_replacement_result_invalid",
  "stable_verification_bundle_input_invalid",
  "stable_verification_bundle_operations_invalid",
  "stable_verification_bundle_identity_mismatch",
  "stable_verification_bundle_claim_invalid",
  "stable_verification_bundle_proof_invalid",
  "stable_verification_bundle_duplicate",
  "stable_verification_bundle_partial_current",
  "stable_verification_bundle_content_mismatch",
  "stable_verification_bundle_proof_replacement_forbidden",
  "stable_verification_bundle_removal_external_reference",
  "stable_verification_bundle_result_invalid",
  ...PROVIDER_REFUSAL_PRECEDENCE
]);

class StableTestProofContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StableTestProofContractError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

function diagnostic(code, pointer, expected = null, actual = null, message = code) {
  return { code, pointer, keyword: "stableTestProofAuthoring",
    reason_code: "stable_test_proof_refused", expected_identity: expected,
    actual_identity: actual, message };
}

function refuse(code, pointer, expected = null, actual = null, diagnostics = null) {
  const envelope = diagnostics ?? projectBoundedDiagnostics([
    diagnostic(code, pointer, expected, actual)
  ]);
  throw new StableTestProofContractError(code, code, { diagnostics: envelope });
}

function assertClosedInput(value, allowed, pointer = "/") {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse(
    "stable_test_proof_input_invalid", pointer, "closed object", value ?? null
  );
  const unsupported = unsupportedObjectKeys(value, allowed);
  if (unsupported.length > 0) refuse("stable_test_proof_input_invalid", pointer,
    allowed, unsupported);
}

const VERIFICATION_BUNDLE_SCHEMA_VERSION =
  "controlled-contract-verification-bundle.v1";
const VERIFICATION_BUNDLE_FIELDS = Object.freeze([
  "schema_version", "verification_id", "references", "propositions", "claims",
  "relations", "collections", "residue", "annotations", "test_proof"
]);
const BUNDLE_POPULATIONS = Object.freeze([
  ["references", "reference_id"],
  ["propositions", "proposition_id"],
  ["claims", "claim_id"],
  ["relations", "relation_id"],
  ["collections", "collection_id"],
  ["residue", "residue_id"],
  ["annotations", "annotation_id"]
]);

function bundleDiagnostic(code, pointer, expected = null, actual = null) {
  return diagnostic(code, pointer, expected, actual, code);
}

function refuseBundle(code, diagnostics) {
  refuse(code, diagnostics[0]?.pointer ?? "/", diagnostics[0]?.expected_identity ?? null,
    diagnostics[0]?.actual_identity ?? null, projectBoundedDiagnostics(diagnostics));
}

function assertVerificationBundle(bundle, verificationId, pointer) {
  const diagnostics = [];
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    refuseBundle("stable_verification_bundle_input_invalid", [bundleDiagnostic(
      "stable_verification_bundle_input_invalid", pointer, "closed bundle object",
      bundle ?? null
    )]);
  }
  const unsupported = unsupportedObjectKeys(bundle, VERIFICATION_BUNDLE_FIELDS);
  for (const key of unsupported) diagnostics.push(bundleDiagnostic(
    "stable_verification_bundle_input_invalid", `${pointer}/${key}`, null, key
  ));
  for (const field of VERIFICATION_BUNDLE_FIELDS) if (!Object.hasOwn(bundle, field)) {
    diagnostics.push(bundleDiagnostic(
      "stable_verification_bundle_input_invalid", `${pointer}/${field}`,
      "required caller-authored field", null
    ));
  }
  if (diagnostics.length > 0) refuseBundle(
    "stable_verification_bundle_input_invalid", diagnostics
  );
  if (bundle.schema_version !== VERIFICATION_BUNDLE_SCHEMA_VERSION) diagnostics.push(
    bundleDiagnostic("stable_verification_bundle_input_invalid",
      `${pointer}/schema_version`, VERIFICATION_BUNDLE_SCHEMA_VERSION,
      bundle.schema_version ?? null)
  );
  if (typeof bundle.verification_id !== "string" || bundle.verification_id.length === 0 ||
      bundle.verification_id !== verificationId) diagnostics.push(bundleDiagnostic(
    "stable_verification_bundle_identity_mismatch", `${pointer}/verification_id`,
    verificationId, bundle.verification_id ?? null
  ));
  for (const [population, identityField] of BUNDLE_POPULATIONS) {
    if (!Array.isArray(bundle[population])) {
      diagnostics.push(bundleDiagnostic("stable_verification_bundle_input_invalid",
        `${pointer}/${population}`, "array", bundle[population] ?? null));
      continue;
    }
    const identities = [];
    for (const [index, entry] of bundle[population].entries()) {
      const identity = entry?.[identityField];
      if (typeof identity !== "string" || identity.length === 0) diagnostics.push(
        bundleDiagnostic("stable_verification_bundle_input_invalid",
          `${pointer}/${population}/${index}/${identityField}`, "nonempty identity",
          identity ?? null)
      );
      else identities.push(identity);
    }
    const duplicate = identities.find((identity, index) => identities.indexOf(identity) !== index);
    if (duplicate) diagnostics.push(bundleDiagnostic(
      "stable_verification_bundle_duplicate", `${pointer}/${population}`,
      "unique identities", duplicate
    ));
  }
  const matchingClaims = Array.isArray(bundle.claims) ? bundle.claims.filter((claim) =>
    claim?.claim_id === verificationId && claim?.kind === "verification" &&
    claim?.verification_method === "test_execution") : [];
  if (matchingClaims.length !== 1) diagnostics.push(bundleDiagnostic(
    "stable_verification_bundle_claim_invalid", `${pointer}/claims`,
    `exactly one test_execution verification claim named ${verificationId}`,
    matchingClaims.length
  ));
  if (!bundle.test_proof || typeof bundle.test_proof !== "object" ||
      Array.isArray(bundle.test_proof) ||
      bundle.test_proof.verification_claim_id !== verificationId) diagnostics.push(
    bundleDiagnostic("stable_verification_bundle_proof_invalid", `${pointer}/test_proof`,
      `complete proof bound to ${verificationId}`,
      bundle.test_proof?.verification_claim_id ?? null)
  );
  if (diagnostics.length > 0) refuseBundle(diagnostics[0].code, diagnostics);
  resolveStableTestProofProviderBindings(bundle.test_proof);
}

function assertVerificationBundleOperations(operations) {
  if (!Array.isArray(operations) || operations.length < 1 ||
      operations.length > STABLE_TEST_PROOF_AUTHORING_LIMITS.verification_bundle_operations) {
    refuse("stable_verification_bundle_operations_invalid", "/operations",
      "1..64 operations", operations);
  }
  const identities = [];
  for (const [index, operation] of operations.entries()) {
    const pointer = `/operations/${index}`;
    assertClosedInput(operation, ["op", "verification_id", "bundle"], pointer);
    if (!["upsert", "remove"].includes(operation.op) ||
        typeof operation.verification_id !== "string" ||
        operation.verification_id.length === 0) refuse(
      "stable_verification_bundle_operations_invalid", pointer,
      "closed upsert/remove operation with nonempty verification_id", operation
    );
    assertVerificationBundle(operation.bundle, operation.verification_id,
      `${pointer}/bundle`);
    identities.push(operation.verification_id);
  }
  const duplicate = identities.find((identity, index) => identities.indexOf(identity) !== index);
  if (duplicate) refuse("stable_verification_bundle_duplicate", "/operations",
    "one operation per verification identity", duplicate);
}

function jsonEqual(left, right) {
  return canonicalJsonBytes(left).equals(canonicalJsonBytes(right));
}

function bundlePresence(contract, bundle) {
  const rows = [];
  for (const [population, identityField] of BUNDLE_POPULATIONS) {
    const current = new Map(contract[population].map((entry) => [entry[identityField], entry]));
    for (const entry of bundle[population]) {
      const observed = current.get(entry[identityField]);
      rows.push({ population, identity: entry[identityField], expected: entry,
        observed: observed ?? null, present: observed !== undefined,
        exact: observed !== undefined && jsonEqual(observed, entry) });
    }
  }
  const proof = contract.test_proofs.find(({ verification_claim_id: id }) =>
    id === bundle.verification_id);
  rows.push({ population: "test_proofs", identity: bundle.verification_id,
    expected: bundle.test_proof, observed: proof ?? null, present: proof !== undefined,
    exact: proof !== undefined && jsonEqual(proof, bundle.test_proof) });
  return rows;
}

function appendVerificationBundle(contract, bundle) {
  for (const [population] of BUNDLE_POPULATIONS) {
    contract[population].push(...structuredClone(bundle[population]));
  }
  contract.test_proofs.push(structuredClone(bundle.test_proof));
  contract.test_proofs.sort((left, right) => compareCodeUnits(
    left.verification_claim_id, right.verification_claim_id
  ));
}

function removeVerificationBundle(contract, bundle) {
  for (const [population, identityField] of BUNDLE_POPULATIONS) {
    const removed = new Set(bundle[population].map((entry) => entry[identityField]));
    contract[population] = contract[population].filter((entry) =>
      !removed.has(entry[identityField]));
  }
  contract.test_proofs = contract.test_proofs.filter(({ verification_claim_id: id }) =>
    id !== bundle.verification_id);
}

function nodeKey(population, identity) {
  return `${population}\0${identity}`;
}

function bundleNodeKeys(bundle) {
  const keys = new Set(BUNDLE_POPULATIONS.flatMap(([population, identityField]) =>
    bundle[population].map((entry) => nodeKey(population, entry[identityField]))
  ));
  keys.add(nodeKey("test_proofs", bundle.verification_id));
  return keys;
}

function carrierNodeReferences(contract) {
  const references = [];
  const add = (fromPopulation, fromIdentity, toPopulation, identities) => {
    for (const identity of identities.filter(Boolean)) references.push({
      from: nodeKey(fromPopulation, fromIdentity),
      to: nodeKey(toPopulation, identity)
    });
  };
  for (const proposition of contract.propositions) {
    const referenced = [
      proposition.subject_reference_id,
      ...(proposition.applicability_context?.operand_reference_ids ?? []),
      ...(proposition.operands ?? []).map(({ reference_id: identity }) => identity)
    ];
    add("propositions", proposition.proposition_id, "references", referenced);
  }
  for (const claim of contract.claims) add("claims", claim.claim_id, "propositions", [
    claim.proposition_id, claim.falsifying_proposition_id
  ]);
  for (const relation of contract.relations) add("relations", relation.relation_id,
    "claims", [relation.source_claim_id, relation.target_claim_id]);
  for (const collection of contract.collections) add("collections", collection.collection_id,
    "claims", collection.member_claim_ids ?? []);
  for (const proof of contract.test_proofs) {
    const proofKey = proof.verification_claim_id;
    add("test_proofs", proofKey, "claims", [proof.verification_claim_id]);
    add("test_proofs", proofKey, "references",
      proof.system_under_test_boundary?.subject_reference_ids ?? []);
    add("test_proofs", proofKey, "propositions", [
      proof.observable_result?.proposition_id,
      ...(proof.falsifiers ?? []).map(({ proposition_id: identity }) => identity)
    ]);
  }
  return references;
}

function inspectionReplacementGraph(contract, verificationId) {
  const claim = contract.claims.find(({ claim_id: identity }) => identity === verificationId);
  if (!claim || claim.kind !== "verification" ||
      !["inspection", "analysis"].includes(claim.verification_method)) return null;
  const propositionIds = new Set([
    claim.proposition_id, claim.falsifying_proposition_id
  ].filter(Boolean));
  const rootClaimKey = nodeKey("claims", verificationId);
  const references = carrierNodeReferences(contract);
  const exclusivePropositionIds = new Set([...propositionIds].filter((identity) =>
    references.every(({ from, to }) =>
      to !== nodeKey("propositions", identity) || from === rootClaimKey)
  ));
  const externallyReferenced = new Set([...propositionIds].filter((identity) =>
    !exclusivePropositionIds.has(identity)
  ).map((identity) => nodeKey("propositions", identity)));
  const graph = {
    references: [],
    propositions: contract.propositions.filter(({ proposition_id: identity }) =>
      exclusivePropositionIds.has(identity)),
    claims: [claim],
    relations: contract.relations.filter(({ source_claim_id: source,
      target_claim_id: target }) => source === verificationId || target === verificationId),
    collections: contract.collections.filter(({ member_claim_ids: members }) =>
      members.length > 0 && members.every((identity) => identity === verificationId)),
    residue: [],
    annotations: []
  };
  const replacedCollectionIds = new Set(graph.collections.map(
    ({ collection_id: identity }) => identity
  ));
  const preservedReferrers = new Set(contract.collections.filter(
    ({ collection_id: identity, member_claim_ids: members }) =>
      members.includes(verificationId) && !replacedCollectionIds.has(identity)
  ).map(({ collection_id: identity }) => nodeKey("collections", identity)));
  return { graph, externallyReferenced, preservedReferrers, retired: bundleNodeKeys({
    ...graph,
    verification_id: verificationId,
    test_proof: { verification_claim_id: verificationId }
  }) };
}

function removeInspectionReplacementGraph(contract, replacement) {
  for (const [population, identityField] of BUNDLE_POPULATIONS) {
    const removed = new Set(replacement.graph[population].map(
      (entry) => entry[identityField]
    ));
    contract[population] = contract[population].filter(
      (entry) => !removed.has(entry[identityField])
    );
  }
}

function assertFinalReferenceSafety(contract, retirements) {
  const references = carrierNodeReferences(contract);
  for (const retirement of retirements) {
    const external = references.find(({ from, to }) =>
      retirement.retired.has(to) && !retirement.allowedReferrers.has(from));
    if (external) refuse("stable_verification_bundle_removal_external_reference",
      retirement.pointer, "no final external references to replaced or removed nodes",
      { from: external.from, to: external.to });
  }
}

function applyStableVerificationBundles(options) {
  assertClosedInput(options, ["contract", "operations"]);
  const { contract, operations } = options;
  assertValidStableContract(contract, true);
  assertVerificationBundleOperations(operations);
  const prospective = structuredClone(contract);
  const changed = [];
  const retirements = [];
  for (const [index, operation] of operations.entries()) {
    const rows = bundlePresence(prospective, operation.bundle);
    const present = rows.filter((row) => row.present);
    const mismatched = present.filter((row) => !row.exact);
    if (operation.op === "upsert") {
      const replacement = inspectionReplacementGraph(prospective,
        operation.verification_id);
      if (replacement) {
        const replacementKeys = replacement.retired;
        const unrelatedPresence = present.filter(({ population, identity }) =>
          !replacementKeys.has(nodeKey(population, identity)));
        if (unrelatedPresence.some(({ population, identity }) =>
          replacement.externallyReferenced.has(nodeKey(population, identity)))) refuse(
          "stable_verification_bundle_removal_external_reference",
          `/operations/${index}/bundle`,
          "no external references to replaced verification graph nodes",
          unrelatedPresence.map(({ population, identity }) => ({ population, identity })));
        if (unrelatedPresence.length > 0) refuse(
          "stable_verification_bundle_partial_current",
          `/operations/${index}/bundle`, "absence outside the replaceable verification graph",
          unrelatedPresence.map(({ population, identity }) => ({ population, identity })));
        removeInspectionReplacementGraph(prospective, replacement);
        appendVerificationBundle(prospective, operation.bundle);
        retirements.push({
          retired: replacement.retired,
          allowedReferrers: new Set([
            ...bundleNodeKeys(operation.bundle), ...replacement.preservedReferrers
          ]),
          pointer: `/operations/${index}/bundle`
        });
        changed.push(operation.verification_id);
        continue;
      }
      if (mismatched.some(({ population }) => population === "test_proofs")) refuse(
        "stable_verification_bundle_proof_replacement_forbidden",
        `/operations/${index}/bundle/test_proof`,
        "guarded prepare-design verification_bundle continuation",
        operation.verification_id
      );
      if (mismatched.length > 0) refuse("stable_verification_bundle_content_mismatch",
        `/operations/${index}/bundle/${mismatched[0].population}`,
        mismatched[0].expected, mismatched[0].observed);
      if (present.length === rows.length) continue;
      if (present.length > 0) refuse("stable_verification_bundle_partial_current",
        `/operations/${index}/bundle`, "total absence or exact complete presence",
        present.map(({ population, identity }) => ({ population, identity })));
      appendVerificationBundle(prospective, operation.bundle);
      changed.push(operation.verification_id);
      continue;
    }
    if (mismatched.length > 0) refuse("stable_verification_bundle_content_mismatch",
      `/operations/${index}/bundle/${mismatched[0].population}`,
      mismatched[0].expected, mismatched[0].observed);
    if (present.length !== rows.length) refuse("stable_verification_bundle_partial_current",
      `/operations/${index}/bundle`, "exact complete current bundle",
      present.map(({ population, identity }) => ({ population, identity })));
    removeVerificationBundle(prospective, operation.bundle);
    retirements.push({
      retired: bundleNodeKeys(operation.bundle),
      allowedReferrers: new Set(),
      pointer: `/operations/${index}/bundle`
    });
    changed.push(operation.verification_id);
  }
  assertFinalReferenceSafety(prospective, retirements);
  const validation = validateStableV1ContractFamily(prospective);
  if (!validation.valid) refuse("stable_verification_bundle_result_invalid", "/operations",
    "valid complete stable carrier", "invalid", validation.diagnostics);
  const canonical = JSON.parse(canonicalJsonBytes(prospective).toString("utf8"));
  return deepFreeze({
    contract: canonical,
    contract_digest: `sha256:${sha256(canonicalJsonBytes(canonical))}`,
    changed_verification_ids: [...new Set(changed)].sort(compareCodeUnits),
    semantic_judgment: "not_performed_authoring_only"
  });
}

function validateStableTestProofContract(contract) {
  const family = validateStableV1ContractFamily(contract);
  if (!family.valid) return family;
  const complete = validateCompleteNativeContract(contract);
  const completeness = complete ? [] : structuredClone(validateCompleteNativeContract.errors).map(error => ({
    code: 'stable_test_proof_incomplete', pointer: error.instancePath || '/', ...error }));
  for (const claim of contract.claims) if (claim.kind === 'verification' && claim.verification_method === 'test_execution' &&
      !contract.test_proofs.some(proof => proof.verification_claim_id === claim.claim_id)) completeness.push({
    code: 'stable_test_proof_missing', pointer: '/test_proofs', expected_identity: claim.claim_id });
  for (const proof of contract.test_proofs) if (!contract.claims.some(claim => claim.claim_id === proof.verification_claim_id)) {
    completeness.push({ code: 'stable_test_proof_claim_unknown', pointer: '/test_proofs', actual_identity: proof.verification_claim_id });
  }
  const failures = [...completeness, ...contract.test_proofs.flatMap((binding, index) => [
    ...(selectorDiagnostic(binding?.test_selector) === null ? [] : [{
      ...selectorDiagnostic(binding.test_selector),
      pointer: `/test_proofs/${index}/test_selector`
    }]),
    ...providerResolutionEntries(binding).filter(({ result }) => !result.valid).map(
      ({ result }) => ({
        ...result.diagnostic,
        pointer: `/test_proofs/${index}${result.diagnostic.pointer}`
      })
    )
  ])].sort((left, right) =>
    REFUSAL_ORDER.indexOf(left.code) - REFUSAL_ORDER.indexOf(right.code) ||
    compareCodeUnits(left.pointer, right.pointer)
  );
  if (failures.length === 0) return family;
  return deepFreeze({
    ...family,
    valid: false,
    diagnostics: projectBoundedDiagnostics(failures),
    diagnostic_details: Object.freeze(structuredClone(failures))
  });
}

const TEST_SELECTOR_FIELDS = Object.freeze(["name", "nesting"]);
const TEST_SELECTOR_NAME_MAX_LENGTH = 512;
const TEST_SELECTOR_NESTING_MAX = 64;

function selectorDiagnostic(selector) {
  const expected = "closed { name: nonempty string, nesting: 0..64 } selector or closed { provider_id, provider_version, node_id } native selector";
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    return diagnostic("stable_test_proof_selector_invalid", "/test_selector",
      expected, selector ?? null);
  }
  if (testProofSelectorKind(selector) !== NODE_TEST_SELECTOR_KIND ||
      Object.hasOwn(selector, "node_id")) {
    const native = resolveNativeTestSelector(selector);
    return native.valid ? null : diagnostic("stable_test_proof_selector_invalid",
      native.pointer, native.expected_identity, native.actual_identity);
  }
  const unsupported = unsupportedObjectKeys(selector, TEST_SELECTOR_FIELDS);
  if (unsupported.length > 0) return diagnostic("stable_test_proof_selector_invalid",
    "/test_selector", TEST_SELECTOR_FIELDS, unsupported);
  if (typeof selector.name !== "string" || selector.name.length === 0 ||
      selector.name.length > TEST_SELECTOR_NAME_MAX_LENGTH) {
    return diagnostic("stable_test_proof_selector_invalid", "/test_selector/name",
      expected, selector.name ?? null);
  }
  if (!Number.isSafeInteger(selector.nesting) || selector.nesting < 0 ||
      selector.nesting > TEST_SELECTOR_NESTING_MAX) {
    return diagnostic("stable_test_proof_selector_invalid", "/test_selector/nesting",
      expected, selector.nesting ?? null);
  }
  return null;
}

function projectStableTestProofSelector(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) refuse(
    "stable_test_proof_selector_invalid", "/", "complete test-proof binding",
    binding ?? null
  );
  const failure = selectorDiagnostic(binding.test_selector);
  if (failure !== null) refuse(failure.code, failure.pointer,
    failure.expected_identity, failure.actual_identity);
  if (testProofSelectorKind(binding.test_selector) !== NODE_TEST_SELECTOR_KIND) {
    const native = resolveNativeTestSelector(binding.test_selector);
    return deepFreeze({ selector_kind: native.selector_kind, provider_id: native.provider_id,
      provider_version: native.provider_version, node_id: native.node_id, path: native.path });
  }
  return deepFreeze({
    name: binding.test_selector.name,
    nesting: binding.test_selector.nesting
  });
}

function buildStableTestProofRecoveryCall({ wkId, focus = null } = {}) {
  if (typeof wkId !== "string" || !WORK_RECORD_ID_RE.test(wkId) ||
      (focus !== null && (typeof focus !== "string" ||
        !CONTROLLED_CONTRACT_FOCUS_RE.test(focus)))) {
    throw new StableTestProofContractError(
      "stable_test_proof_recovery_subject_invalid",
      "stable test-proof recovery requires one server-resolved canonical subject",
      { wk_id: typeof wkId === "string" ? wkId : null, focus }
    );
  }
  return deepFreeze({
    tool: CONTROLLED_CONTRACT_AUTHORING_QUERY_TOOL,
    arguments: {
      unit: wkId,
      ...(focus === null ? {} : { focus })
    }
  });
}

function assertValidStableContract(contract, authoring = false) {
  const result = authoring ? validateStableV1ContractFamily(contract) : validateStableTestProofContract(contract);
  if (!result.valid) {
    const first = result.diagnostics.diagnostics[0];
    const code = first?.code?.startsWith("stable_family_") ? first.code
      : "stable_test_proof_contract_invalid";
    refuse(code, first?.pointer ?? "/", first?.expected_identity ?? null,
      first?.actual_identity ?? null, result.diagnostics);
  }
  return result;
}

function canonicalStableTestProofContractJson(contract) {
  assertValidStableContract(contract);
  return canonicalJsonBytes(contract, { file: true }).toString("utf8");
}

function providerResolutionEntries(binding) {

  const selectorKind = testProofSelectorKind(binding?.test_selector) ?? undefined;
  const rows = [{
    role: "candidate_execution_provider",
    pointer: "/candidate_execution_provider",
    result: resolveTestProofProviderCompatibility({
      provider: binding?.candidate_execution_provider,
      capability: "candidate_execution",
      pointer: "/candidate_execution_provider",
      selector_kind: selectorKind
    })
  }];
  for (const [index, falsifier] of (binding?.falsifiers ?? []).entries()) rows.push({
    role: `falsifier:${falsifier?.falsifier_id ?? index}`,
    pointer: `/falsifiers/${index}/execution_provider`,
    result: resolveTestProofProviderCompatibility({
      provider: falsifier?.execution_provider,
      capability: "falsifier_execution",
      pointer: `/falsifiers/${index}/execution_provider`,
      strategy: falsifier?.strategy,
      observation_mechanism: falsifier?.mutation?.mechanism,
      boundary_kind: falsifier?.mutation?.target_kind,
      selector_kind: selectorKind
    })
  });
  const traversal = binding?.traversal_provider;
  if (traversal?.mode === "registry_unsupported") {
    rows.push({ role: "traversal_provider", pointer: "/traversal_provider",
      result: resolveTestProofProviderCompatibility({
        provider: { ...traversal,
          capability: "traversal_unsupported",
          capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST },
        capability: "traversal_unsupported",
        pointer: "/traversal_provider"
      }) });
  } else {
    const compatibility = resolveTestProofProviderCompatibility({
      provider: traversal,
      capability: "boundary_traversal",
      pointer: "/traversal_provider",
      observation_mechanism: traversal?.observation_mechanism,
      observation_seam: traversal?.observation_seam,
      evidence_artifact_types: traversal?.evidence_artifact_type === undefined
        ? undefined : [traversal.evidence_artifact_type],
      boundary_kind: traversal?.boundary_kind,
      selector_kind: selectorKind
    });
    const systemBoundaryKind = binding?.system_under_test_boundary?.kind;
    const boundaryMismatchCode = PROVIDER_REFUSAL_PRECEDENCE[10];
    const kindResult = compatibility.valid && systemBoundaryKind !== traversal?.boundary_kind
      ? deepFreeze({
        valid: false,
        code: boundaryMismatchCode,
        diagnostic: {
          code: boundaryMismatchCode,
          pointer: "/traversal_provider/boundary_kind",
          keyword: "providerCompatibility",
          reason_code: "stable_test_proof_provider_refused",
          expected_identity: systemBoundaryKind ?? null,
          actual_identity: traversal?.boundary_kind ?? null,
          message: boundaryMismatchCode
        },
        descriptor: null
      })
      : compatibility;
    rows.push({ role: "traversal_provider", pointer: "/traversal_provider",
      result: kindResult });
  }
  return rows;
}

function resolveStableTestProofProviderBindings(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) refuse(
    "stable_test_proof_provider_missing", "/", "complete test-proof binding",
    binding ?? null
  );
  if (!validateCompleteNativeTestProof(binding)) refuse('stable_test_proof_incomplete', '/',
    'complete execution binding', binding, structuredClone(validateCompleteNativeTestProof.errors));
  const rows = providerResolutionEntries(binding);
  const failures = rows.filter(({ result }) => !result.valid).sort((left, right) =>
    PROVIDER_REFUSAL_PRECEDENCE.indexOf(left.result.code) -
      PROVIDER_REFUSAL_PRECEDENCE.indexOf(right.result.code) ||
    compareCodeUnits(left.pointer, right.pointer)
  );
  if (failures.length > 0) {
    const first = failures[0].result;
    refuse(first.code, first.diagnostic.pointer,
      first.diagnostic.expected_identity, first.diagnostic.actual_identity,
      projectBoundedDiagnostics(failures.map(({ result }) => result.diagnostic)));
  }
  return deepFreeze({
    valid: true,
    registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
    registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    bindings: rows.map(({ role, result }) => ({ role,
      provider_id: result.descriptor?.provider_id ?? null,
      provider_version: result.descriptor?.provider_version ?? null }))
  });
}

function assertVerificationIds(verificationIds) {
  if (!Array.isArray(verificationIds) || verificationIds.length < 1 ||
      verificationIds.length > STABLE_TEST_PROOF_AUTHORING_LIMITS.verification_ids ||
      new Set(verificationIds).size !== verificationIds.length ||
      verificationIds.some((id) => typeof id !== "string" || id.length === 0)) refuse(
    "stable_test_proof_verification_ids_invalid", "/verificationIds",
    "1..64 unique nonempty strings", verificationIds
  );
}

function selectStableTestProofBindings(options, schemaVersion) {
  assertClosedInput(options, ["contract", "verificationIds"]);
  const { contract, verificationIds } = options;
  assertValidStableContract(contract, true);
  assertVerificationIds(verificationIds);
  const claims = new Map(contract.claims.map((claim) => [claim.claim_id, claim]));
  const proofs = new Map(contract.test_proofs.map((proof) =>
    [proof.verification_claim_id, proof]));
  for (const verificationId of verificationIds) {
    const claim = claims.get(verificationId);
    if (!claim) refuse("stable_test_proof_verification_unknown", "/verificationIds",
      "same-carrier verification claim", verificationId);
    if (claim.kind !== "verification" || claim.verification_method !== "test_execution") {
      refuse("stable_test_proof_verification_not_test_execution", "/verificationIds",
        "test_execution verification claim", verificationId);
    }
  }
  for (const verificationId of verificationIds) {
    if (!proofs.has(verificationId)) refuse("stable_test_proof_incomplete", "/test_proofs", "complete selected binding", verificationId);
    resolveStableTestProofProviderBindings(proofs.get(verificationId));
  }
  const bindings = [...verificationIds].sort(compareCodeUnits).map((id) =>
    structuredClone(proofs.get(id)));
  return deepFreeze({
    schema_version: schemaVersion,
    status: "complete",
    contract_schema_version: contract.schema_version,
    contract_digest: `sha256:${sha256(canonicalJsonBytes(contract))}`,
    requested_count: verificationIds.length,
    matched_count: bindings.length,
    bindings,
    semantic_judgment: "not_performed_authoring_only"
  });
}

function resolveStableTestProofBindingPopulation(options) {
  return selectStableTestProofBindings(
    options,
    "controlled-contract-test-proof-runtime-binding-population.v1"
  );
}

function queryStableTestProofBindings(options) {
  const result = selectStableTestProofBindings(
    options,
    "controlled-contract-test-proof-query.v1"
  );
  if (canonicalJsonBytes(result).byteLength >
      STABLE_TEST_PROOF_AUTHORING_LIMITS.query_result_bytes) refuse(
    "stable_test_proof_query_too_large", "/bindings",
    STABLE_TEST_PROOF_AUTHORING_LIMITS.query_result_bytes,
    canonicalJsonBytes(result).byteLength
  );
  return result;
}

function assertReplacements(replacements) {
  if (!Array.isArray(replacements) || replacements.length < 1 ||
      replacements.length > STABLE_TEST_PROOF_AUTHORING_LIMITS.replacement_operations) {
    refuse("stable_test_proof_replacements_invalid", "/replacements",
      "1..64 replacement operations", replacements);
  }
  const ids = [];
  for (const [index, operation] of replacements.entries()) {
    assertClosedInput(operation, ["op", "verification_id", "binding"],
      `/replacements/${index}`);
    if (operation.op !== "replace" || typeof operation.verification_id !== "string" ||
        !operation.binding || typeof operation.binding !== "object") refuse(
      "stable_test_proof_replacements_invalid", `/replacements/${index}`,
      "closed replace operation", operation
    );
    if (operation.binding.verification_claim_id !== operation.verification_id) refuse(
      "stable_test_proof_replacement_identity_mismatch", `/replacements/${index}/binding`,
      operation.verification_id, operation.binding.verification_claim_id ?? null
    );
    ids.push(operation.verification_id);
  }
  if (new Set(ids).size !== ids.length) refuse("stable_test_proof_replacement_duplicate",
    "/replacements", "unique verification targets", ids);
}

function replaceStableTestProofBindings(options) {
  assertClosedInput(options, ["contract", "replacements"]);
  const { contract, replacements } = options;
  assertValidStableContract(contract, true);
  assertReplacements(replacements);
  const proofIndex = new Map(contract.test_proofs.map((proof, index) =>
    [proof.verification_claim_id, index]));
  for (const operation of replacements) {
    if (!proofIndex.has(operation.verification_id)) refuse(
      "stable_test_proof_replacement_target_missing", "/replacements",
      "existing same-carrier test proof", operation.verification_id
    );
    resolveStableTestProofProviderBindings(operation.binding);
  }
  const prospective = structuredClone(contract);
  for (const operation of replacements) prospective.test_proofs[
    proofIndex.get(operation.verification_id)
  ] = structuredClone(operation.binding);
  prospective.test_proofs.sort((left, right) => compareCodeUnits(
    left.verification_claim_id, right.verification_claim_id
  ));
  const validation = validateStableV1ContractFamily(prospective);
  if (!validation.valid) refuse("stable_test_proof_replacement_result_invalid",
    "/test_proofs", "valid complete stable carrier", "invalid",
    validation.diagnostics);
  return deepFreeze({
    contract: prospective,
    contract_digest: `sha256:${sha256(canonicalJsonBytes(prospective))}`,
    changed_verification_ids: replacements.map(({ verification_id: id }) => id)
      .sort(compareCodeUnits),
    semantic_judgment: "not_performed_authoring_only"
  });
}

const CURRENT_DEFINITION_REAUTHORING_SCHEMA =
  "controlled-contract-current-definition-reauthoring.v1";
const RETIRED_CURRENT_DEFINITION_FIELDS = Object.freeze([
  "coverage_disposition",
  "runtime_test_identity"
]);

function currentDefinitionDiagnosticRows(diagnosticDetails) {
  return Array.isArray(diagnosticDetails) ? diagnosticDetails : [];
}

function qualifyStableCurrentDefinitionReauthoring({ contract, diagnosticDetails }) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract) ||
      contract.schema_version !== "controlled-acceptance-contract.v1" ||
      contract.vocabulary_version !== "controlled-contract-vocabulary.v1" ||
      contract.profile_id !== "acceptance-contract.standard.v1" ||
      contract.test_proof_version !== "controlled-contract-test-proof.v1" ||
      !Array.isArray(contract.test_proofs)) return null;
  const rows = currentDefinitionDiagnosticRows(diagnosticDetails);
  if (rows.length === 0) return null;
  const retired = new Set(RETIRED_CURRENT_DEFINITION_FIELDS);
  const byPointer = new Map();
  let retiredFieldCount = 0;
  for (const row of rows) {
    const pointer = row?.definition_pointer;
    const supportedUnexpected = row?.keyword === "additionalProperties" &&
      row.property_kind === "unexpected" && retired.has(row.property_name);
    const supportedMissing = row?.keyword === "required" &&
      row.property_kind === "missing" && row.property_name === "test_selector";
    if (row?.code !== "stable_contract_schema_invalid" ||
        typeof pointer !== "string" ||
        !/^\/test_proofs\/[0-9]+$/u.test(pointer) ||
        (!supportedUnexpected && !supportedMissing)) return null;
    const proofIndex = Number(pointer.slice("/test_proofs/".length));
    const pointedProof = contract.test_proofs[proofIndex];
    if (!pointedProof || typeof pointedProof !== "object" ||
        (row.test_proof_id !== null && row.test_proof_id !== undefined &&
          row.test_proof_id !== pointedProof.test_proof_id) ||
        (row.verification_claim_id !== null && row.verification_claim_id !== undefined &&
          row.verification_claim_id !== pointedProof.verification_claim_id)) return null;
    if (supportedUnexpected) retiredFieldCount += 1;
    const current = byPointer.get(pointer) ?? { unexpected: [], missing: [] };
    (supportedUnexpected ? current.unexpected : current.missing).push(row.property_name);
    byPointer.set(pointer, current);
  }
  if (retiredFieldCount === 0) return null;

  const proofIds = new Set();
  const verificationIds = new Set();
  const definitions = [];
  for (const [index, proof] of contract.test_proofs.entries()) {
    if (!proof || typeof proof !== "object" || Array.isArray(proof) ||
        typeof proof.test_proof_id !== "string" || proof.test_proof_id.length === 0 ||
        typeof proof.verification_claim_id !== "string" ||
        proof.verification_claim_id.length === 0 ||
        proofIds.has(proof.test_proof_id) ||
        verificationIds.has(proof.verification_claim_id)) return null;
    proofIds.add(proof.test_proof_id);
    verificationIds.add(proof.verification_claim_id);
    const pointer = `/test_proofs/${index}`;
    const defects = byPointer.get(pointer);
    if (defects === undefined) continue;
    const unexpected = [...new Set(defects.unexpected)].sort(compareCodeUnits);
    const missing = [...new Set(defects.missing)].sort(compareCodeUnits);
    if (unexpected.length === 0 || missing.length !== 1 ||
        missing[0] !== "test_selector" ||
        unexpected.some((field) => !Object.hasOwn(proof, field)) ||
        Object.hasOwn(proof, "test_selector")) {
      return null;
    }
    definitions.push(Object.freeze({
      definition_pointer: pointer,
      test_proof_id: proof.test_proof_id,
      verification_claim_id: proof.verification_claim_id,
      unexpected_fields: Object.freeze(unexpected),
      missing_fields: Object.freeze(missing)
    }));
  }
  if (definitions.length !== byPointer.size || definitions.length === 0) return null;
  return deepFreeze({
    schema_version: CURRENT_DEFINITION_REAUTHORING_SCHEMA,
    source_shape: "stable_v1_retired_definition_fields",
    affected_definition_count: definitions.length,
    definitions,
    selector: structuredClone(
      VERIFICATION_BUNDLE_VOCABULARY.target_types.test_selector),
    required_confirmation: "exact_unexpected_fields"
  });
}

function reauthorStableCurrentDefinitionBindings({ contract, qualification, replacements }) {
  if (qualification?.schema_version !== CURRENT_DEFINITION_REAUTHORING_SCHEMA ||
      !Array.isArray(qualification.definitions) || !Array.isArray(replacements)) refuse(
    "stable_current_definition_reauthoring_input_invalid", "/replacements",
    "qualified stable-v1 correction and complete replacements", null
  );
  const qualifiedById = new Map(qualification.definitions.map((definition) =>
    [definition.verification_claim_id, definition]));
  if (replacements.length !== qualifiedById.size) refuse(
    "stable_current_definition_reauthoring_population_incomplete", "/replacements",
    [...qualifiedById.keys()].sort(compareCodeUnits),
    replacements.map(({ verification_id: id }) => id).sort(compareCodeUnits)
  );
  const prospective = structuredClone(contract);
  const proofById = new Map(prospective.test_proofs.map((proof, index) =>
    [proof.verification_claim_id, { proof, index }]));
  const seen = new Set();
  for (const [index, replacement] of replacements.entries()) {
    assertClosedInput(replacement, ["op", "verification_id", "binding"],
      `/replacements/${index}`);
    const qualified = qualifiedById.get(replacement.verification_id);
    const stored = proofById.get(replacement.verification_id)?.proof;
    if (replacement.op !== "replace" || qualified === undefined || stored === undefined ||
        seen.has(replacement.verification_id)) refuse(
      "stable_current_definition_reauthoring_identity_invalid",
      `/replacements/${index}/verification_id`,
      [...qualifiedById.keys()].sort(compareCodeUnits), replacement.verification_id ?? null
    );
    seen.add(replacement.verification_id);
    const expected = structuredClone(stored);
    for (const field of qualified.unexpected_fields) delete expected[field];
    expected.test_selector = structuredClone(replacement.binding?.test_selector);
    if (canonicalJsonBytes(expected).toString("utf8") !==
        canonicalJsonBytes(replacement.binding).toString("utf8")) refuse(
      "stable_current_definition_reauthoring_change_out_of_scope",
      `/replacements/${index}/binding`,
      "only the explicit selector and confirmed retired fields may change", null
    );
    prospective.test_proofs[proofById.get(replacement.verification_id).index] =
      structuredClone(replacement.binding);
  }
  const validation = validateStableTestProofContract(prospective);
  if (!validation.valid) refuse(
    "stable_current_definition_reauthoring_result_invalid", "/test_proofs",
    "valid complete current stable-v1 contract", "invalid", validation.diagnostics
  );
  const canonical = JSON.parse(canonicalJsonBytes(prospective).toString("utf8"));
  return deepFreeze({
    contract: canonical,
    contract_digest: `sha256:${sha256(canonicalJsonBytes(canonical))}`,
    changed_verification_ids: [...seen].sort(compareCodeUnits),
    semantic_judgment: "not_performed_authoring_only"
  });
}

const CONTRACT_DEFS = STABLE_CONTRACT_SCHEMA.$defs;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function schemaEnum(node) {
  return Object.freeze([...(node?.enum ?? [])]);
}

function providersFor(capability, selectorKind) {
  return TEST_PROOF_PROVIDER_CATALOG.providers.filter(({ capabilities,
    selector_kind: kind }) => capabilities.includes(capability) && kind === selectorKind);
}

function providerRequirement(capability, selectorKind = NODE_TEST_SELECTOR_KIND) {
  const matched = providersFor(capability, selectorKind);
  const descriptor = matched.length === 1 ? matched[0] : null;
  if (descriptor === null) return Object.freeze({
    capability, resolved: false,
    candidate_provider_ids: Object.freeze(matched
      .map(({ provider_id: providerId }) => providerId).sort(compareCodeUnits))
  });
  return Object.freeze({
    capability,
    resolved: true,
    provider_id: descriptor.provider_id,
    provider_version: descriptor.provider_version,
    observation_mechanisms: Object.freeze([...descriptor.observation_mechanisms]),
    observation_seams: Object.freeze([...descriptor.observation_seams]),
    evidence_artifact_types: Object.freeze([...descriptor.evidence_artifact_types]),
    falsifier_strategies: Object.freeze([...descriptor.falsifier_strategies]),
    boundary_kinds: Object.freeze([...descriptor.boundary_kinds])
  });
}

const familyRequirements = (selectorKind) => Object.freeze({
  candidate_execution: providerRequirement("candidate_execution", selectorKind),
  falsifier_execution: providerRequirement("falsifier_execution", selectorKind),
  boundary_traversal: providerRequirement("boundary_traversal", selectorKind)
});

const VERIFICATION_BUNDLE_PROVIDER_REQUIREMENTS = familyRequirements(NODE_TEST_SELECTOR_KIND);
const NATIVE_SELECTOR_KINDS = Object.freeze([...new Set(TEST_PROOF_PROVIDER_CATALOG.providers
  .map(({ selector_kind: kind }) => kind))].filter((kind) => kind !== NODE_TEST_SELECTOR_KIND)
  .sort(compareCodeUnits));
const NATIVE_PROVIDER_REQUIREMENTS = Object.freeze(Object.fromEntries(
  NATIVE_SELECTOR_KINDS.map((kind) => [kind, familyRequirements(kind)])));
const NODE_SELECTOR_ARM = CONTRACT_DEFS.test_selector.oneOf.find(({ required }) =>
  required.includes("name"));
const NATIVE_SELECTOR_ARM = CONTRACT_DEFS.test_selector.oneOf.find(({ required }) =>
  required.includes("node_id"));
const NATIVE_MUTATION_BRANCH = CONTRACT_DEFS.falsifier.allOf.find((branch) =>
  branch.if?.properties?.mutation?.properties?.mechanism?.enum !== undefined);
const NATIVE_SOURCE_PATTERN =
  CONTRACT_DEFS.system_under_test_boundary.properties.runtime_module_path.anyOf[1].pattern;

function strategySelectorKind(strategy, selectorKind) {
  if (selectorKind !== undefined) {
    return testProofFalsifierProvider(selectorKind, strategy) === null ? null : selectorKind;
  }
  const owners = testProofStrategySelectorKinds(strategy);
  return owners.length === 1 ? owners[0] : null;
}

const VERIFICATION_BUNDLE_VOCABULARY = deepFreeze({
  schema_version: VERIFICATION_BUNDLE_SCHEMA_VERSION,
  contract_schema_version: STABLE_CONTRACT_SCHEMA.properties.schema_version.const,
  test_proof_version: STABLE_CONTRACT_SCHEMA.properties.test_proof_version.const,
  required_fields: [...VERIFICATION_BUNDLE_FIELDS],
  populations: BUNDLE_POPULATIONS.map(([population, identity_field]) =>
    ({ population, identity_field })),
  verification_claim: {
    required_fields: [...CONTRACT_DEFS.verification_claim.required],
    kind: "verification",
    verification_method: "test_execution",
    verification_methods: schemaEnum(
      CONTRACT_DEFS.verification_claim.properties.verification_method),
    modalities: schemaEnum(CONTRACT_DEFS.verification_claim.properties.modality),
    bound_modality: "MUST"
  },
  attachment_relation: {
    required_fields: [...CONTRACT_DEFS.relation.required],
    bound_role: "verifies",
    roles: schemaEnum(CONTRACT_DEFS.relation.properties.role)
  },
  target_types: {
    system_under_test_boundary_kind: schemaEnum(
      CONTRACT_DEFS.system_under_test_boundary.properties.kind),
    observable_result_kind: schemaEnum(
      CONTRACT_DEFS.observable_result.properties.kind),
    falsifier_strategy: schemaEnum(CONTRACT_DEFS.falsifier.properties.strategy),
    test_selector: {
      required_fields: [...NODE_SELECTOR_ARM.required],
      name_max_length: NODE_SELECTOR_ARM.properties.name.maxLength,
      nesting_minimum: NODE_SELECTOR_ARM.properties.nesting.minimum,
      nesting_maximum: NODE_SELECTOR_ARM.properties.nesting.maximum,
      file_owner: "work_record_acceptance_validation_node_test_target"
    },
    native_test_selector: {
      required_fields: [...NATIVE_SELECTOR_ARM.required],
      node_id_max_length: NATIVE_SELECTOR_ARM.properties.node_id.maxLength,
      selector_kinds: [...NATIVE_SELECTOR_KINDS],
      target_owner: "authored_case_target"
    },
    prohibited_shortcuts: schemaEnum(
      CONTRACT_DEFS.test_proof_binding.properties.prohibited_shortcuts.items),
    required_prohibited_shortcuts: [
      CONTRACT_DEFS.test_proof_binding.properties.prohibited_shortcuts.contains.const
    ]
  },
  providers: VERIFICATION_BUNDLE_PROVIDER_REQUIREMENTS,
  native_providers: NATIVE_PROVIDER_REQUIREMENTS,
  identity_patterns: Object.fromEntries([
    "claim_id", "relation_id", "proposition_id", "reference_id", "test_proof_id",
    "boundary_id", "observable_id", "falsifier_id", "mutation_id",
    "repo_module_path"
  ].map((name) => [name, CONTRACT_DEFS[name].pattern]))
});

function identitySlug(verificationId) {
  const stripped = typeof verificationId === "string" &&
    verificationId.startsWith("claim-") ? verificationId.slice("claim-".length) : "";
  if (SLUG_PATTERN.test(stripped)) return stripped;
  return `sha256-${sha256(Buffer.from(String(verificationId), "utf8"))}`;
}

function hole(pointer, targetType, requirement, extra = {}) {
  return { pointer, target_type: targetType, requirement, ...extra };
}

function contractCandidates(contract) {
  const claims = Array.isArray(contract?.claims) ? contract.claims : [];
  return {
    proposition_id: (Array.isArray(contract?.propositions) ? contract.propositions : [])
      .map(({ proposition_id: id }) => id).filter((id) => typeof id === "string")
      .sort(compareCodeUnits),
    reference_id: (Array.isArray(contract?.references) ? contract.references : [])
      .map(({ reference_id: id }) => id).filter((id) => typeof id === "string")
      .sort(compareCodeUnits),

    behavior_claim_id: claims.filter(({ kind }) => kind === "behavior")
      .map(({ claim_id: id }) => id).filter((id) => typeof id === "string")
      .sort(compareCodeUnits)
  };
}

function boundTraversalProvider(requirements = VERIFICATION_BUNDLE_PROVIDER_REQUIREMENTS) {
  const traversal = requirements.boundary_traversal;
  if (!traversal.resolved || traversal.boundary_kinds.length !== 1 ||
      traversal.observation_mechanisms.length !== 1 ||
      traversal.observation_seams.length !== 1) return null;
  return {
    mode: "provider",
    provider_id: traversal.provider_id,
    provider_version: traversal.provider_version,
    capability: "boundary_traversal",
    boundary_kind: traversal.boundary_kinds[0],
    observation_mechanism: traversal.observation_mechanisms[0],
    observation_seam: traversal.observation_seams[0],
    evidence_artifact_type: traversal.evidence_artifact_types[0]
  };
}

function buildStableTestProofBindingTemplate({ contract = null, verificationId,
  strategy = "dependency_failure", selectorKind: requestedSelectorKind = undefined,
  falsificationSupport = "provider" }) {
  const slug = identitySlug(verificationId);
  const candidates = contractCandidates(contract);
  if (falsificationSupport !== "provider" &&
      falsificationSupport !== "registry_unsupported") refuse(
    "stable_test_proof_input_invalid", "/falsificationSupport",
    ["provider", "registry_unsupported"], falsificationSupport
  );

  const unsupportedFalsification = falsificationSupport === "registry_unsupported";
  if (unsupportedFalsification && requestedSelectorKind === undefined) refuse(
    "stable_test_proof_input_invalid", "/selectorKind",
    "one provider family selector kind", null
  );

  const selectorKind = unsupportedFalsification ? requestedSelectorKind
    : strategySelectorKind(strategy, requestedSelectorKind);
  if (selectorKind === null) refuse("stable_test_proof_input_invalid", "/strategy",
    requestedSelectorKind === undefined
      ? { strategy, selector_kinds: testProofStrategySelectorKinds(strategy) }
      : { selector_kind: requestedSelectorKind,
        strategies: TEST_PROOF_PROVIDER_CATALOG.providers.filter(({ selector_kind: kind }) =>
          kind === requestedSelectorKind).flatMap(({ falsifier_strategies: values }) => values) },
    strategy);
  const requirements = selectorKind === NODE_TEST_SELECTOR_KIND
    ? VERIFICATION_BUNDLE_PROVIDER_REQUIREMENTS : NATIVE_PROVIDER_REQUIREMENTS[selectorKind];
  const native = selectorKind !== NODE_TEST_SELECTOR_KIND;
  const candidate = requirements.candidate_execution;
  const falsifier = requirements.falsifier_execution;
  const traversal = boundTraversalProvider(requirements);
  if (!unsupportedFalsification && !falsifier.falsifier_strategies?.includes(strategy)) refuse(
    "stable_test_proof_input_invalid", "/strategy", falsifier.falsifier_strategies, strategy
  );
  const mutation = unsupportedFalsification ? null
    : testProofFalsifierProvider(selectorKind, strategy);
  const sourceSuffixes = testProofProviderFamily(selectorKind).source_suffixes;
  const boundaryKind = traversal?.boundary_kind ?? null;
  const binding = {
    test_proof_id: `test-proof-${slug}`,
    verification_claim_id: verificationId,
    system_under_test_boundary: {
      boundary_id: `sut-boundary-${slug}`,
      ...(boundaryKind === null ? {} : { kind: boundaryKind })
    },
    observable_result: { observable_id: `observable-${slug}` },
    candidate_execution_provider: candidate.resolved ? {
      provider_id: candidate.provider_id,
      provider_version: candidate.provider_version,
      capability: "candidate_execution"
    } : {},
    falsifiers: unsupportedFalsification ? [] : [{
      falsifier_id: `falsifier-${slug}`,
      ...(strategy === null ? {} : { strategy }),
      expected_outcome:
        CONTRACT_DEFS.falsifier.properties.expected_outcome.const,
      mutation: {
        ...(strategy === "forced_invocation" ? {
          invocation: "first_original_return_no_arguments", operation: {}
        } : {}),
        mutation_id: `mutation-${slug}`,
        mechanism: mutation.mechanism,
        target_kind: mutation.target_kind
      },
      execution_provider: falsifier.resolved ? {
        provider_id: falsifier.provider_id,
        provider_version: falsifier.provider_version,
        capability: "falsifier_execution"
      } : {}
    }],
    ...(unsupportedFalsification ? { falsification_provider: {
      mode: "registry_unsupported",
      registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
      registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION
    } } : {}),
    ...(traversal === null ? {} : { traversal_provider: traversal }),
    test_selector: native && candidate.resolved ? {
      provider_id: candidate.provider_id,
      provider_version: candidate.provider_version
    } : {},
    prohibited_shortcuts: [
      ...VERIFICATION_BUNDLE_VOCABULARY.target_types.required_prohibited_shortcuts
    ]
  };
  const holes = [
    hole("/system_under_test_boundary/subject_reference_ids", "reference_id",
      "name the contract references the boundary exercises",
      { cardinality: "one_or_more", compatible_values: candidates.reference_id }),
    ...(boundaryKind === "module" ? [hole(
      "/system_under_test_boundary/runtime_module_path", "repo_module_path",
      "name the repository module the bound traversal provider observes",
      native ? { pattern: NATIVE_SOURCE_PATTERN, source_suffixes: [...sourceSuffixes] }
        : { pattern: VERIFICATION_BUNDLE_VOCABULARY.identity_patterns.repo_module_path }
    )] : []),
    hole("/observable_result/kind", "observable_result_kind",
      "choose the observable the test asserts on",
      { compatible_values:
        VERIFICATION_BUNDLE_VOCABULARY.target_types.observable_result_kind }),
    hole("/observable_result/proposition_id", "proposition_id",
      "name the proposition the observable result decides",
      { compatible_values: candidates.proposition_id }),
    ...(unsupportedFalsification ? [] : [hole("/falsifiers/0/proposition_id", "proposition_id",
      "name the proposition the falsifier makes fail",
      { compatible_values: candidates.proposition_id })]),
    ...(native ? [
      ...(unsupportedFalsification ? [] : [hole("/falsifiers/0/mutation/module_path", "repo_module_path",
        "name the source module whose scalar-return function the falsifier substitutes",
        { pattern: NATIVE_MUTATION_BRANCH.then.properties.mutation.properties.module_path.pattern,
          source_suffixes: [...sourceSuffixes] }),
      hole("/falsifiers/0/mutation/function_name", "function_name",
        "name the top-level function whose single scalar return the falsifier replaces"),
      hole("/falsifiers/0/mutation/replacement", "json_scalar",
        "supply the JSON scalar that replaces the original return; it must be observably different")]),
      hole("/test_selector/node_id", "native_node_id",
        "name the exact literal native node identity inside the authored case target; the test need not exist yet",
        { max_length: NATIVE_SELECTOR_ARM.properties.node_id.maxLength })
    ] : [
      ...(unsupportedFalsification ? [] : [hole("/falsifiers/0/mutation/module_path", "repo_module_path",
        "name the module the falsifier substitutes",
        { pattern: VERIFICATION_BUNDLE_VOCABULARY.identity_patterns.repo_module_path })]),
      hole("/test_selector/name", "test_name",
        "name the exact node:test assertion inside the work record's bound node_test target; the test need not exist yet",
        { max_length: TEST_SELECTOR_NAME_MAX_LENGTH }),
      hole("/test_selector/nesting", "test_nesting",
        "declare the nesting depth of that assertion (0 for a top-level test)",
        { minimum: 0, maximum: TEST_SELECTOR_NESTING_MAX })
    ])
  ];
  if (strategy === "forced_invocation") holes.push(
    hole("/falsifiers/0/mutation/entry_export", "export_name", "name the original runner entry export"),
    hole("/falsifiers/0/mutation/operation/module_path", "repo_module_path", "name the prohibited operation owner"),
    hole("/falsifiers/0/mutation/operation/export_name", "export_name", "name the prohibited operation export")
  );
  return { binding, author_semantics: holes };
}

function buildVerificationBundleTemplate({ contract = null, verificationId }) {
  if (typeof verificationId !== "string" || verificationId.length === 0) refuse(
    "stable_verification_bundle_input_invalid", "/verification_id",
    "nonempty controlled verification identity", verificationId ?? null
  );
  const slug = identitySlug(verificationId);
  const candidates = contractCandidates(contract);
  const proof = buildStableTestProofBindingTemplate({ contract, verificationId });
  const bundle = {
    schema_version: VERIFICATION_BUNDLE_SCHEMA_VERSION,
    verification_id: verificationId,
    references: [],
    propositions: [],
    claims: [{
      claim_id: verificationId,
      kind: VERIFICATION_BUNDLE_VOCABULARY.verification_claim.kind,
      modality: VERIFICATION_BUNDLE_VOCABULARY.verification_claim.bound_modality,
      verification_method:
        VERIFICATION_BUNDLE_VOCABULARY.verification_claim.verification_method
    }],
    relations: [{
      relation_id: `rel-verifies-${slug}`,
      role: VERIFICATION_BUNDLE_VOCABULARY.attachment_relation.bound_role,
      source_claim_id: verificationId
    }],
    collections: [],
    residue: [],
    annotations: [],
    test_proof: proof.binding
  };
  const authorSemantics = [
    hole("/claims/0/proposition_id", "proposition_id",
      "name the proposition this verification performs",
      { compatible_values: candidates.proposition_id }),
    hole("/claims/0/falsifying_proposition_id", "proposition_id",
      "name the separately declared proposition whose truth makes the verification fail",
      { compatible_values: candidates.proposition_id }),
    hole("/relations/0/target_claim_id", "behavior_claim_id",
      "attach the verification to the behavior claim it verifies",
      { compatible_values: candidates.behavior_claim_id }),
    ...proof.author_semantics.map(({ pointer, ...rest }) =>
      ({ pointer: `/test_proof${pointer}`, ...rest }))
  ];
  return deepFreeze({
    schema_version: "controlled-contract-verification-bundle-template.v1",
    verification_id: verificationId,
    bundle,
    author_semantics: authorSemantics,
    bound_field_count: VERIFICATION_BUNDLE_FIELDS.length,
    open_semantic_count: authorSemantics.length
  });
}

function describeStableTestProofAuthoring() {
  return deepFreeze({
    schema_version: "controlled-contract-stable-test-proof-authoring.v1",
    contract_schema_version: "controlled-acceptance-contract.v1",
    test_proof_version: "controlled-contract-test-proof.v1",
    provider_registry: {
      registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
      registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION,
      capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
      providers: structuredClone(TEST_PROOF_PROVIDER_CATALOG.providers)
    },
    operations: ["query", "replace", "verification_bundle_patch"],
    verification_bundle: VERIFICATION_BUNDLE_VOCABULARY,
    limits: STABLE_TEST_PROOF_AUTHORING_LIMITS,
    refusal_order: REFUSAL_ORDER,
    migration: "explicit_only"
  });
}

export {
  CURRENT_DEFINITION_REAUTHORING_SCHEMA,
  RETIRED_CURRENT_DEFINITION_FIELDS,
  STABLE_TEST_PROOF_AUTHORING_LIMITS,
  StableTestProofContractError,
  VERIFICATION_BUNDLE_FIELDS,
  VERIFICATION_BUNDLE_SCHEMA_VERSION,
  VERIFICATION_BUNDLE_VOCABULARY,
  applyStableVerificationBundles,
  buildStableTestProofRecoveryCall,
  buildStableTestProofBindingTemplate,
  buildVerificationBundleTemplate,
  canonicalStableTestProofContractJson,
  describeStableTestProofAuthoring,
  queryStableTestProofBindings,
  projectStableTestProofSelector,
  qualifyStableCurrentDefinitionReauthoring,
  reauthorStableCurrentDefinitionBindings,
  replaceStableTestProofBindings,
  resolveStableTestProofBindingPopulation,
  resolveStableTestProofProviderBindings,
  validateStableTestProofContract,
  validateStableV1ContractFamily as validateNativeTestProofAuthoringContract
};

export {
  TEST_PROOF_PROVIDER_SCHEMA_VOCABULARY,
  TEST_RUNTIME_RUNNER_CATALOG,
  isTestProofSourcePath,
  resolveNativeTestSelector,
  testProofFalsifierProvider,
  testProofProviderFamily,
  testProofStrategySelectorKinds,
  testProofWitnessValidator,
  testRuntimeRunner
} from "./test-proof-provider-registry.mjs";
