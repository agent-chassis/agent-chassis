

import { createHash } from "node:crypto";

import {
  ControlledContractToolError,
  controlledContractCarrierFilename,
  controlledContractContentDigest
} from "../../lib/controlled-contract-tools.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import {
  prepareControlledContractEmbeddedProofEvolution,
  validateControlledContractEmbeddedProofEvolution
} from "./embedded-proof-evolution.mjs";

export const CONTROLLED_CONTRACT_REFERENCE_CANDIDATES_SCHEMA =
  "controlled-contract-reference-candidates.v1";
export const CONTROLLED_CONTRACT_REFERENCE_AUTHORING_SCHEMA =
  "controlled-contract-reference-authoring.v1";

export const CONTROLLED_CONTRACT_REFERENCE_AUTHORING_OWNER = "contract_reference";

export const CONTROLLED_CONTRACT_REFERENCE_CANDIDATE_DISCLOSURE_LIMIT = 8;

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, {
    changed: false, limb: "mechanical_failure",
    owner: CONTROLLED_CONTRACT_REFERENCE_AUTHORING_OWNER, ...details
  });
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function resolveControlledContractReferenceCandidatePopulation({
  record, wkId, focus = null, recordSourceDigest
}) {
  const entries = Array.isArray(record?.derived_evidence)
    ? record.derived_evidence.filter((entry) =>
      plainObject(entry) &&
      entry.schema_version === CONTROLLED_CONTRACT_REFERENCE_CANDIDATES_SCHEMA)
    : [];
  if (entries.length === 0) {
    return Object.freeze({ present: false, reason_code:
      "controlled_contract_reference_candidate_population_absent" });
  }
  if (entries.length > 1) {

    fail("controlled_contract_reference_candidate_population_conflicting",
      "the work record carries more than one reference-candidate population",
      { population_count: entries.length });
  }
  const [population] = entries;
  if (population.record_id !== wkId) {
    fail("controlled_contract_reference_candidate_population_foreign",
      "the reference-candidate population addresses another work record",
      { expected_record_id: wkId, actual_record_id: population.record_id ?? null });
  }
  if ((population.focus ?? null) !== (focus ?? null)) {
    fail("controlled_contract_reference_candidate_population_foreign",
      "the reference-candidate population addresses another canonical focus",
      { expected_focus: focus ?? null, actual_focus: population.focus ?? null });
  }
  if (typeof recordSourceDigest !== "string" || recordSourceDigest.length === 0 ||
      population.source_record_digest !== recordSourceDigest) {
    fail("controlled_contract_reference_candidate_population_stale",
      "the reference-candidate population is not bound to the current record source",
      { expected_source_record_digest: recordSourceDigest ?? null });
  }
  const pack = population.selected_pack;
  if (!plainObject(pack) || typeof pack.profile_id !== "string" ||
      typeof pack.profile_version !== "string" ||
      !Array.isArray(pack.requested_intents) ||
      pack.requested_intents.length === 0) {
    fail("controlled_contract_reference_candidate_population_invalid",
      "the reference-candidate population declares no exact selected proof pack");
  }
  if (!Array.isArray(population.candidates) || population.candidates.length === 0) {
    fail("controlled_contract_reference_candidate_population_invalid",
      "the reference-candidate population declares no candidate referent");
  }
  const seen = new Set();
  const candidates = population.candidates.map((candidate) => {
    if (!plainObject(candidate) || typeof candidate.candidate_id !== "string" ||
        typeof candidate.type_term !== "string" ||
        !plainObject(candidate.identity) ||
        typeof candidate.identity.kind !== "string") {
      fail("controlled_contract_reference_candidate_population_invalid",
        "a candidate referent is malformed");
    }
    if (seen.has(candidate.candidate_id)) {
      fail("controlled_contract_reference_candidate_population_invalid",
        "a candidate referent identity is declared twice",
        { candidate_id: candidate.candidate_id });
    }
    seen.add(candidate.candidate_id);
    return Object.freeze({
      candidate_id: candidate.candidate_id,
      type_term: candidate.type_term,
      identity: Object.freeze(structuredClone(candidate.identity)),
      required_by: candidate.required_by === undefined
        ? null : Object.freeze(structuredClone(candidate.required_by))
    });
  });
  return Object.freeze({
    present: true,
    record_id: wkId,
    focus: focus ?? null,
    source_record_digest: recordSourceDigest,
    selected_pack: Object.freeze({
      profile_id: pack.profile_id, profile_version: pack.profile_version,
      requested_intents: Object.freeze([...pack.requested_intents])
    }),
    candidates: Object.freeze(candidates),
    population_digest: controlledContractContentDigest({
      record_id: wkId, focus: focus ?? null,
      source_record_digest: recordSourceDigest,
      selected_pack: population.selected_pack,
      candidates: population.candidates
    })
  });
}

