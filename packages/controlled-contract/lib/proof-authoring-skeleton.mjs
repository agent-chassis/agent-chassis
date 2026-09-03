import { readFile } from "node:fs/promises";

import { canonicalDigest, normalizeContractForIdentity } from
  "./contract-assessment.mjs";
import {
  canonicalJsonBytes,
  canonicalValue,
  compareCodeUnits,
  deepFreeze,
  sha256,
  unsupportedObjectKeys
} from "./deterministic-projection-primitives.mjs";
import { validateAndResolveNativeContractV1 } from
  "./native-contract-carrier-v1.mjs";
import {
  buildVerificationBundleTemplate,
  validateStableTestProofContract
} from "./test-proof-contract-v1.mjs";
import { describeProofPackAuthoring, selectProofPacks } from "./proof-intent-selection.mjs";
import {
  inspectProofPackBindingsPage,
  validateSuppliedProofPackBindings
} from "./proof-pack-binding-assistance.mjs";
import { buildProofPlan } from "./proof-plan-compiler.mjs";
import { executeUncappedIntegrationPrefixProjection } from "./deterministic-projection.mjs";

const INTEGRATION_INTENT = "controlled-proof-intent.integration-prefix-safety";
const INTEGRATION_PROFILE = Object.freeze({
  profile_id: "proof.integration.prefix-safety",
  profile_version: "2.0.0"
});
const INTEGRATION_ARTIFACT_SUFFIXES = Object.freeze({
  "dag-source": "integration-prefix-dag.json",
  "execution-paths": "integration-prefix-paths.json",
  "integration-units": "integration-prefix-units.json",
  "prefix-census": "integration-prefix-census.json"
});
const FOCUS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function integrationFailure(code, message, details = {}) {
  throw new ProofAuthoringSkeletonError(`integration_prefix_${code}`, message, details);
}

function exactPlain(value, field) {
  if (!plain(value)) integrationFailure("input_invalid", `${field} must be one plain object`);
  return value;
}

function exactArray(value, field) {
  if (!Array.isArray(value)) integrationFailure("input_invalid", `${field} must be an array`);
  return value;
}

function unsupportedPackageKeys(value, allowedKeys) {
  const unsupported = unsupportedObjectKeys(value, allowedKeys);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return unsupported;
  }
  const allowed = new Set(allowedKeys);
  return [...new Set([
    ...unsupported,
    ...Object.getOwnPropertyNames(value).filter((key) => !allowed.has(key)),
    ...Object.getOwnPropertySymbols(value).map(String)
  ])].sort(compareCodeUnits);
}

function referenceOperandIds(proposition) {
  return (proposition?.operands ?? []).filter(({ kind }) => kind === "reference")
    .map(({ reference_id: referenceId }) => referenceId);
}

function durableReferenceIndex(contract) {
  return new Map((contract.references ?? []).filter((reference) =>
    reference?.identity?.kind === "durable_id").map((reference) => [
    reference.reference_id,
    { domain: reference.identity.domain, value: reference.identity.value }
  ]));
}

function implementationGraph({ record, slices }) {
  if (canonicalJsonBytes(slices).toString("utf8") !==
      canonicalJsonBytes(record.slices).toString("utf8")) integrationFailure(
    "slice_population_incomplete",
    "the supplied slice population is not the complete canonical work-record population"
  );
  const all = new Map();
  for (const slice of slices) {
    if (!plain(slice) || typeof slice.id !== "string" || slice.id.length === 0 ||
        all.has(slice.id)) integrationFailure("slice_population_invalid",
      "canonical slices must have unique nonempty identities");
    all.set(slice.id, slice);
  }
  const implementation = slices.filter(({ work_kind: workKind }) => workKind === "implementation")
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  if (implementation.length === 0) integrationFailure("slice_population_invalid",
    "at least one implementation slice is required");
  const implementationIds = new Set(implementation.map(({ id }) => id));
  const dependsOn = [];
  for (const slice of implementation) {
    if (!Array.isArray(slice.depends_on)) integrationFailure("dependency_invalid",
      "every implementation slice must declare its complete depends_on population",
      { slice_id: slice.id });
    for (const predecessor of slice.depends_on) {
      if (!all.has(predecessor)) integrationFailure("dependency_foreign",
        "an implementation dependency is absent from the canonical slice population",
        { slice_id: slice.id, predecessor_slice_id: predecessor });
      if (implementationIds.has(predecessor)) dependsOn.push({
        predecessor_slice_id: predecessor,
        successor_slice_id: slice.id
      });
    }
  }
  dependsOn.sort((left, right) => compareCodeUnits(
    `${left.predecessor_slice_id}\0${left.successor_slice_id}`,
    `${right.predecessor_slice_id}\0${right.successor_slice_id}`
  ));
  return {
    implementation,
    dag: {
      schema_version: "controlled-contract.integration-prefix-dag.v1",
      slices: implementation.map(({ id }) => ({ slice_id: id })),
      depends_on: dependsOn
    },
    units: {
      schema_version: "controlled-contract.integration-units.v1",
      integration_units: implementation.map(({ id }) => ({
        unit_id: `unit-${id}`,
        slice_ids: [id]
      }))
    }
  };
}

