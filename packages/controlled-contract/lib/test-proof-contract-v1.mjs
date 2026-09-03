import {
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  sha256,
  unsupportedObjectKeys
} from "./deterministic-projection-primitives.mjs";
import { projectBoundedDiagnostics } from "./bounded-diagnostic-projection.mjs";
import { validateStableV1ContractFamily } from "./stable-v1-family-validation.mjs";
import STABLE_CONTRACT_SCHEMA from
  "../schema/controlled-acceptance-contract.v1.schema.json" with { type: "json" };
import {
  PROVIDER_REFUSAL_PRECEDENCE,
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  resolveTestProofProviderCompatibility
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

const REFUSAL_ORDER = Object.freeze([
  "stable_test_proof_input_invalid",
  "stable_family_experimental_substitution",
  "stable_family_identity_unknown",
  "stable_family_mixed_state",
  "stable_family_partial_state",
  "stable_family_schema_invalid",
  "stable_test_proof_current_population_duplicate",
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
const STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS = Object.freeze({
  MISSING_INVENTORY: "missing_inventory",
  MISSING_SELECTION: "missing_selection",
  INVALID_SELECTION: "invalid_selection",
  READY: "ready"
});
const STABLE_TEST_PROOF_RUNTIME_READINESS_SCHEMA_VERSION =
  "controlled-contract-test-proof-runtime-readiness.v1";
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
  assertValidStableContract(contract);
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
        `/operations/${index}/bundle/test_proof`, "separate proof replacement route",
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
  const validation = validateStableTestProofContract(prospective);
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
  const failures = contract.test_proofs.flatMap((binding, index) => {
    const population = currentPopulationEntries(binding);
    const duplicate = population.find((testId, populationIndex) =>
      population.indexOf(testId) !== populationIndex);
    return [
      ...(duplicate === undefined ? [] : [diagnostic(
        "stable_test_proof_current_population_duplicate",
        `/test_proofs/${index}/coverage_disposition/items`,
        "duplicate-free current test population",
        duplicate
      )]),
      ...providerResolutionEntries(binding).filter(({ result }) => !result.valid).map(
        ({ result }) => ({
          ...result.diagnostic,
          pointer: `/test_proofs/${index}${result.diagnostic.pointer}`
        })
      )
    ];
  }
  ).sort((left, right) =>
    REFUSAL_ORDER.indexOf(left.code) - REFUSAL_ORDER.indexOf(right.code) ||
    compareCodeUnits(left.pointer, right.pointer)
  );
  if (failures.length === 0) return family;
  return deepFreeze({
    ...family,
    valid: false,
    diagnostics: projectBoundedDiagnostics(failures)
  });
}

function currentPopulationEntries(binding) {
  const items = binding?.coverage_disposition?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => item?.disposition === "preserved"
    ? [item.test_id]
    : item?.disposition === "replaced" && Array.isArray(item.replacement_test_ids)
      ? item.replacement_test_ids
      : []);
}

function projectStableTestProofCurrentPopulation(binding) {
  const population = currentPopulationEntries(binding);
  const duplicate = population.find((testId, index) =>
    population.indexOf(testId) !== index);
  if (duplicate !== undefined) refuse(
    "stable_test_proof_current_population_duplicate",
    "/coverage_disposition/items",
    "duplicate-free current test population",
    duplicate
  );
  return Object.freeze([...population].sort(compareCodeUnits));
}

function classifyStableTestProofRuntimeReadiness(binding) {
  const currentTestIds = projectStableTestProofCurrentPopulation(binding);
  const selection = binding?.runtime_test_identity;
  const selectedTestId = selection && typeof selection === "object" &&
      !Array.isArray(selection) && typeof selection.test_id === "string"
    ? selection.test_id : null;
  let reason = STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.READY;
  if (binding?.coverage_disposition?.baseline_state !== "complete_executed_inventory" ||
      currentTestIds.length === 0) {
    reason = STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.MISSING_INVENTORY;
  } else if (selection === undefined) {
    reason = STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.MISSING_SELECTION;
  } else if (!selection || typeof selection !== "object" || Array.isArray(selection) ||
      typeof selection.test_id !== "string" ||
      !currentTestIds.includes(selection.test_id)) {
    reason = STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.INVALID_SELECTION;
  }
  const ready = reason === STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.READY;
  return deepFreeze({
    schema_version: STABLE_TEST_PROOF_RUNTIME_READINESS_SCHEMA_VERSION,
    status: ready ? "ready" : "not_ready",
    reason,
    candidate_total: currentTestIds.length,
    current_test_ids: currentTestIds,
    selected_test_id: selectedTestId,
    runtime_test_identity: ready ? { test_id: selection.test_id } : null,
    authority: "diagnostic",
    admissibility_effect: "none"
  });
}

function assertValidStableContract(contract) {
  const result = validateStableTestProofContract(contract);
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
  const rows = [{
    role: "candidate_execution_provider",
    pointer: "/candidate_execution_provider",
    result: resolveTestProofProviderCompatibility({
      provider: binding?.candidate_execution_provider,
      capability: "candidate_execution",
      pointer: "/candidate_execution_provider"
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
      boundary_kind: falsifier?.mutation?.target_kind
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
      boundary_kind: traversal?.boundary_kind
    });
    const systemBoundaryKind = binding?.system_under_test_boundary?.kind;
    const boundaryMismatchCode = PROVIDER_REFUSAL_PRECEDENCE[10];
    const result = compatibility.valid && systemBoundaryKind !== traversal?.boundary_kind
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
    rows.push({ role: "traversal_provider", pointer: "/traversal_provider", result });
  }
  return rows;
}

function resolveStableTestProofProviderBindings(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) refuse(
    "stable_test_proof_provider_missing", "/", "complete test-proof binding",
    binding ?? null
  );
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
  assertValidStableContract(contract);
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
  assertValidStableContract(contract);
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
  const validation = validateStableTestProofContract(prospective);
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

const CONTRACT_DEFS = STABLE_CONTRACT_SCHEMA.$defs;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function schemaEnum(node) {
  return Object.freeze([...(node?.enum ?? [])]);
}

function coverageBaselineStates() {
  return Object.freeze(CONTRACT_DEFS.coverage_disposition.oneOf.map(
    (variant) => variant.properties.baseline_state.const));
}

function soleProviderFor(capability) {
  const matched = TEST_PROOF_PROVIDER_CATALOG.providers.filter(
    ({ capabilities }) => capabilities.includes(capability));
  return matched.length === 1 ? matched[0] : null;
}

function providerRequirement(capability) {
  const descriptor = soleProviderFor(capability);
  if (descriptor === null) return Object.freeze({
    capability, resolved: false,
    candidate_provider_ids: Object.freeze(TEST_PROOF_PROVIDER_CATALOG.providers
      .filter(({ capabilities }) => capabilities.includes(capability))
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

const VERIFICATION_BUNDLE_PROVIDER_REQUIREMENTS = Object.freeze({
  candidate_execution: providerRequirement("candidate_execution"),
  falsifier_execution: providerRequirement("falsifier_execution"),
  boundary_traversal: providerRequirement("boundary_traversal")
});

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
    coverage_baseline_state: coverageBaselineStates(),
    prohibited_shortcuts: schemaEnum(
      CONTRACT_DEFS.test_proof_binding.properties.prohibited_shortcuts.items),
    required_prohibited_shortcuts: [
      CONTRACT_DEFS.test_proof_binding.properties.prohibited_shortcuts.contains.const
    ]
  },
  providers: VERIFICATION_BUNDLE_PROVIDER_REQUIREMENTS,
  identity_patterns: Object.fromEntries([
    "claim_id", "relation_id", "proposition_id", "reference_id", "test_proof_id",
    "boundary_id", "observable_id", "falsifier_id", "mutation_id",
    "coverage_baseline_id", "repo_module_path"
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

function boundTraversalProvider() {
  const traversal = VERIFICATION_BUNDLE_PROVIDER_REQUIREMENTS.boundary_traversal;
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

function buildStableTestProofBindingTemplate({ contract = null, verificationId }) {
  const slug = identitySlug(verificationId);
  const candidates = contractCandidates(contract);
  const candidate = VERIFICATION_BUNDLE_PROVIDER_REQUIREMENTS.candidate_execution;
  const falsifier = VERIFICATION_BUNDLE_PROVIDER_REQUIREMENTS.falsifier_execution;
  const traversal = boundTraversalProvider();
  const strategy = falsifier.resolved && falsifier.falsifier_strategies.length === 1
    ? falsifier.falsifier_strategies[0] : null;
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
    falsifiers: [{
      falsifier_id: `falsifier-${slug}`,
      ...(strategy === null ? {} : { strategy }),
      expected_outcome:
        CONTRACT_DEFS.falsifier.properties.expected_outcome.const,
      mutation: {
        mutation_id: `mutation-${slug}`,
        mechanism: CONTRACT_DEFS.falsifier.properties.mutation.properties.mechanism.const,
        target_kind:
          CONTRACT_DEFS.falsifier.properties.mutation.properties.target_kind.const
      },
      execution_provider: falsifier.resolved ? {
        provider_id: falsifier.provider_id,
        provider_version: falsifier.provider_version,
        capability: "falsifier_execution"
      } : {}
    }],
    ...(traversal === null ? {} : { traversal_provider: traversal }),
    coverage_disposition: { baseline_id: `coverage-baseline-${slug}` },
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
      { pattern: VERIFICATION_BUNDLE_VOCABULARY.identity_patterns.repo_module_path }
    )] : []),
    hole("/observable_result/kind", "observable_result_kind",
      "choose the observable the test asserts on",
      { compatible_values:
        VERIFICATION_BUNDLE_VOCABULARY.target_types.observable_result_kind }),
    hole("/observable_result/proposition_id", "proposition_id",
      "name the proposition the observable result decides",
      { compatible_values: candidates.proposition_id }),
    hole("/falsifiers/0/proposition_id", "proposition_id",
      "name the proposition the falsifier makes fail",
      { compatible_values: candidates.proposition_id }),
    hole("/falsifiers/0/mutation/module_path", "repo_module_path",
      "name the module the falsifier substitutes",
      { pattern: VERIFICATION_BUNDLE_VOCABULARY.identity_patterns.repo_module_path }),
    hole("/coverage_disposition/baseline_state", "coverage_baseline_state",
      "declare the executed-coverage baseline this proof replaces or preserves",
      { compatible_values:
        VERIFICATION_BUNDLE_VOCABULARY.target_types.coverage_baseline_state }),
    hole("/coverage_disposition/items", "coverage_item",
      "list the coverage items, empty only for no_executed_coverage",
      { cardinality: "baseline_state_dependent" })
  ];
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
  STABLE_TEST_PROOF_AUTHORING_LIMITS,
  STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS,
  STABLE_TEST_PROOF_RUNTIME_READINESS_SCHEMA_VERSION,
  StableTestProofContractError,
  VERIFICATION_BUNDLE_FIELDS,
  VERIFICATION_BUNDLE_SCHEMA_VERSION,
  VERIFICATION_BUNDLE_VOCABULARY,
  applyStableVerificationBundles,
  buildStableTestProofBindingTemplate,
  buildVerificationBundleTemplate,
  canonicalStableTestProofContractJson,
  classifyStableTestProofRuntimeReadiness,
  describeStableTestProofAuthoring,
  queryStableTestProofBindings,
  projectStableTestProofCurrentPopulation,
  replaceStableTestProofBindings,
  resolveStableTestProofBindingPopulation,
  resolveStableTestProofProviderBindings,
  validateStableTestProofContract
};