export async function resolveControlledContractPackReferenceRoles({
  contract, evaluationInput = null, selectedPack, pkg = null
}) {
  const loaded = pkg ?? await loadControlledContractPackage();

  let admitted;
  try {
    admitted = await loaded.loadAdmittedProofPack(selectedPack.profile_id,
      selectedPack.profile_version);
  } catch (error) {
    fail(error?.code ?? "controlled_contract_reference_role_taxonomy_unavailable",
      error?.message ?? "the admitted proof pack could not be loaded",
      { profile_id: selectedPack.profile_id });
  }
  const declared = admitted.profile?.reference_roles ?? [];
  if (declared.length === 0) {
    fail("controlled_contract_reference_role_taxonomy_unavailable",
      "the admitted proof pack declares no reference role",
      { profile_id: selectedPack.profile_id });
  }

  let page;
  try {
    page = await loaded.inspectProofPackBindingsPage({
      contract, profileId: selectedPack.profile_id,
      profileVersion: selectedPack.profile_version,
      requestedIntents: [...selectedPack.requested_intents],
      evaluationInput, roles: declared.map(({ role }) => role),
      statuses: undefined, offset: 0, maximumItems: 128
    });
  } catch (error) {
    fail(error?.code ?? "controlled_contract_reference_role_taxonomy_unavailable",
      error?.message ?? "the proof-pack binding owner refused this contract",
      { profile_id: selectedPack.profile_id });
  }
  const observed = new Map();
  for (const entry of page.role_index ?? []) {
    if (entry?.kind !== "reference" || typeof entry.role !== "string") continue;
    observed.set(entry.role, { status: entry.status ?? null,
      supplied_binding: null,
      contract_candidates: [],
      compatible_candidate_count: entry.compatible_candidate_count ?? 0 });
  }
  for (const item of page.items ?? []) {
    const detail = item?.detail ?? {};
    const role = item?.role ?? detail.role ?? null;
    if (typeof role !== "string") continue;
    const value = observed.get(role) ?? { status: detail.status ?? null,
      supplied_binding: null, contract_candidates: [],
      compatible_candidate_count: 0 };
    if (detail.supplied_binding !== undefined && detail.supplied_binding !== null) {
      value.supplied_binding = detail.supplied_binding;
    }
    if (item.candidate) value.contract_candidates.push(item.candidate);
    observed.set(role, value);
  }
  return Object.freeze(declared.map((role) => {
    const seen = observed.get(role.role) ??
      { status: null, supplied_binding: null, contract_candidates: [],
        compatible_candidate_count: 0 };
    return Object.freeze({
      role: role.role,
      status: seen.status,
      compatible_candidate_count: seen.compatible_candidate_count ?? 0,
      cardinality: role.cardinality ?? null,
      allowed_type_terms: Object.freeze([...(role.allowed_type_terms ?? [])]),
      allowed_identity_kinds: Object.freeze([
        ...(role.allowed_identity_kinds ?? [])]),
      supplied_binding: seen.supplied_binding,
      contract_candidates: Object.freeze(seen.contract_candidates)
    });
  }));
}