function typedOwnership({ wkId, targetContract, mappingContract, implementation }) {
  const references = durableReferenceIndex(mappingContract);
  const sliceIds = new Set(implementation.map(({ id }) => id));
  const claimIds = new Set((targetContract.claims ?? []).map(({ claim_id: claimId }) => claimId));
  const owners = new Map();
  const pathBySlice = new Map();
  const branchesByPath = new Map();
  for (const proposition of mappingContract.propositions ?? []) {
    const subject = references.get(proposition.subject_reference_id);
    const operands = referenceOperandIds(proposition).map((id) => references.get(id));
    if (proposition.operator === "reference:contained_in" &&
        subject?.domain === `${wkId}.operative-claim` && claimIds.has(subject.value)) {
      const slices = operands.filter((operand) => operand?.domain === `${wkId}.slice` &&
        sliceIds.has(operand.value));
      if (slices.length !== 1 || owners.has(subject.value)) integrationFailure(
        "claim_ownership_invalid", "each target claim must have exactly one typed slice owner",
        { claim_id: subject.value });
      owners.set(subject.value, slices[0].value);
    }
    if (proposition.operator === "reference:routes_to" &&
        subject?.domain === `${wkId}.slice` && sliceIds.has(subject.value)) {
      const paths = operands.filter((operand) => operand?.domain === `${wkId}.execution-path`);
      if (paths.length !== 1 || pathBySlice.has(subject.value)) integrationFailure(
        "slice_path_invalid", "each implementation slice must route to one typed execution path",
        { slice_id: subject.value });
      pathBySlice.set(subject.value, paths[0].value);
    }
  }
  for (const proposition of mappingContract.propositions ?? []) {
    const subject = references.get(proposition.subject_reference_id);
    if (proposition.operator !== "reference:includes" ||
        subject?.domain !== `${wkId}.execution-path`) continue;
    const branches = referenceOperandIds(proposition).map((id) => references.get(id))
      .filter((operand) => operand?.domain?.endsWith(".required-branch"))
      .map(({ value }) => value).sort(compareCodeUnits);
    if (branches.length === 0 || branchesByPath.has(subject.value) ||
        new Set(branches).size !== branches.length) integrationFailure(
      "path_branches_invalid", "each execution path must include one complete typed branch set",
      { path_id: subject.value });
    branchesByPath.set(subject.value, branches);
  }
  const unmapped = [...claimIds].filter((claimId) => !owners.has(claimId)).sort(compareCodeUnits);
  if (unmapped.length > 0) integrationFailure("claim_ownership_incomplete",
    "the typed mapping does not own every target claim", { claim_ids: unmapped });
  const paths = [];
  for (const sliceId of [...sliceIds].sort(compareCodeUnits)) {
    const pathId = pathBySlice.get(sliceId);
    if (pathId === undefined || !branchesByPath.has(pathId)) integrationFailure(
      "slice_path_incomplete", "an implementation slice has no complete typed path mapping",
      { slice_id: sliceId });
    paths.push({ path_id: pathId, required_branches: branchesByPath.get(pathId) });
  }
  const uniquePaths = new Map(paths.map((entry) => [entry.path_id, entry]));
  if (uniquePaths.size !== paths.length) integrationFailure("slice_path_invalid",
    "each implementation slice must own one distinct execution path");
  return {
    owners,
    pathBySlice,
    paths: {
      schema_version: "controlled-contract.execution-path-requirements.v1",
      execution_paths: [...uniquePaths.values()].sort((left, right) =>
        compareCodeUnits(left.path_id, right.path_id))
    }
  };
}

function buildIntegrationPrefixSourceMap(input, ...unexpectedArguments) {
  if (unexpectedArguments.length > 0 || !plain(input)) integrationFailure(
    "input_invalid", "integration-prefix source-map authoring accepts exactly one plain object");
  const allowed = new Set(["canonicalRecord", "contract", "mappingContract", "slices", "focus"]);
  const unsupported = unsupportedPackageKeys(input, allowed);
  if (unsupported.length > 0) integrationFailure("authority_forbidden",
    "source-map authoring accepts no caller graph, path, root, policy, or authority input",
    { unsupported_options: unsupported.map(String).sort(compareCodeUnits) });
  const record = exactPlain(input.canonicalRecord, "canonicalRecord");
  const contract = exactPlain(input.contract, "contract");
  const mappingContract = exactPlain(input.mappingContract, "mappingContract");
  const slices = exactArray(input.slices, "slices");
  const wkId = record.id;
  if (typeof wkId !== "string" || !/^WK-[0-9]{4}$/u.test(wkId) ||
      typeof record.repo !== "string" || record.repo.length === 0) integrationFailure(
    "identity_invalid", "the canonical record must bind repository and WK identities");
  const focus = input.focus ?? null;
  if (focus !== null && (typeof focus !== "string" || !FOCUS_PATTERN.test(focus) ||
      /^wk-[0-9]/iu.test(focus))) integrationFailure("focus_invalid",
    "focus must be null or one canonical lowercase slug");
  if ((record.focus ?? null) !== focus) integrationFailure("cross_focus",
    "derived focus differs from the canonical record focus");
  for (const [name, value] of [["contract", contract], ["mappingContract", mappingContract]]) {
    const resolved = validateAndResolveNativeContractV1(value);
    if (!resolved.schema_valid) integrationFailure("contract_invalid", `${name} is schema-invalid`,
      { diagnostics: structuredClone(resolved.diagnostics) });
  }
  const graph = implementationGraph({ record, slices });
  const ownership = typedOwnership({
    wkId, targetContract: contract, mappingContract, implementation: graph.implementation
  });
  const sources = [graph.dag, graph.units, ownership.paths];
  const sourceBytes = sources.map((value) => canonicalJsonBytes(value, { file: true }));
  let projectionBytes;
  try {
    projectionBytes = executeUncappedIntegrationPrefixProjection(sourceBytes);
  } catch (error) {
    integrationFailure(error.code ?? "projection_invalid", error.message, error.details);
  }
  const projection = JSON.parse(projectionBytes.toString("utf8"));
  const implementationUnits = graph.implementation.map(({ id }) => ({
    slice_id: id,
    unit_id: `unit-${id}`,
    path_id: ownership.pathBySlice.get(id),
    required_branches: ownership.paths.execution_paths.find(({ path_id: pathId }) =>
      pathId === ownership.pathBySlice.get(id)).required_branches,
    claim_ids: [...ownership.owners].filter(([, sliceId]) => sliceId === id)
      .map(([claimId]) => claimId).sort(compareCodeUnits)
  }));
  const sourceMap = {
    schema_version: "controlled-contract-integration-prefix-source-map.v1",
    identity: {
      repository: record.repo,
      wk_id: wkId,
      focus,
      contract_digest: canonicalDigest(normalizeContractForIdentity(contract)),
      mapping_contract_digest: canonicalDigest(normalizeContractForIdentity(mappingContract))
    },
    implementation_units: implementationUnits,
    claim_bindings: [...ownership.owners].sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([claimId, sliceId]) => {
        const unit = implementationUnits.find(({ slice_id: id }) => id === sliceId);
        return { claim_id: claimId, slice_id: sliceId, path_id: unit.path_id,
          required_branches: unit.required_branches };
      }),
    projection,
    source_digests: sourceBytes.map((bytes) => sha256(bytes))
  };
  return deepFreeze(canonicalValue({
    source_map: sourceMap,
    dag: graph.dag,
    integration_units: graph.units,
    execution_paths: ownership.paths,
    source_bytes: sourceBytes.map((bytes) => bytes.toString("base64"))
  }));
}

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const PACKAGE_VERSION = packageJson.version;
const INPUT_VERSION = "controlled-contract-verification-profile-input.v1";
const REQUEST_VERSION = "controlled-contract-proof-plan-request.v1";
const CONTINUATION_SCHEMA_VERSION =
  "controlled-contract-proof-authoring-continuation.v1";