function requiresAuthoring(role) {
  return role.status === "unbound" && role.compatible_candidate_count === 0 &&
    role.contract_candidates.length === 0;
}

function admissible(role, candidate) {
  return role.allowed_type_terms.includes(candidate.type_term) &&
    role.allowed_identity_kinds.includes(candidate.identity.kind);
}

function canonicalMaterial(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalMaterial).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalMaterial(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function controlledContractReferenceIdentity({
  wkId, focus = null, role, typeTerm, identity
}) {

  const material = canonicalMaterial({ wk_id: wkId, focus: focus ?? null, role,
    type_term: typeTerm, identity });
  const hash = createHash("sha256").update(material).digest("hex").slice(0, 40);
  return `ref-${hash}`;
}

export function resolveControlledContractReferenceAuthoringPlan({
  wkId, focus = null, roles, population, contract
}) {
  const declaredIdentities = new Map((contract.references ?? []).map(
    (reference) => [controlledContractContentDigest(reference.identity),
      reference]));
  const declaredIds = new Set((contract.references ?? []).map(
    ({ reference_id: id }) => id));
  const resolutions = [];
  for (const role of roles) {
    if (!requiresAuthoring(role)) continue;
    const compatible = population.candidates.filter((candidate) =>
      admissible(role, candidate));
    if (compatible.length === 0) {
      resolutions.push(Object.freeze({ role: role.role, status: "missing_facts",
        candidate_count: 0, candidate_ids: Object.freeze([]),
        reason_code:
          "controlled_contract_reference_authoritative_facts_missing" }));
      continue;
    }
    if (compatible.length > 1) {

      resolutions.push(Object.freeze({ role: role.role, status: "ambiguous",
        candidate_count: compatible.length,
        candidate_ids: Object.freeze([...compatible]
          .map(({ candidate_id: id }) => id).sort()
          .slice(0, CONTROLLED_CONTRACT_REFERENCE_CANDIDATE_DISCLOSURE_LIMIT)),
        reason_code: "controlled_contract_reference_candidate_ambiguous" }));
      continue;
    }
    const [candidate] = compatible;
    const identityDigest = controlledContractContentDigest(candidate.identity);
    const existing = declaredIdentities.get(identityDigest) ?? null;
    if (existing !== null) {

      if (!role.allowed_type_terms.includes(existing.type_term)) {
        resolutions.push(Object.freeze({ role: role.role,
          status: "incompatible_existing", candidate_count: 1,
          candidate_ids: Object.freeze([candidate.candidate_id]),
          existing_reference_id: existing.reference_id,
          reason_code:
            "controlled_contract_reference_existing_binding_incompatible" }));
        continue;
      }
      resolutions.push(Object.freeze({ role: role.role, status: "already_declared",
        candidate_count: 1, reference_id: existing.reference_id,
        candidate_ids: Object.freeze([candidate.candidate_id]) }));
      continue;
    }
    const referenceId = controlledContractReferenceIdentity({ wkId, focus,
      role: role.role, typeTerm: candidate.type_term,
      identity: candidate.identity });
    if (declaredIds.has(referenceId)) {
      fail("controlled_contract_reference_identity_collision",
        "the deterministic reference identity is already declared for another referent",
        { role: role.role, reference_id: referenceId });
    }
    resolutions.push(Object.freeze({ role: role.role, status: "authorable",
      candidate_count: 1, candidate_id: candidate.candidate_id,
      candidate_ids: Object.freeze([candidate.candidate_id]),
      reference_id: referenceId, type_term: candidate.type_term,
      identity: Object.freeze(structuredClone(candidate.identity)) }));
  }
  const blocking = resolutions.find(({ status }) =>
    status !== "authorable" && status !== "already_declared") ?? null;
  const authorable = resolutions.filter(({ status }) => status === "authorable");
  return Object.freeze({
    schema_version: "controlled-contract-reference-authoring-plan.v1",
    wk_id: wkId, focus: focus ?? null,
    selected_pack: population.selected_pack,
    candidate_population_digest: population.population_digest,
    resolutions: Object.freeze(resolutions),
    required_role_count: resolutions.length,
    authorable_role_count: authorable.length,

    status: blocking !== null ? blocking.status
      : resolutions.length === 0 ? "no_missing_role" : "unique",
    blocking_role: blocking?.role ?? null,
    blocking_reason_code: blocking?.reason_code ?? null,
    blocking_candidate_count: blocking?.candidate_count ?? null,
    blocking_candidate_ids: blocking?.candidate_ids ?? Object.freeze([])
  });
}

function bindingsWithRoles(evaluationInput, resolutions) {
  const bindings = structuredClone(evaluationInput.reference_bindings ?? []);
  for (const resolution of resolutions) {
    const referenceId = resolution.reference_id;
    const existing = bindings.find(({ role }) => role === resolution.role);
    if (existing === undefined) {
      bindings.push({ role: resolution.role, reference_ids: [referenceId] });
      continue;
    }
    if (!existing.reference_ids.includes(referenceId)) {
      existing.reference_ids = [...existing.reference_ids, referenceId];
    }
  }
  return bindings.sort((left, right) => left.role.localeCompare(right.role));
}

export async function prepareControlledContractReferenceAuthoring({
  wkId, focus = null, recordSourceDigest, startingGeneration,
  startingManifestDigest, sourceContract, contractFilename,
  evaluationInput, evaluationInputFilename, proofPlanRequest = null,
  evaluationInputs = {},
  requestFilename, proofPlanFilename, population, candidateDigest,
  lineageIdentity = null
}, { pkg = null, prepareEmbeddedProofs = prepareControlledContractEmbeddedProofEvolution
} = {}) {
  if (!plainObject(sourceContract) ||
      (evaluationInput !== null && !plainObject(evaluationInput)) ||
      typeof contractFilename !== "string" ||
      typeof evaluationInputFilename !== "string" ||
      typeof requestFilename !== "string" ||
      typeof proofPlanFilename !== "string" || !plainObject(population) ||
      population.present !== true) {
    fail("controlled_contract_reference_preparation_source_incomplete",
      "reference authoring requires the authenticated contract, input presence and candidate population");
  }
  if (typeof recordSourceDigest !== "string" ||
      recordSourceDigest !== population.source_record_digest) {
    fail("controlled_contract_reference_candidate_population_stale",
      "the candidate population is not bound to the leased record source");
  }
  if (population.record_id !== wkId || population.focus !== (focus ?? null)) {
    fail("controlled_contract_reference_candidate_population_foreign",
      "the candidate population addresses another canonical subject");
  }
  const loaded = pkg ?? await loadControlledContractPackage();
  const roles = await resolveControlledContractPackReferenceRoles({
    contract: sourceContract, evaluationInput,
    selectedPack: population.selected_pack, pkg: loaded });
  const plan = resolveControlledContractReferenceAuthoringPlan({
    wkId, focus, roles, population, contract: sourceContract });
  if (plan.status !== "unique") {
    fail(plan.blocking_reason_code ??
      "controlled_contract_reference_authoring_not_required",
    "the required reference roles are not uniquely determined by authenticated facts", {
      role: plan.blocking_role, candidate_count: plan.blocking_candidate_count,
      candidate_ids: plan.blocking_candidate_ids,
      required_role_count: plan.required_role_count });
  }
  const authorable = plan.resolutions.filter(({ status }) => status === "authorable");
  const prospectiveContract = structuredClone(sourceContract);
  prospectiveContract.references = [...(prospectiveContract.references ?? [])];
  for (const resolution of authorable) {
    prospectiveContract.references.push({
      reference_id: resolution.reference_id,
      type_term: resolution.type_term,
      identity: structuredClone(resolution.identity)
    });
  }
  const bound = plan.resolutions.filter(({ status }) =>
    status === "authorable" || status === "already_declared");

  const skeleton = await loaded.buildProofAuthoringSkeleton({
    contract: prospectiveContract, focus,
    selectedPack: { evaluation_input_path: evaluationInputFilename,
      profile_id: population.selected_pack.profile_id,
      profile_version: population.selected_pack.profile_version },
    requestedIntents: [...population.selected_pack.requested_intents],
    ...(proofPlanRequest === null ? {} : { currentProofPlanRequest: proofPlanRequest }),
    ...(evaluationInput === null
      ? { bindings: { reference_bindings: bindingsWithRoles({}, bound) } }
      : { evaluationInput: { ...structuredClone(evaluationInput),
        reference_bindings: bindingsWithRoles(evaluationInput, bound) } })
  });
  const prospectiveEvaluationInput = skeleton.evaluation_input;
  const prospectiveRequest = skeleton.proof_plan_request;

  const evolved = await prepareEmbeddedProofs({
    wkId, focus, sourceContract, prospectiveContract, contractFilename,
    proofPlanFilename, request: prospectiveRequest,
    evaluationInputs: { ...structuredClone(evaluationInputs),
      [evaluationInputFilename]: prospectiveEvaluationInput }
  }, { pkg: loaded });

  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_REFERENCE_AUTHORING_SCHEMA,
    owner: CONTROLLED_CONTRACT_REFERENCE_AUTHORING_OWNER,
    wk_id: wkId, focus: focus ?? null,
    plan,
    contract_filename: contractFilename,
    evaluation_input_filename: evaluationInputFilename,
    request_filename: requestFilename,
    proof_plan_filename: proofPlanFilename,
    contract: evolved.contract,
    proof_plan: evolved.proof_plan,

    evaluation_inputs: Object.freeze({
      [evaluationInputFilename]: prospectiveEvaluationInput,
      ...structuredClone(evolved.evaluation_inputs ?? {})
    }),
    request: prospectiveRequest,
    evolution: evolved,
    authored_references: Object.freeze(authorable.map((resolution) =>
      Object.freeze({ role: resolution.role,
        reference_id: resolution.reference_id,
        type_term: resolution.type_term }))),
    counts: Object.freeze({
      required_roles: plan.required_role_count,
      authored_references: authorable.length,
      candidate_population: population.candidates.length,
      removed_stable_test_proofs: evolved.counts.removed_stable_test_proofs,
      generated_stable_test_proofs: evolved.counts.generated_stable_test_proofs
    }),
    source_bindings: Object.freeze({
      record_source_digest: recordSourceDigest,
      starting_generation: startingGeneration ?? null,
      starting_manifest_content_digest: startingManifestDigest ?? null,
      source_contract_content_digest:
        controlledContractContentDigest(sourceContract),
      prospective_contract_content_digest:
        controlledContractContentDigest(evolved.contract),
      candidate_population_digest: population.population_digest,
      candidate_digest: candidateDigest ?? null,
      lineage_identity: lineageIdentity ?? null,
      selected_pack: population.selected_pack
    })
  });
}

export async function validateControlledContractReferenceAuthoringPreparation(
  prepared, { pkg = null } = {}
) {
  if (!plainObject(prepared) ||
      prepared.schema_version !== CONTROLLED_CONTRACT_REFERENCE_AUTHORING_SCHEMA ||
      !plainObject(prepared.contract) || !plainObject(prepared.proof_plan)) {
    fail("controlled_contract_reference_preparation_invalid",
      "prospective reference authoring is not one complete artifact set");
  }
  const loaded = pkg ?? await loadControlledContractPackage();

  await validateControlledContractEmbeddedProofEvolution(prepared.evolution,
    { pkg: loaded });

  const roles = await resolveControlledContractPackReferenceRoles({
    contract: prepared.contract,
    evaluationInput: prepared.evaluation_inputs[prepared.evaluation_input_filename]
      ?? null,
    selectedPack: prepared.plan.selected_pack, pkg: loaded });
  const byRole = new Map(roles.map((role) => [role.role, role]));
  for (const authored of prepared.authored_references) {
    const role = byRole.get(authored.role) ?? null;
    if (role === null) {
      fail("controlled_contract_reference_role_unknown",
        "an authored reference names a role the selected pack does not declare",
        { role: authored.role });
    }
    if (!role.allowed_type_terms.includes(authored.type_term)) {
      fail("controlled_contract_reference_type_incompatible",
        "an authored reference is not admissible for the role it was authored for",
        { role: authored.role, type_term: authored.type_term });
    }
    if (role.status !== "validly_bound") {
      fail("controlled_contract_reference_binding_invalid",
        "the prospective evaluation input does not validly bind the authored role",
        { role: authored.role, status: role.status ?? null });
    }
  }
  return prepared;
}