const STAGE_ROUTE = Symbol("proof-authoring-stage-route");
const STAGE_SUPPLIED = Symbol("proof-authoring-stage-supplied");

const EVALUATION_STAGE_ALIASES = Object.freeze([
  "evaluation_stage", "evaluationStage"
]);

class ProofAuthoringSkeletonError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofAuthoringSkeletonError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function strings(value, field, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0) ||
      value.some((item) => typeof item !== "string" || item.length === 0) ||
      new Set(value).size !== value.length) {
    throw new ProofAuthoringSkeletonError("proof_authoring_input_invalid",
      `${field} must be a unique non-empty string array`);
  }
  return [...value].sort(compareCodeUnits);
}

function selectedPack(input) {
  if (input.selectedPack !== undefined && input.selected_pack !== undefined) {
    throw new ProofAuthoringSkeletonError(
      "proof_authoring_pack_invalid", "provide selectedPack or selected_pack, not both");
  }
  const pack = input.selectedPack ?? input.selected_pack;
  if (!plain(pack)) throw new ProofAuthoringSkeletonError(
    "proof_authoring_pack_invalid", "one exact selectedPack is required");
  const supported = new Set([
    "profile_id", "profile_version", "profileId", "profileVersion",
    "evaluation_input_path"
  ]);
  const unsupported = unsupportedPackageKeys(pack, supported);
  if (unsupported.length > 0) throw new ProofAuthoringSkeletonError(
    "proof_authoring_pack_invalid",
    "selectedPack accepts only the exact admitted pack identity and input path",
    { unsupported_options: unsupported.map(String).sort(compareCodeUnits) }
  );
  const profileId = pack.profile_id ?? pack.profileId;
  const profileVersion = pack.profile_version ?? pack.profileVersion;
  if (typeof profileId !== "string" || !profileId ||
      typeof profileVersion !== "string" || !profileVersion) {
    throw new ProofAuthoringSkeletonError("proof_authoring_pack_invalid",
      "selectedPack requires an exact profile id and version");
  }
  const result = { profile_id: profileId, profile_version: profileVersion };
  if (pack.evaluation_input_path !== undefined) {
    if (typeof pack.evaluation_input_path !== "string" || !pack.evaluation_input_path) {
      throw new ProofAuthoringSkeletonError("proof_authoring_pack_invalid",
        "evaluation_input_path must be a non-empty string");
    }
    result.evaluation_input_path = pack.evaluation_input_path;
  }
  return result;
}

function assertOneSuppliedEvaluationStage(bindings) {
  const supplied = EVALUATION_STAGE_ALIASES.filter((alias) =>
    bindings[alias] !== undefined);
  if (supplied.length < 2) return;
  throw new ProofAuthoringSkeletonError(
    "proof_authoring_evaluation_stage_conflict",
    "the evaluation stage was supplied twice; provide evaluation_stage or evaluationStage, not both",
    {

      evaluation_stage: bindings.evaluation_stage,
      evaluationStage: bindings.evaluationStage,
      canonical_field: EVALUATION_STAGE_ALIASES[0],
      supplied_aliases: [...EVALUATION_STAGE_ALIASES]
    }
  );
}

function bindingInput(input) {
  if (input.evaluationInput !== undefined && input.evaluation_input !== undefined) {
    throw new ProofAuthoringSkeletonError(
      "proof_authoring_bindings_invalid",
      "provide evaluationInput or evaluation_input, not both");
  }
  if (input.bindings !== undefined &&
      (input.evaluationInput !== undefined || input.evaluation_input !== undefined)) {
    throw new ProofAuthoringSkeletonError(
      "proof_authoring_bindings_invalid",
      "provide bindings or evaluationInput, not both");
  }
  const supplied = input.evaluationInput ?? input.evaluation_input ?? null;
  const bindings = input.bindings ?? null;
  if (supplied !== null && bindings !== null) throw new ProofAuthoringSkeletonError(
    "proof_authoring_bindings_invalid", "provide bindings or evaluationInput, not both");
  if (supplied !== null) {
    if (!plain(supplied)) throw new ProofAuthoringSkeletonError(
      "proof_authoring_bindings_invalid", "evaluationInput must be a plain object");
    return {
      ...structuredClone(supplied),
      [STAGE_ROUTE]: "evaluation_input",
      [STAGE_SUPPLIED]: supplied.evaluation_stage !== undefined
    };
  }
  if (bindings !== null && !plain(bindings)) throw new ProofAuthoringSkeletonError(
    "proof_authoring_bindings_invalid", "bindings must be a plain object");
  const value = bindings ?? {};
  assertOneSuppliedEvaluationStage(value);
  const references = value.reference_bindings ?? value.referenceBindings ?? [];
  const numbers = value.number_bindings ?? value.numberBindings ?? [];
  if (!Array.isArray(references) || !Array.isArray(numbers)) throw new ProofAuthoringSkeletonError(
    "proof_authoring_bindings_invalid", "typed bindings must be arrays");
  return {
    input_version: INPUT_VERSION,
    evaluation_stage: value.evaluation_stage ?? value.evaluationStage ?? "pre_dispatch",
    reference_bindings: structuredClone(references),
    number_bindings: structuredClone(numbers),
    claim_pattern_bindings: structuredClone(
      value.claim_pattern_bindings ?? value.claimPatternBindings ?? []
    ),
    resolver_facts: structuredClone(value.resolver_facts ?? value.resolverFacts ?? []),
    delivered_evidence: structuredClone(
      value.delivered_evidence ?? value.deliveredEvidence ?? []
    ),
    stable_evaluation: structuredClone(value.stable_evaluation ?? value.stableEvaluation ?? {}),
    [STAGE_ROUTE]: "typed",
    [STAGE_SUPPLIED]: value.evaluation_stage !== undefined ||
      value.evaluationStage !== undefined
  };
}