export function controlledContractReferenceAuthoringContributions(prepared) {
  return Object.freeze([
    Object.freeze({ owner: CONTROLLED_CONTRACT_REFERENCE_AUTHORING_OWNER,
      carrier_kind: "contract", filename: prepared.contract_filename,
      content: prepared.contract }),
    Object.freeze({ owner: CONTROLLED_CONTRACT_REFERENCE_AUTHORING_OWNER,
      carrier_kind: "proof_plan_request", filename: prepared.request_filename,
      content: prepared.request }),
    Object.freeze({ owner: CONTROLLED_CONTRACT_REFERENCE_AUTHORING_OWNER,
      carrier_kind: "proof_plan", filename: prepared.proof_plan_filename,
      content: prepared.proof_plan }),
    ...Object.entries(prepared.evaluation_inputs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filename, content]) => Object.freeze({
        owner: CONTROLLED_CONTRACT_REFERENCE_AUTHORING_OWNER,
        carrier_kind: "evaluation_input", filename, content }))
  ]);
}

export function projectControlledContractReferenceAuthoringReadiness(plan) {
  if (plan === null) return null;
  return Object.freeze({
    schema_version: "controlled-contract-reference-authoring-readiness.v1",
    status: plan.status,
    selected_pack: plan.selected_pack,
    candidate_population_digest: plan.candidate_population_digest,
    required_role_count: plan.required_role_count,
    authorable_role_count: plan.authorable_role_count,
    required_roles: Object.freeze(plan.resolutions.map(({ role, status,
      candidate_count: count }) => Object.freeze({ role, status,
      candidate_count: count }))),
    blocking_role: plan.blocking_role,
    blocking_reason_code: plan.blocking_reason_code,
    blocking_candidate_count: plan.blocking_candidate_count,
    blocking_candidate_ids: plan.blocking_candidate_ids
  });
}

async function assertCandidatesAreAdmissibleToPack({ selectedPack, candidates }) {
  const loaded = await loadControlledContractPackage();
  let admitted;
  try {
    admitted = await loaded.loadAdmittedProofPack(selectedPack.profile_id,
      selectedPack.profile_version);
  } catch (error) {
    fail(error?.code ?? "controlled_contract_reference_role_taxonomy_unavailable",
      error?.message ?? "the named proof pack is not an admitted pack",
      { profile_id: selectedPack.profile_id,
        profile_version: selectedPack.profile_version });
  }
  const roles = admitted.profile?.reference_roles ?? [];
  if (roles.length === 0) {
    fail("controlled_contract_reference_role_taxonomy_unavailable",
      "the named proof pack declares no reference role",
      { profile_id: selectedPack.profile_id });
  }
  const inadmissible = candidates.filter((candidate) => !roles.some((role) =>
    (role.allowed_type_terms ?? []).includes(candidate.type_term) &&
    (role.allowed_identity_kinds ?? []).includes(candidate.identity?.kind)));
  if (inadmissible.length > 0) {
    fail("controlled_contract_reference_candidate_population_invalid",
      "a candidate referent is admissible to no reference role the pack declares",
      { candidate_ids: inadmissible.map(({ candidate_id: id }) => id).sort()
        .slice(0, CONTROLLED_CONTRACT_REFERENCE_CANDIDATE_DISCLOSURE_LIMIT) });
  }
}