function validateInput(input) {
  if (!plain(input)) throw new ProofAuthoringSkeletonError(
    "proof_authoring_input_invalid", "authoring skeleton accepts one plain input object");
  const supported = new Set([
    "contract", "selectedPack", "selected_pack", "requestedIntents",
    "requested_intents", "focus", "bindings", "evaluationInput",
    "evaluation_input", "continuation", "currentProofPlanRequest",
    "current_proof_plan_request"
  ]);
  const unsupported = unsupportedPackageKeys(input, supported);
  if (unsupported.length > 0) throw new ProofAuthoringSkeletonError(
    "proof_authoring_input_invalid",
    "authoring skeleton accepts no caller catalog, package, path, or substrate override",
    { unsupported_options: unsupported.map(String).sort(compareCodeUnits) }
  );
  const contract = input.contract;
  if (!plain(contract)) throw new ProofAuthoringSkeletonError(
    "proof_authoring_contract_invalid", "a controlled contract is required");
  const resolved = validateStableTestProofContract(contract);
  if (!resolved.valid) throw new ProofAuthoringSkeletonError(
    "proof_authoring_contract_invalid", "the controlled contract is schema-invalid",
    {
      contract_family: resolved.family,
      facts: structuredClone(resolved.facts),
      diagnostics: structuredClone(resolved.diagnostics)
    });
  if (input.requestedIntents !== undefined && input.requested_intents !== undefined) {
    throw new ProofAuthoringSkeletonError(
      "proof_authoring_input_invalid",
      "provide requestedIntents or requested_intents, not both");
  }
  const currentRequest = input.currentProofPlanRequest ??
    input.current_proof_plan_request ?? null;
  if (currentRequest !== null && !plain(currentRequest)) {
    throw new ProofAuthoringSkeletonError("proof_authoring_input_invalid",
      "currentProofPlanRequest must be the canonical request object");
  }
  return {
    contract,
    pack: selectedPack(input),
    requestedIntents: strings(input.requestedIntents ?? input.requested_intents,
      "requestedIntents", { required: true }),
    focus: input.focus === undefined ? null : structuredClone(input.focus),
    evaluationInput: bindingInput(input),
    continuation: input.continuation ?? null,
    currentProofPlanRequest: currentRequest
  };
}

function packOrder(left, right) {
  return compareCodeUnits(`${left.profile_id}\0${left.profile_version}`,
    `${right.profile_id}\0${right.profile_version}`);
}

function composeProofPlanRequest({ current, pack, requestedIntents }) {
  const currentPacks = Array.isArray(current?.selected_packs)
    ? current.selected_packs.filter(plain) : [];
  const currentIntents = Array.isArray(current?.requested_intents)
    ? current.requested_intents.filter((value) => typeof value === "string") : [];
  for (const selected of currentPacks) {
    const sameIdentity = selected.profile_id === pack.profile_id &&
      selected.profile_version === pack.profile_version;
    if (!sameIdentity && selected.profile_id === pack.profile_id) {
      throw new ProofAuthoringSkeletonError(
        "proof_authoring_profile_version_conflict",
        "the canonical request already selects another version of this proof profile",
        {
          pointer: "/selected_pack/profile_version",
          profile_id: pack.profile_id,
          requested_profile_version: pack.profile_version,
          selected_profile_version: selected.profile_version
        }
      );
    }
    if (!sameIdentity && selected.evaluation_input_path === pack.evaluation_input_path) {
      throw new ProofAuthoringSkeletonError(
        "proof_authoring_evaluation_input_path_conflict",
        "the composed evaluation-input basename is already bound to another selected pack",
        {
          pointer: "/selected_pack/evaluation_input_path",
          evaluation_input_path: pack.evaluation_input_path,
          bound_profile_id: selected.profile_id,
          bound_profile_version: selected.profile_version
        }
      );
    }
  }
  const composed = currentPacks
    .filter((selected) => selected.profile_id !== pack.profile_id ||
      selected.profile_version !== pack.profile_version)
    .map((selected) => structuredClone(selected));
  composed.push(structuredClone(pack));
  composed.sort(packOrder);
  return {
    ...(current === null ? {} : structuredClone(current)),
    schema_version: REQUEST_VERSION,
    requested_intents: [...new Set([...currentIntents, ...requestedIntents])]
      .sort(compareCodeUnits),
    selected_packs: composed
  };
}

function selectedVerificationBundles(contract, authoring) {
  const methodsByPattern = new Map(
    (authoring?.proof_obligations?.claim_patterns ?? [])
      .filter(({ claim_kind: claimKind, verification_methods: methods }) =>
        claimKind === "verification" && Array.isArray(methods))
      .map(({ pattern_id: patternId, verification_methods: methods }) => [
        patternId, new Set(methods)
      ])
  );
  return (contract.claims ?? [])
    .filter((claim) => {
      if (claim.kind !== "verification") return false;
      const patternId = claim.claim_pattern_id ?? claim.pattern_id ?? claim.claim_pattern;
      return typeof patternId === "string" &&
        methodsByPattern.get(patternId)?.has(claim.verification_method);
    })
    .map(({ claim_id: verificationId }) => buildVerificationBundleTemplate({
      verificationId
    }))
    .sort((left, right) => compareCodeUnits(
      left.verification_id, right.verification_id
    ));
}

function unresolvedRoles({ authoring, inspection, validation, evaluationInput }) {
  const suppliedReferences = new Map((evaluationInput.reference_bindings ?? []).map(
    ({ role, reference_ids: referenceIds }) => [role, referenceIds]
  ));
  const suppliedNumbers = new Map((evaluationInput.number_bindings ?? []).map(
    ({ role, value }) => [role, value]
  ));

  const validationByRole = new Map([
    ...validation.reference_roles.map((entry) => [`reference\0${entry.role}`, entry]),
    ...validation.number_roles.map((entry) => [`number\0${entry.role}`, entry])
  ]);
  const roleIndex = new Map(inspection.role_index.map((entry) => [
    `${entry.kind}\0${entry.role}`, entry
  ]));
  const descriptors = [
    ...authoring.evaluation_input_skeleton.reference_bindings.map((role) => ({
      kind: "reference", role: role.role, cardinality: role.cardinality,
      supplied: suppliedReferences.has(role.role)
        ? { reference_ids: suppliedReferences.get(role.role) } : null
    })),
    ...authoring.evaluation_input_skeleton.number_bindings.map((role) => ({
      kind: "number", role: role.role, cardinality: role.cardinality,
      supplied: suppliedNumbers.has(role.role)
        ? { value: suppliedNumbers.get(role.role) } : null
    }))
  ];
  return descriptors.map((descriptor) => {
    const key = `${descriptor.kind}\0${descriptor.role}`;
    const indexed = roleIndex.get(key);
    const checked = validationByRole.get(key);
    if (indexed === undefined || checked === undefined) {
      throw new ProofAuthoringSkeletonError(
        "proof_authoring_role_population_incomplete",
        "the pack projection, binding page, and binding validation disagree about the role population",
        { role_kind: descriptor.kind, role: descriptor.role }
      );
    }
    return {
      ...descriptor,
      status: descriptor.supplied === null ? indexed.status : checked.status,
      diagnostics: structuredClone(checked.diagnostics ?? [])
    };
  }).filter(({ status, cardinality, supplied }) => status !== "validly_bound" &&
    !( ["zero_or_one", "zero_or_more"].includes(cardinality) && supplied === null))
    .map(({ kind, role, status, diagnostics }) => ({ kind, role, status, diagnostics }))
    .sort((left, right) => compareCodeUnits(`${left.kind}\0${left.role}`, `${right.kind}\0${right.role}`));
}

function assertContinuation(continuation, identity, contractDigest) {
  if (continuation === null || continuation === undefined) return;
  if (!plain(continuation) || typeof continuation.identity_digest !== "string" ||
      !plain(continuation.identity) ||
      continuation.schema_version !== CONTINUATION_SCHEMA_VERSION ||
      continuation.package_version !== PACKAGE_VERSION) {
    throw new ProofAuthoringSkeletonError("proof_authoring_continuation_tampered",
      "the supplied continuation is malformed");
  }
  const copy = structuredClone(continuation);
  delete copy.identity_digest;
  if (canonicalDigest(copy.identity) !== continuation.identity_digest) {
    throw new ProofAuthoringSkeletonError("proof_authoring_continuation_tampered",
      "the supplied continuation does not match its content");
  }
  if (continuation.contract_digest !== contractDigest) throw new ProofAuthoringSkeletonError(
    "proof_authoring_continuation_stale",
    "the supplied continuation belongs to a different controlled contract");
  if (continuation.identity_digest !== identity) throw new ProofAuthoringSkeletonError(
    "proof_authoring_continuation_stale",
    "the supplied continuation does not identify the requested authoring semantics");
}

const UNCONDITIONAL = Object.freeze({ mode: "unconditional", operand_reference_ids: [] });

function generatedReference(referenceId, typeTerm, identity) {
  return { reference_id: referenceId, type_term: typeTerm, identity };
}

function generatedProposition(propositionId, subjectReferenceId, operator, operands,
  applicabilityContext = UNCONDITIONAL) {
  return {
    proposition_id: propositionId,
    subject_reference_id: subjectReferenceId,
    operator,
    applicability_context: structuredClone(applicabilityContext),
    operands
  };
}

function generatedClaim(claimId, propositionId, kind = "evidence", extra = {}) {
  return { claim_id: claimId, kind, modality: "MUST", proposition_id: propositionId, ...extra };
}

function appendGeneratedContractGraph({ contract, record, focus, sourceMap, paths }) {
  const stem = focus === null ? record.id : `${record.id}-${focus}`;
  const repository = record.repo;
  const artifactReferences = [
    ["ref-integration-dag", "dag"],
    ["ref-integration-units", "units"],
    ["ref-execution-paths", "paths"],
    ["ref-prefix-census", "census"]
  ].map(([referenceId, suffix]) => generatedReference(referenceId, "cc:artifact", {
    kind: "repository_path",
    repository,
    path: `wiki/contracts/${stem}.integration-prefix-${suffix}.json`
  }));
  const fixedReferences = [
    generatedReference("ref-prefix-case-population", "cc:population", {
      kind: "durable_id", domain: `${repository}:${record.id}:integration-prefix`,
      value: "complete-case-population"
    }),
    generatedReference("ref-prefix-preservation-result", "cc:evidence", {
      kind: "durable_id", domain: `${repository}:${record.id}:integration-prefix`,
      value: "preservation-result"
    }),
    generatedReference("ref-prefix-preserved-state", "cc:state", {
      kind: "durable_id", domain: `${repository}:${record.id}:integration-prefix`,
      value: "preserved"
    }),
    generatedReference("ref-prefix-verification", "cc:process", {
      kind: "durable_id", domain: `${repository}:${record.id}`,
      value: "integration-prefix-proof-plan-build"
    }),
    generatedReference("ref-prefix-case-failure-condition", "cc:criterion", {
      kind: "durable_id", domain: `${repository}:${record.id}:integration-prefix`,
      value: "case-not-preserved"
    })
  ];
  const cases = sourceMap.projection.cases;
  const caseReferences = cases.map(({ case_id: caseId }) => generatedReference(
    `ref-${caseId}`, "cc:evidence", {
      kind: "durable_id", domain: `${repository}:${record.id}:integration-prefix-case`,
      value: caseId
    }
  ));
  const caseOperands = cases.map(({ case_id: caseId }) => ({
    kind: "reference", reference_id: `ref-${caseId}`
  }));
  const propositions = [
    generatedProposition("prop-integration-prefix-case-population-members",
      "ref-prefix-case-population", "reference:contains", caseOperands),
    generatedProposition("prop-integration-prefix-case-population-cardinality",
      "ref-prefix-case-population", "number:has_cardinality", [{
        kind: "number", value: cases.length
      }]),
    generatedProposition("prop-integration-prefix-census-includes-population",
      "ref-prefix-census", "reference:includes", [{
        kind: "reference", reference_id: "ref-prefix-case-population"
      }]),
    generatedProposition("prop-integration-prefix-result-records-population",
      "ref-prefix-preservation-result", "reference:records", [{
        kind: "reference", reference_id: "ref-prefix-case-population"
      }]),
    generatedProposition("prop-integration-prefix-all-cases-preserved",
      "ref-prefix-preservation-result", "reference:equals", [{
        kind: "reference", reference_id: "ref-prefix-preserved-state"
      }]),
    generatedProposition("prop-integration-prefix-verification-reads-capture",
      "ref-prefix-verification", "reference:reads", [
        { kind: "reference", reference_id: "ref-integration-dag" },
        { kind: "reference", reference_id: "ref-integration-units" },
        { kind: "reference", reference_id: "ref-execution-paths" },
        { kind: "reference", reference_id: "ref-prefix-census" },
        ...caseOperands,
        { kind: "reference", reference_id: "ref-prefix-preservation-result" }
      ]),
    generatedProposition("prop-integration-prefix-verification-covers-result",
      "ref-prefix-verification", "reference:covers", [{
        kind: "reference", reference_id: "ref-prefix-preservation-result"
      }]),
    generatedProposition("prop-integration-prefix-verification-falsifier",
      "ref-prefix-preservation-result", "reference:not_equals", [{
        kind: "reference", reference_id: "ref-prefix-preserved-state"
      }], {
        mode: "when", operand_reference_ids: ["ref-prefix-case-failure-condition"]
      }),
    ...cases.map(({ case_id: caseId }) => generatedProposition(
      `prop-integration-prefix-preserved-${caseId}`,
      `ref-${caseId}`, "reference:has_state", [{
        kind: "reference", reference_id: "ref-prefix-preserved-state"
      }]
    ))
  ];
  const claims = [
    generatedClaim("claim-integration-prefix-case-population-members",
      "prop-integration-prefix-case-population-members"),
    generatedClaim("claim-integration-prefix-case-population-cardinality",
      "prop-integration-prefix-case-population-cardinality"),
    generatedClaim("claim-integration-prefix-census-includes-population",
      "prop-integration-prefix-census-includes-population"),
    generatedClaim("claim-integration-prefix-result-records-population",
      "prop-integration-prefix-result-records-population"),
    generatedClaim("claim-integration-prefix-all-cases-preserved",
      "prop-integration-prefix-all-cases-preserved", "behavior"),
    generatedClaim("claim-integration-prefix-verification-reads-capture",
      "prop-integration-prefix-verification-reads-capture"),
    generatedClaim("claim-integration-prefix-verification-covers-result",
      "prop-integration-prefix-verification-covers-result", "verification", {
        verification_method: "analysis",
        falsifying_proposition_id: "prop-integration-prefix-verification-falsifier"
      }),
    ...cases.map(({ case_id: caseId }) => generatedClaim(
      `claim-integration-prefix-preserved-${caseId}`,
      `prop-integration-prefix-preserved-${caseId}`
    ))
  ];
  const generatedReferenceIds = new Set([
    ...artifactReferences, ...fixedReferences, ...caseReferences
  ].map(({ reference_id: referenceId }) => referenceId));
  const next = structuredClone(contract);
  next.references = (next.references ?? []).filter((reference) =>
    !generatedReferenceIds.has(reference.reference_id) &&
    reference?.identity?.domain !== `${repository}:${record.id}:integration-prefix-case`)
    .concat(artifactReferences, fixedReferences, caseReferences);
  next.propositions = (next.propositions ?? []).filter(({ proposition_id: propositionId }) =>
    !propositionId.startsWith("prop-integration-prefix-" )).concat(propositions);
  next.claims = (next.claims ?? []).filter(({ claim_id: claimId }) =>
    !claimId.startsWith("claim-integration-prefix-" )).concat(claims);
  next.relations = (next.relations ?? []).filter(({ relation_id: relationId }) =>
    relationId !== "rel-integration-prefix-verification-target").concat([{
    relation_id: "rel-integration-prefix-verification-target",
    role: "verifies",
    source_claim_id: "claim-integration-prefix-verification-covers-result",
    target_claim_id: "claim-integration-prefix-all-cases-preserved"
  }]);
  const resolved = validateAndResolveNativeContractV1(next);
  if (!resolved.schema_valid || resolved.diagnostics.length > 0) integrationFailure(
    "generated_contract_invalid", "generated integration-prefix contract graph is invalid",
    { diagnostics: [...resolved.schema_errors, ...resolved.diagnostics] });
  return next;
}