export async function persistControlledContractReferenceCandidatePopulation({
  repoRoot, wkId, focus = null, selectedPack, candidates, expectedSourceDigest
}, { loadRecord, writeRecord } = {}) {
  if (typeof expectedSourceDigest !== "string" || expectedSourceDigest.length === 0) {
    fail("controlled_contract_reference_candidate_source_identity_invalid",
      "persisting a candidate population requires the wrapper-authenticated source digest");
  }
  const loaded = await loadRecord({ dir: repoRoot, id: wkId });
  if (loaded?.valid !== true || loaded.record?.id !== wkId ||
      typeof loaded.source_digest !== "string") {
    fail("controlled_contract_reference_candidate_record_invalid",
      "the exact canonical work record is unavailable or invalid");
  }
  if (loaded.source_digest !== expectedSourceDigest) {
    fail("controlled_contract_reference_candidate_population_stale",
      "the canonical work record changed after the wrapper issued the continuation",
      { expected_source_record_digest: expectedSourceDigest,
        current_source_record_digest: loaded.source_digest });
  }
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.candidate_id)) {
      fail("controlled_contract_reference_candidate_population_invalid",
        "a candidate referent identity is declared twice",
        { candidate_id: candidate.candidate_id });
    }
    seen.add(candidate.candidate_id);
  }
  await assertCandidatesAreAdmissibleToPack({ selectedPack, candidates });
  const existing = (loaded.record.derived_evidence ?? []).filter((entry) =>
    plainObject(entry) &&
    entry.schema_version === CONTROLLED_CONTRACT_REFERENCE_CANDIDATES_SCHEMA);
  if (existing.length > 0) {

    fail("controlled_contract_reference_candidate_population_conflicting",
      "an authenticated reference-candidate population is already recorded",
      { population_count: existing.length });
  }
  const population = {
    schema_version: CONTROLLED_CONTRACT_REFERENCE_CANDIDATES_SCHEMA,
    record_id: wkId,
    focus: focus ?? null,
    source_record_digest: loaded.source_digest,
    selected_pack: structuredClone(selectedPack),
    candidates: structuredClone(candidates)
  };
  const record = structuredClone(loaded.record);
  record.derived_evidence = [...(record.derived_evidence ?? []), population];
  const written = await writeRecord({ dir: repoRoot, record,
    expectedSourceDigest: loaded.source_digest });
  if (written?.written !== true) {
    const diagnostic = written?.diagnostics?.[0] ?? null;
    fail(diagnostic?.code === "stale_source_digest"
      ? "controlled_contract_reference_candidate_population_stale"
      : "controlled_contract_reference_candidate_population_write_failed",
    diagnostic?.message ?? "the reference-candidate population could not be persisted",
    { diagnostic });
  }

  if (written.source_digest !== loaded.source_digest) {
    fail("controlled_contract_reference_candidate_population_stale",
      "persisting the candidate population moved the source it binds",
      { expected_source_record_digest: loaded.source_digest,
        current_source_record_digest: written.source_digest });
  }
  return Object.freeze({
    schema_version: "controlled-contract-reference-candidate-receipt.v1",
    wk_id: wkId,
    focus: focus ?? null,
    source_record_digest: written.source_digest,
    selected_pack: Object.freeze(structuredClone(selectedPack)),
    candidate_count: candidates.length,
    candidate_ids: Object.freeze(candidates.map(
      ({ candidate_id: id }) => id).sort()),
    written: true
  });
}

export { controlledContractCarrierFilename };