function canonicalEvaluationFilename(wkId, focus) {
  return `${focus === null ? wkId : `${wkId}-${focus}`}.evaluation-input.json`;
}

function integrationEvaluationInput(sourceMap) {
  return {
    input_version: INPUT_VERSION,
    evaluation_stage: "pre_dispatch",
    reference_bindings: [
      ["integration_dag", ["ref-integration-dag"]],
      ["integration_units", ["ref-integration-units"]],
      ["execution_paths", ["ref-execution-paths"]],
      ["prefix_census", ["ref-prefix-census"]],
      ["prefix_case_population", ["ref-prefix-case-population"]],
      ["prefix_cases", sourceMap.projection.cases.map(({ case_id: caseId }) => `ref-${caseId}`)],
      ["preservation_result", ["ref-prefix-preservation-result"]],
      ["preserved_state", ["ref-prefix-preserved-state"]],
      ["verification", ["ref-prefix-verification"]],
      ["case_failure_condition", ["ref-prefix-case-failure-condition"]]
    ].map(([role, referenceIds]) => ({ role, reference_ids: referenceIds })),
    number_bindings: [{ role: "case_count", value: sourceMap.projection.cases.length }],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [],
    stable_evaluation: {}
  };
}

function integrationArtifactMembers({ record, focus, authored }) {
  const stem = focus === null ? record.id : `${record.id}-${focus}`;
  const values = {
    "dag-source": authored.dag,
    "execution-paths": authored.execution_paths,
    "integration-units": authored.integration_units,
    "prefix-census": authored.source_map.projection
  };
  return Object.keys(INTEGRATION_ARTIFACT_SUFFIXES).sort(compareCodeUnits).map(
    (artifactRole) => {
      const bytes = canonicalJsonBytes(values[artifactRole], { file: true });
      return {
        artifact_role: artifactRole,
        filename: `${stem}.${INTEGRATION_ARTIFACT_SUFFIXES[artifactRole]}`,
        byte_length: bytes.byteLength,
        content_digest: `sha256:${sha256(bytes)}`,
        bytes_base64: bytes.toString("base64")
      };
    }
  );
}

function integrationCapture({ record, focus, evaluationFilename, artifactMembers }) {
  const stem = focus === null ? record.id : `${record.id}-${focus}`;
  const byRole = new Map(artifactMembers.map((member) => [member.artifact_role, member]));
  return {
    capture_root: ".",
    contract_path: `${stem}.controlled-acceptance.json`,
    evaluation_input_path: evaluationFilename,
    sources: Object.fromEntries([...byRole].sort(([left], [right]) =>
      compareCodeUnits(left, right)).map(([artifactRole, member]) => [
      artifactRole,
      { kind: "artifact_file", relative_path: member.filename }
    ]))
  };
}

async function buildIntegrationPrefixAuthoring(input) {
  const allowed = new Set([
    "canonicalRecord", "contract", "mappingContract", "mappingContracts", "slices", "proofPlanRequest",
    "evaluationInputs", "focus"
  ]);
  const unsupported = unsupportedPackageKeys(input, allowed);
  if (unsupported.length > 0) integrationFailure("authority_forbidden",
    "integration-prefix authoring accepts no caller graph, path, root, repository, policy, completeness, or pack-selection input",
    { unsupported_options: unsupported.map(String).sort(compareCodeUnits) });
  const record = exactPlain(input.canonicalRecord, "canonicalRecord");
  const request = exactPlain(input.proofPlanRequest, "proofPlanRequest");
  const evaluations = exactPlain(input.evaluationInputs, "evaluationInputs");
  let requestedIntents;
  try {
    requestedIntents = strings(request.requested_intents,
      "proofPlanRequest.requested_intents", { required: true });
  } catch (error) {
    integrationFailure("input_invalid", error.message, error.details);
  }
  const focus = input.focus ?? null;
  let authored;
  if (input.mappingContract !== undefined) {
    authored = buildIntegrationPrefixSourceMap({
      canonicalRecord: record, contract: input.contract,
      mappingContract: input.mappingContract, slices: input.slices, focus
    });
  } else {
    const candidates = [];
    for (const mappingContract of exactArray(input.mappingContracts, "mappingContracts")) {
      try {
        candidates.push(buildIntegrationPrefixSourceMap({
          canonicalRecord: record, contract: input.contract,
          mappingContract, slices: input.slices, focus
        }));
      } catch (error) {
        if (!(error instanceof ProofAuthoringSkeletonError) ||
            !error.code.startsWith("integration_prefix_")) throw error;
      }
    }
    if (candidates.length !== 1) integrationFailure("mapping_contract_ambiguous",
      "canonical related contracts did not provide one unique complete typed ownership mapping",
      { compatible_mapping_contract_count: candidates.length });
    [authored] = candidates;
  }
  let selection;
  try {
    selection = selectProofPacks({
      contract: input.contract,
      requestedIntents: [INTEGRATION_INTENT]
    });
  } catch (error) {
    integrationFailure(error.code ?? "pack_selection_invalid", error.message, error.details);
  }
  const selected = selection.selected_packs ?? [];
  if (selected.length !== 1 || selection.ambiguous_intents?.length > 0 ||
      selection.uncovered_intents?.length > 0 ||
      selected[0].profile_id !== INTEGRATION_PROFILE.profile_id ||
      selected[0].profile_version !== INTEGRATION_PROFILE.profile_version) integrationFailure(
    "pack_selection_ambiguous", "package catalog did not select one exact integration-prefix pack",
    { selection: structuredClone(selection) });
  const evaluationFilename = canonicalEvaluationFilename(record.id, focus);
  const updatedContract = appendGeneratedContractGraph({
    contract: input.contract, record, focus, sourceMap: authored.source_map,
    paths: authored.execution_paths
  });
  const integrationInput = integrationEvaluationInput(authored.source_map);
  const currentPacks = exactArray(request.selected_packs,
    "proofPlanRequest.selected_packs");
  if (currentPacks.some((pack) => !plain(pack))) integrationFailure(
    "input_invalid", "proofPlanRequest.selected_packs must contain plain objects");
  const integrationPacks = currentPacks.filter(({ profile_id: profileId,
    profile_version: profileVersion }) => profileId === INTEGRATION_PROFILE.profile_id &&
    profileVersion === INTEGRATION_PROFILE.profile_version);
  if (integrationPacks.length > 1) integrationFailure("pack_population_invalid",
    "proof-plan request contains duplicate integration-prefix selections");
  for (const pack of currentPacks) {
    if (!plain(pack) || typeof pack.evaluation_input_path !== "string" ||
        !Object.hasOwn(evaluations, pack.evaluation_input_path)) integrationFailure(
      "evaluation_population_incomplete",
      "the complete evaluation population must include every currently selected pack input",
      { evaluation_input_path: pack?.evaluation_input_path ?? null });
    if (pack.evaluation_input_path === evaluationFilename &&
        (pack.profile_id !== INTEGRATION_PROFILE.profile_id ||
         pack.profile_version !== INTEGRATION_PROFILE.profile_version)) integrationFailure(
      "evaluation_identity_ambiguous",
      "the canonical root or focus evaluation input is already bound to another pack");
  }
  const artifactMembers = integrationArtifactMembers({ record, focus, authored });
  const exactCapture = integrationCapture({
    record, focus, evaluationFilename, artifactMembers
  });
  const integrationPack = {
    ...INTEGRATION_PROFILE,
    evaluation_input_path: evaluationFilename,
    exact_capture: exactCapture
  };
  let updatedRequest;
  try {
    updatedRequest = composeProofPlanRequest({
      current: request,
      pack: integrationPack,
      requestedIntents: [INTEGRATION_INTENT, ...requestedIntents]
    });
  } catch (error) {
    const code = error.code === "proof_authoring_profile_version_conflict"
      ? "profile_version_conflict"
      : error.code === "proof_authoring_evaluation_input_path_conflict"
        ? "evaluation_input_path_conflict"
        : error.code ?? "request_invalid";
    integrationFailure(code, error.message, error.details);
  }
  const selectedPacks = updatedRequest.selected_packs;
  const updatedEvaluations = structuredClone(evaluations);
  updatedEvaluations[evaluationFilename] = integrationInput;
  let binding;
  let proofPlan;
  try {
    binding = await validateSuppliedProofPackBindings({
      contract: updatedContract,
      profileId: INTEGRATION_PROFILE.profile_id,
      profileVersion: INTEGRATION_PROFILE.profile_version,
      evaluationInput: integrationInput
    });
    if (binding.summary.status !== "valid") integrationFailure(
      "generated_binding_invalid", "generated integration-prefix bindings are not admitted",
      { diagnostics: binding.evaluation_input_diagnostics });
    proofPlan = await buildProofPlan({
      contract: updatedContract,
      request: updatedRequest,
      evaluationInputs: updatedEvaluations
    });
  } catch (error) {
    if (error instanceof ProofAuthoringSkeletonError) throw error;
    integrationFailure(error.code ?? "proof_plan_invalid", error.message, error.details);
  }
  const branches = authored.execution_paths.execution_paths.flatMap(
    ({ required_branches: requiredBranches }) => requiredBranches).sort(compareCodeUnits);
  const result = {
    schema_version: "controlled-contract-integration-prefix-authoring.v1",
    identity: {
      repository: record.repo,
      wk_id: record.id,
      focus,
      profile_id: INTEGRATION_PROFILE.profile_id,
      profile_version: INTEGRATION_PROFILE.profile_version
    },
    dag: authored.dag,
    integration_units: authored.integration_units,
    execution_paths: authored.execution_paths,
    branches,
    source_map: authored.source_map,
    capture_roots: { integration_prefix: exactCapture },
    artifact_members: artifactMembers,
    contract: updatedContract,
    proof_plan_request: updatedRequest,
    evaluation_inputs: updatedEvaluations,
    proof_plan: proofPlan,
    counts: {
      claims: authored.source_map.claim_bindings.length,
      units: authored.integration_units.integration_units.length,
      paths: authored.execution_paths.execution_paths.length,
      branches: branches.length,
      prefixes: authored.source_map.projection.prefixes.length,
      cases: authored.source_map.projection.cases.length,
      selected_packs: selectedPacks.length,
      evaluation_inputs: Object.keys(updatedEvaluations).length
    }
  };
  result.digests = {
    contract: canonicalDigest(normalizeContractForIdentity(updatedContract)),
    proof_plan_request: sha256(canonicalJsonBytes(updatedRequest)),
    evaluation_inputs: sha256(canonicalJsonBytes(updatedEvaluations)),
    proof_plan: sha256(canonicalJsonBytes(proofPlan)),
    artifact_members: sha256(canonicalJsonBytes(artifactMembers)),
    source_map: sha256(canonicalJsonBytes(authored.source_map)),
    result: sha256(canonicalJsonBytes(result))
  };
  return deepFreeze(canonicalValue(result));
}

async function buildProofAuthoringSkeleton(input, ...unexpectedArguments) {
  if (unexpectedArguments.length) throw new ProofAuthoringSkeletonError(
    "proof_authoring_input_invalid", "authoring skeleton accepts exactly one argument");
  if (plain(input) && ["canonicalRecord", "mappingContract", "mappingContracts", "slices", "proofPlanRequest",
    "evaluationInputs"].some((key) => Object.hasOwn(input, key))) {
    return buildIntegrationPrefixAuthoring(input);
  }
  const value = validateInput(input);
  let authoring;
  try {
    authoring = describeProofPackAuthoring({
      profileId: value.pack.profile_id,
      profileVersion: value.pack.profile_version,
      requestedIntents: value.requestedIntents
    });
  } catch (error) {
    throw new ProofAuthoringSkeletonError(error.code ?? "proof_authoring_pack_invalid",
      error.message, error.details);
  }

  const allowedStages = authoring.evaluation_input_skeleton.allowed_evaluation_stages;
  const stageRoute = value.evaluationInput[STAGE_ROUTE];
  const stageSupplied = value.evaluationInput[STAGE_SUPPLIED];
  delete value.evaluationInput[STAGE_ROUTE];
  delete value.evaluationInput[STAGE_SUPPLIED];
  if (stageSupplied) {
    const stage = value.evaluationInput.evaluation_stage;
    if (!allowedStages.includes(stage)) throw new ProofAuthoringSkeletonError(
      "proof_authoring_evaluation_stage_invalid",
      "the supplied bindings specify an evaluation stage unsupported by the selected pack",
      { evaluation_stage: stage, allowed_evaluation_stages: allowedStages }
    );
  } else if (stageRoute === "typed") {
    if (allowedStages.length !== 1) throw new ProofAuthoringSkeletonError(
      "proof_authoring_evaluation_stage_unresolved",
      "typed bindings require a caller evaluation stage when the selected pack permits multiple stages",
      { allowed_evaluation_stages: allowedStages }
    );
    value.evaluationInput.evaluation_stage = allowedStages[0];
  } else throw new ProofAuthoringSkeletonError(
    "proof_authoring_evaluation_stage_unresolved",
    "a supplied evaluation input must state its own evaluation stage",
    { allowed_evaluation_stages: allowedStages }
  );
  let validation;
  try {
    validation = await validateSuppliedProofPackBindings({
      contract: value.contract,
      profileId: value.pack.profile_id,
      profileVersion: value.pack.profile_version,
      evaluationInput: value.evaluationInput
    });
  } catch (error) {
    throw new ProofAuthoringSkeletonError(error.code ?? "proof_authoring_bindings_invalid",
      error.message, error.details);
  }
  const inspection = await inspectProofPackBindingsPage({
    contract: value.contract,
    profileId: value.pack.profile_id,
    profileVersion: value.pack.profile_version,
    requestedIntents: value.requestedIntents,
    evaluationInput: value.evaluationInput,
    maximumItems: 0
  });
  const path = value.pack.evaluation_input_path ?? "evaluation-input.json";
  const composedPack = { ...value.pack, evaluation_input_path: path };
  const skeleton = {
    schema_version: "controlled-contract-proof-authoring-skeleton.v1",
    contract_digest: canonicalDigest(normalizeContractForIdentity(value.contract)),
    selected_pack: composedPack,
    requested_intents: value.requestedIntents,
    focus: value.focus,
    evaluation_input: value.evaluationInput,
    verification_bundles: selectedVerificationBundles(value.contract, authoring),
    evaluation_input_skeleton: structuredClone(authoring.evaluation_input_skeleton),
    proof_plan_request: composeProofPlanRequest({
      current: value.currentProofPlanRequest,
      pack: composedPack,
      requestedIntents: value.requestedIntents
    }),
    unresolved_required_roles: unresolvedRoles({
      authoring, inspection, validation, evaluationInput: value.evaluationInput
    }),
    evaluation_input_diagnostics: structuredClone(
      validation.evaluation_input_diagnostics
    ),
    package_version: PACKAGE_VERSION
  };
  const identityBody = {
    contract: skeleton.contract_digest,
    pack: skeleton.selected_pack,
    intents: skeleton.requested_intents,
    focus: skeleton.focus,
    chosen_bindings: value.evaluationInput,
    package_version: PACKAGE_VERSION,
    continuation_schema_version: CONTINUATION_SCHEMA_VERSION
  };
  const identity = canonicalDigest(identityBody);
  const continuation = {
    schema_version: CONTINUATION_SCHEMA_VERSION,
    identity_digest: identity,
    contract_digest: skeleton.contract_digest,
    package_version: PACKAGE_VERSION,
    identity: identityBody
  };
  const result = {
    ...skeleton,
    continuation,
    digests: { contract: skeleton.contract_digest, authoring_projection: authoring.projection_digest,
      continuation: identity }
  };
  assertContinuation(value.continuation, identity, skeleton.contract_digest);
  return deepFreeze(canonicalValue(result));
}

const continueProofAuthoring = buildProofAuthoringSkeleton;
const canonicalProofAuthoringSkeletonJson = (result) =>
  Buffer.from(canonicalJsonBytes(result)).toString("utf8");

export {
  INTEGRATION_INTENT as INTEGRATION_PREFIX_INTENT,
  INTEGRATION_PROFILE as INTEGRATION_PREFIX_PROFILE,
  PACKAGE_VERSION,
  ProofAuthoringSkeletonError,
  canonicalEvaluationFilename,
  buildIntegrationPrefixSourceMap,
  buildProofAuthoringSkeleton,
  continueProofAuthoring,
  canonicalProofAuthoringSkeletonJson
};
