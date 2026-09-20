

import { createHash } from "node:crypto";

import {
  ControlledContractToolError,
  composeProofPlanRequestEvaluationInputPaths,
  controlledContractCarrierFilename,
  controlledContractContentDigest,
  resolveControlledContractAuthoringContinuationMutation,
  withCanonicalControlledContractSourceLease
} from "../../lib/controlled-contract-tools.mjs";
import {
  resolveManifestControlledContractCarrierFilename
} from "../../lib/controlled-contract-carrier-set-evaluation.mjs";
import { validateAuthorableCarrier } from "./authorable-carrier-validation.mjs";
import {
  prepareControlledContractProofPlanBuild,
  validateControlledContractProofPlanPreparation
} from "./proof-pack-operations.mjs";
import {
  controlledContractEmbeddedProofContributions,
  prepareControlledContractEmbeddedProofEvolution,
  validateControlledContractEmbeddedProofEvolution
} from "./embedded-proof-evolution.mjs";
import {
  compileControlledContractAuthoringProspectiveMembers,
  settleControlledContractAuthoringProspectiveMembers,
  validateControlledContractAuthoringProspectiveMembers
} from "./authoring-prospective-settlement.mjs";
import { censusControlledContractRepairParticipants } from
  "./repair-participant-registry.mjs";
import {
  claimControlledContractRepairLineage,
  consumeControlledContractRepairLineage,
  controlledContractRepairLineagePayload,
  projectControlledContractRepairReplay,
  recordControlledContractRepairLineageFailure,
  resolveControlledContractRepairLineage
} from "./repair-lineage.mjs";
import { loadWorkRecordById } from "../../lib/work-record-store.mjs";
import {
  getControlledContractAuthoringContinuation,
  inspectControlledContractWorkbenchAttempt,
  assertControlledContractWorkbenchAttemptUsable,
  updateControlledContractAuthoringProofGraphContinuation
} from "../../lib/controlled-contract-authoring-continuations.mjs";
import {
  claimControlledContractReferenceAttempt,
  readControlledContractReferenceAttemptOutcome,
  readControlledContractReferenceAppliedReceipt,
  certifyControlledContractReferencePreEffectFailure,
  referenceAttemptSettlementRetention
} from "./repair-lineage.mjs";
import {
  controlledContractReferenceAuthoringContributions,
  prepareControlledContractReferenceAuthoring,
  resolveControlledContractReferenceCandidatePopulation,
  validateControlledContractReferenceAuthoringPreparation
} from "./prospective-reference-authoring.mjs";
import {
  controlledContractCoverageSettlementItems,
  deriveControlledContractCoverageProspectiveFacts,
  prepareControlledContractAcceptanceCoverage,
  prepareControlledContractObligationCoverage,
  validateControlledContractAcceptanceCoveragePreparation,
  validateControlledContractObligationCoveragePreparation
} from "./coverage-prospective-preparation.mjs";

export const CONTROLLED_CONTRACT_REPAIR_TRANSACTION_SCHEMA =
  "controlled-contract-repair-transaction.v1";

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, {
    changed: false, limb: "mechanical_failure",
    owner: "controlled_contract_repair_transaction", ...details
  });
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function generationIdentity(canonicalSet) {
  return typeof canonicalSet.generation === "string"
    ? canonicalSet.generation : canonicalSet.generation?.id ?? null;
}

export function controlledContractRepairSourceIdentity({ input, source, candidate }) {
  return Object.freeze({
    schema_version: "controlled-contract-repair-source-identity.v1",
    wk_id: input.wkId,
    focus: input.focus ?? null,
    record_source_digest: source.record_source_digest ?? null,
    starting_generation: generationIdentity(source.canonical_set),
    starting_manifest_content_digest: source.manifest_content_digest,
    candidate_digest: candidate.candidate_digest,
    prepared_roles: candidate.affected_roles
  });
}

const PREPARERS = Object.freeze({

  authoring_continuation: async ({ input, source, row, deps }) => {
    const mutation = await deps.resolveAuthoringMutation({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
      continuation: row.owner_context.continuation,
      canonicalSet: source.canonical_set
    });
    if (mutation.refused) fail("controlled_contract_repair_owner_refused",
      "the authoring-continuation owner refused its preparation",
      { row_id: row.row_id, reason_code: mutation.refused.reason_code ?? null });
    if (mutation.carrierKind === null || mutation.carrierKind === undefined) {
      fail("controlled_contract_repair_owner_underdetermined",
        "the authoring-continuation owner determined no carrier to advance",
        { row_id: row.row_id });
    }
    const filename = resolveManifestControlledContractCarrierFilename({
      canonicalSet: source.canonical_set, wkId: input.wkId,
      focus: input.focus ?? null, carrierKind: mutation.carrierKind,
      pack: null, preferPack: false
    });
    const carrierInput = { repoRoot: input.repoRoot, wkId: input.wkId,
      focus: input.focus ?? null, carrierKind: mutation.carrierKind,
      content: mutation.content, expectedContentDigest: mutation.expectedContentDigest,
      canonicalSet: source.canonical_set };
    if (mutation.carrierKind === "evaluation_input") {
      const selected = mutation.continuationRecord?.skeleton?.selected_pack ?? null;
      if (selected !== null) {
        carrierInput.profileId = selected.profile_id;
        carrierInput.profileVersion = selected.profile_version;
      }
    }
    await deps.validateAuthorable(carrierInput, mutation.content,
      source.canonical_set);
    return Object.freeze({
      roles: [`carrier:${mutation.carrierKind}`],
      contributions: Object.freeze([Object.freeze({
        owner: "authoring_continuation", carrier_kind: mutation.carrierKind,
        filename, content: mutation.content
      })])
    });
  },

  proof_plan: async ({ input, source, row, deps }) => {
    const prepared = deps.validateProofPlan(await deps.prepareProofPlan({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
      expectedContentDigest: row.owner_context.expected_content_digest ?? null
    }));
    return Object.freeze({
      roles: ["carrier:proof_plan"],
      contributions: Object.freeze([Object.freeze({
        owner: "proof_plan", carrier_kind: "proof_plan",
        filename: controlledContractCarrierFilename({
          wkId: input.wkId, focus: input.focus ?? null, carrierKind: "proof_plan"
        }),
        content: prepared.content
      })])
    });
  },

  contract_reference: async ({ input, source, row, deps }) => {
    const record = await deps.loadRecord({ dir: input.repoRoot, id: input.wkId })
      .catch(() => null);
    if (record === null || record.valid !== true) {
      fail("controlled_contract_repair_source_unauthenticated",
        "the leased work record could not be authenticated for reference authoring",
        { row_id: row.row_id });
    }
    const population = resolveControlledContractReferenceCandidatePopulation({
      record: record.record, wkId: input.wkId, focus: input.focus ?? null,
      recordSourceDigest: source.record_source_digest ?? null });
    if (population.present !== true) {
      fail("controlled_contract_reference_authoritative_facts_missing",
        "no authenticated reference-candidate population is bound to this source",
        { row_id: row.row_id, reason_code: population.reason_code });
    }
    const contractFilename = controlledContractCarrierFilename({
      wkId: input.wkId, focus: input.focus ?? null, carrierKind: "contract" });
    const sourceContract = source.canonical_members[contractFilename] ?? null;
    if (sourceContract === null) {
      fail("controlled_contract_repair_owner_underdetermined",
        "reference authoring has no authenticated contract",
        { row_id: row.row_id });
    }
    const requestFilename = controlledContractCarrierFilename({
      wkId: input.wkId, focus: input.focus ?? null,
      carrierKind: "proof_plan_request" });
    const proofPlanRequest = source.canonical_members[requestFilename] ?? null;
    const { profile_id, profile_version } = population.selected_pack;
    const selectedPacks = [...(proofPlanRequest?.selected_packs ?? [])];
    if (!selectedPacks.some((pack) => pack.profile_id === profile_id &&
        pack.profile_version === profile_version)) {
      selectedPacks.push({ profile_id, profile_version });
    }

    const composed = await composeProofPlanRequestEvaluationInputPaths({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
      canonicalSet: source.canonical_set, content: { selected_packs: selectedPacks }
    });
    const selectedPack = composed.selected_packs.find((pack) =>
      pack.profile_id === profile_id && pack.profile_version === profile_version);
    const evaluationInputFilename = selectedPack.evaluation_input_path;
    const evaluationInputs = Object.fromEntries(Object.entries(
      source.canonical_set.members_by_basename).filter(([, member]) =>
      member.carrier_kind === "evaluation_input").map(([filename]) =>
      [filename, source.canonical_members[filename]]));
    const evaluationInput = evaluationInputs[evaluationInputFilename] ?? null;
    const prepared = await deps.prepareReferenceAuthoring({
      wkId: input.wkId, focus: input.focus ?? null,
      recordSourceDigest: source.record_source_digest ?? null,
      startingGeneration: generationIdentity(source.canonical_set),
      startingManifestDigest: source.manifest_content_digest,
      sourceContract, contractFilename,
      evaluationInput, evaluationInputFilename, evaluationInputs,
      proofPlanRequest,
      requestFilename,
      proofPlanFilename: controlledContractCarrierFilename({
        wkId: input.wkId, focus: input.focus ?? null, carrierKind: "proof_plan" }),
      population,
      candidateDigest: row.owner_context?.candidate_digest ?? null,
      lineageIdentity: row.owner_context?.lineage_identity ?? null
    }, { prepareEmbeddedProofs: deps.prepareEmbeddedProofs });
    await deps.validateReferenceAuthoring(prepared);
    return Object.freeze({
      roles: ["contract:reference_nodes", "carrier:contract",
        "carrier:evaluation_input", "carrier:proof_plan_request",
        "carrier:proof_plan"],
      evidence: Object.freeze({
        required_roles: prepared.counts.required_roles,
        authored_references: prepared.counts.authored_references,
        candidate_population: prepared.counts.candidate_population,
        authored_roles: Object.freeze(prepared.authored_references
          .map(({ role }) => role).sort()),
        candidate_population_digest:
          prepared.source_bindings.candidate_population_digest
      }),
      contributions: controlledContractReferenceAuthoringContributions(prepared)
    });
  },

  buildProspectiveProofPlan: async ({ input, source, row, deps }) => {
    const contractFilename = controlledContractCarrierFilename({
      wkId: input.wkId, focus: input.focus ?? null, carrierKind: "contract" });
    const requestFilename = controlledContractCarrierFilename({
      wkId: input.wkId, focus: input.focus ?? null, carrierKind: "proof_plan_request" });
    const sourceContract = source.canonical_members[contractFilename] ?? null;
    const request = source.canonical_members[requestFilename] ?? null;
    if (sourceContract === null || request === null) {
      fail("controlled_contract_repair_owner_underdetermined",
        "embedded proof evolution has no authenticated contract or proof-plan request",
        { row_id: row.row_id });
    }
    const evaluationInputs = Object.fromEntries(
      Object.entries(source.canonical_members).filter(([basename]) =>
        basename !== contractFilename && basename !== requestFilename &&
        basename.includes("evaluation-input")));
    const prepared = await deps.prepareEmbeddedProofs({
      wkId: input.wkId, focus: input.focus ?? null,
      sourceContract,
      prospectiveContract: row.owner_context.prospective_contract ?? sourceContract,
      contractFilename,
      proofPlanFilename: controlledContractCarrierFilename({
        wkId: input.wkId, focus: input.focus ?? null, carrierKind: "proof_plan" }),
      request, evaluationInputs
    });
    await deps.validateEmbeddedProofs(prepared);
    return Object.freeze({
      roles: ["carrier:contract", "carrier:proof_plan", "embedded:test_proofs",
        "embedded:proof_pack_bindings"],
      evidence: Object.freeze({
        removed_stable_test_proofs: prepared.counts.removed_stable_test_proofs,
        generated_stable_test_proofs: prepared.counts.generated_stable_test_proofs,
        generated_bindings: prepared.counts.generated_bindings
      }),
      contributions: controlledContractEmbeddedProofContributions(prepared)
    });
  }
});

export const CONTROLLED_CONTRACT_REPAIR_PREPARABLE_OWNERS =
  Object.freeze(Object.keys(PREPARERS).sort());

function defaultDependencies(overrides) {
  return Object.freeze({
    resolveAuthoringMutation: resolveControlledContractAuthoringContinuationMutation,
    validateAuthorable: validateAuthorableCarrier,
    prepareProofPlan: prepareControlledContractProofPlanBuild,
    validateProofPlan: validateControlledContractProofPlanPreparation,
    prepareEmbeddedProofs: prepareControlledContractEmbeddedProofEvolution,
    validateEmbeddedProofs: validateControlledContractEmbeddedProofEvolution,
    prepareReferenceAuthoring: prepareControlledContractReferenceAuthoring,
    validateReferenceAuthoring:
      validateControlledContractReferenceAuthoringPreparation,
    compile: compileControlledContractAuthoringProspectiveMembers,
    deriveCoverageFacts: deriveControlledContractCoverageProspectiveFacts,
    prepareObligationCoverage: prepareControlledContractObligationCoverage,
    prepareAcceptanceCoverage: prepareControlledContractAcceptanceCoverage,
    validateObligationCoverage: validateControlledContractObligationCoveragePreparation,
    validateAcceptanceCoverage: validateControlledContractAcceptanceCoveragePreparation,
    validateProspective: validateControlledContractAuthoringProspectiveMembers,
    settle: settleControlledContractAuthoringProspectiveMembers,
    withSourceLease: withCanonicalControlledContractSourceLease,
    loadRecord: loadWorkRecordById,
    resolveLineage: resolveControlledContractRepairLineage,
    claimLineage: claimControlledContractRepairLineage,
    recordLineageFailure: recordControlledContractRepairLineageFailure,
    consumeLineage: consumeControlledContractRepairLineage,
    ...overrides
  });
}

export async function prepareControlledContractRepairParticipants({
  input, source, candidate, deps
}) {
  const prepared = [];
  const contributions = [];
  const claimedRoles = new Map();
  const claimedFilenames = new Map();
  for (const row of candidate.rows) {
    const preparer = PREPARERS[row.semantic_owner];
    if (preparer === undefined) {
      fail("controlled_contract_repair_participant_missing",
        "no incumbent preparer is registered for this candidate's semantic owner",
        { row_id: row.row_id, semantic_owner: row.semantic_owner });
    }
    const result = await preparer({ input, source, row, deps });
    for (const role of result.roles) {
      const prior = claimedRoles.get(role);
      if (prior !== undefined && prior !== row.semantic_owner) {
        fail("controlled_contract_repair_role_contended",
          "two semantic owners prepared the same repair role",
          { role_id: role, owners: [prior, row.semantic_owner].sort() });
      }
      claimedRoles.set(role, row.semantic_owner);
    }
    for (const contribution of result.contributions) {
      const prior = claimedFilenames.get(contribution.filename);
      if (prior !== undefined) {
        fail("controlled_contract_repair_member_contended",
          "two prepared outputs address the same canonical carrier member",
          { filename: contribution.filename,
            owners: [prior, contribution.owner].sort() });
      }
      claimedFilenames.set(contribution.filename, contribution.owner);
      contributions.push(contribution);
    }
    prepared.push(Object.freeze({
      row_id: row.row_id, semantic_owner: row.semantic_owner,
      roles: Object.freeze([...result.roles].sort()),
      evidence: result.evidence ?? null,

      contribution_digests: Object.freeze(result.contributions.map(
        ({ filename, content }) => Object.freeze({ filename,
          content_digest: controlledContractContentDigest(content) })))
    }));
  }
  if (contributions.length === 0) {
    fail("controlled_contract_repair_participant_missing",
      "the candidate prepared no canonical contribution");
  }
  return Object.freeze({
    prepared: Object.freeze(prepared),
    contributions: Object.freeze(contributions),
    prepared_roles: Object.freeze([...claimedRoles.keys()].sort())
  });
}

function prospectiveCarrierView({ input, members }) {
  const carrierFor = (carrierKind) => {
    const filename = controlledContractCarrierFilename({
      wkId: input.wkId, focus: input.focus ?? null, carrierKind });
    const content = members[filename] ?? null;
    return content === null ? null : Object.freeze({
      filename, content, content_digest: controlledContractContentDigest(content) });
  };

  const evaluationInputs = Object.fromEntries(Object.entries(members)
    .filter(([basename]) => basename.includes("evaluation-input")));
  return Object.freeze({ contract: carrierFor("contract"),
    proofPlan: carrierFor("proof_plan"), request: carrierFor("proof_plan_request"),
    evaluationInputs });
}

export async function prepareControlledContractRepairCoverage({
  input, source, members, deps
}) {
  const view = prospectiveCarrierView({ input, members });
  if (view.contract === null) return Object.freeze({ obligation: null,
    acceptance: null, prepared_roles: Object.freeze([]) });
  let facts;
  try {
    facts = await deps.deriveCoverageFacts({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
      selectedUnit: input.selectedUnit ?? null,
      canonicalSet: source.canonical_set,
      prospectiveContract: view.contract,
      prospectiveProofPlan: view.proofPlan,
      ...(view.request === null ? {} : { prospectiveProofPlanRequest: view.request }),
      prospectiveEvaluationInputs: view.evaluationInputs
    });
  } catch (error) {

    if (error?.code !== "acceptance_coverage_canonical_source_unavailable") throw error;
    return Object.freeze({ obligation: null, acceptance: null,
      prepared_roles: Object.freeze([]), unauthored: true });
  }
  const roles = [];
  const obligation = deps.validateObligationCoverage(
    deps.prepareObligationCoverage(facts.obligation), { facts: facts.obligation });
  roles.push("coverage:obligation");
  const acceptance = deps.validateAcceptanceCoverage(
    deps.prepareAcceptanceCoverage(facts.acceptance), { facts: facts.acceptance });
  roles.push("coverage:acceptance");
  return Object.freeze({ obligation, acceptance,
    prepared_roles: Object.freeze(roles) });
}

function replayResult({ lineage, record, lineagePayload }) {
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_REPAIR_TRANSACTION_SCHEMA,
    replay: projectControlledContractRepairReplay({ lineage,
      sourceCurrent: lineagePayload.record_source_digest === null ||
        record?.source_digest === lineagePayload.record_source_digest }),
    source_identity: null,
    participant_count: 0, prepared_role_count: 0,
    prepared_roles: Object.freeze([]),
    settlement_participants: Object.freeze([]),
    contribution_count: 0,
    coverage_prepared: Object.freeze({ obligation: null, acceptance: null }),
    evidence: Object.freeze([]),
    receipt: lineage.receipt
  });
}

export async function runControlledContractRepairTransaction({
  input, candidate, census = censusControlledContractRepairParticipants(), referenceAttempt = null
}, overrides = {}) {
  const deps = defaultDependencies(overrides);
  if (referenceAttempt !== null) {
    const record = await getControlledContractAuthoringContinuation({
      repoRoot: input.repoRoot, identity: referenceAttempt });
    if (record?.workbench?.semantic_owner !== "contract_reference" ||
        record.workbench.status !== "applying" || record.wk_id !== input.wkId ||
        record.focus !== (input.focus ?? null)) fail("controlled_contract_reference_attempt_invalid",
      "reference repair requires its authenticated applying attempt");
    try {
      return await runSettlement({ input, candidate, census, deps, lineageIdentity: null, referenceRecord: record });
    } catch (error) {

      let outcome;
      try {
        outcome = await readControlledContractReferenceAttemptOutcome({ repoRoot: input.repoRoot, record });
      } catch (evidenceError) {
        evidenceError.details = { ...evidenceError.details, changed: null, retry_safe: false,
          operation_error_code: error?.code ?? null };
        throw evidenceError;
      }
      error.details = { ...error.details, changed: outcome?.state === "effect_free" ? false : null,
        retry_safe: outcome?.state === "effect_free" };
      throw error;
    }
  }

  const record = await deps.loadRecord({ dir: input.repoRoot, id: input.wkId })
    .catch(() => null);
  const lineagePayload = controlledContractRepairLineagePayload({
    wkId: input.wkId, focus: input.focus ?? null,
    recordSourceDigest: candidate.record_source_digest ??
      record?.source_digest ?? null,
    candidate
  });
  const resolved = await deps.resolveLineage({ repoRoot: input.repoRoot,
    payload: lineagePayload });
  if (resolved.state === "consumed") {
    return replayResult({ lineage: resolved, record, lineagePayload });
  }
  if (resolved.state === "in_flight") {
    fail("controlled_contract_repair_lineage_in_flight",
      "another evaluation of this exact lineage is still settling", {
        lineage_identity: resolved.identity });
  }
  const claim = await deps.claimLineage({ repoRoot: input.repoRoot,
    payload: lineagePayload });
  if (claim.created !== true) {

    const contended = await deps.resolveLineage({ repoRoot: input.repoRoot,
      payload: lineagePayload });
    if (contended.state === "consumed") {
      return replayResult({ lineage: contended, record, lineagePayload });
    }
    if (contended.state === "in_flight") {
      fail("controlled_contract_repair_lineage_in_flight",
        "another evaluation of this exact lineage is still settling", {
          lineage_identity: contended.identity });
    }
  }
  try {
    return await runSettlement({ input, candidate, census, deps,
      lineageIdentity: claim.identity });
  } catch (error) {

    await deps.recordLineageFailure({ repoRoot: input.repoRoot,
      identity: claim.identity });
    throw error;
  }
}

async function runSettlement({ input, candidate, census, deps, lineageIdentity, referenceRecord = null }) {
  return deps.withSourceLease({
    repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
    mutation: { carrierKind: "contract" }
  }, async (source) => {
    let marker = null;
    let settlementEntered = false;
    if (referenceRecord !== null) {

      const latest = await inspectControlledContractWorkbenchAttempt({
        repoRoot: input.repoRoot, identity: referenceRecord.identity });
      if (latest.identity !== referenceRecord.identity || latest.status !== "applying") {
        fail("controlled_contract_reference_attempt_superseded", "reference attempt no longer owns publication");
      }
      const claim = await claimControlledContractReferenceAttempt({ repoRoot: input.repoRoot, record: referenceRecord });
      if (!claim.created) fail("controlled_contract_reference_attempt_in_flight",
        "reference attempt already entered its owner; reconcile its durable outcome", { changed: null });
      marker = claim.resource;
    }
    try {
      if (referenceRecord !== null &&
          (referenceRecord.workbench.source_identity.record_source_digest !== source.record_source_digest ||
            referenceRecord.workbench.source_identity.manifest_digest !== source.manifest_content_digest)) {
        fail("controlled_contract_authoring_continuation_stale", "reference attempt source changed before publication");
      }
      const identity = controlledContractRepairSourceIdentity({
        input, source, candidate });

      if (candidate.starting_generation !== null &&
          candidate.starting_generation !== identity.starting_generation) {
        fail("controlled_contract_repair_source_stale",
          "the repair candidate no longer binds the leased canonical generation", {
            expected_generation: candidate.starting_generation,
            actual_generation: identity.starting_generation });
      }
      if (typeof identity.record_source_digest !== "string" ||
          identity.record_source_digest.length === 0) {
        fail("controlled_contract_repair_source_unauthenticated",
          "the leased work-record source is not authenticated");
      }
      const participants = await prepareControlledContractRepairParticipants({
        input, source, candidate, deps });

      const bound = new Map(census.roles.filter(({ mutable }) => mutable)
        .map((role) => [role.role_id, role.settlement_participant]));
      for (const role of participants.prepared_roles) {
        if (!bound.has(role)) fail("controlled_contract_repair_role_unbound",
          "a prepared role has no incumbent settlement participant", { role_id: role });
      }

      const compiled = deps.compile({
        wkId: input.wkId, focus: input.focus ?? null, source,
        contributions: participants.contributions
      });

      const coverage = await prepareControlledContractRepairCoverage({
        input, source, members: compiled.canonical_members, deps });
      for (const role of coverage.prepared_roles) {
        if (!bound.has(role)) fail("controlled_contract_repair_role_unbound",
          "a prepared coverage role has no incumbent settlement participant",
          { role_id: role });
      }

      const prospective = deps.validateProspective(compiled, { source });
      settlementEntered = true;
      const receipt = await deps.settle({
        repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
        source, prospective,
        coverage: coverage.obligation === null && coverage.acceptance === null
          ? candidate.coverage ?? null
          : controlledContractCoverageSettlementItems(coverage)
      }, referenceRecord === null ? {} : {
        retain: referenceAttemptSettlementRetention({ repoRoot: input.repoRoot, record: referenceRecord, marker })
      });

      if (lineageIdentity !== null) await deps.consumeLineage({ repoRoot: input.repoRoot,
        identity: lineageIdentity, receiptIdentity: receipt.receipt_identity });
      const preparedRoles = Object.freeze([...new Set([
        ...participants.prepared_roles, ...coverage.prepared_roles])].sort());
      return Object.freeze({
        schema_version: CONTROLLED_CONTRACT_REPAIR_TRANSACTION_SCHEMA,
        source_identity: identity,
        participant_count: participants.prepared.length +
          coverage.prepared_roles.length,
        prepared_role_count: preparedRoles.length,
        prepared_roles: preparedRoles,
        settlement_participants: Object.freeze([...new Set(
          preparedRoles.map((role) => bound.get(role)))].sort()),
        coverage_prepared: Object.freeze({
          obligation: coverage.obligation === null ? null : Object.freeze({
            expected_content_digest: coverage.obligation.expected_content_digest,
            prospective_content_digest:
              coverage.obligation.prospective_content_digest,
            retained_row_count: coverage.obligation.accounting.retained_row_count }),
          acceptance: coverage.acceptance === null ? null : Object.freeze({
            expected_content_digest: coverage.acceptance.expected_content_digest,
            prospective_content_digest:
              coverage.acceptance.prospective_content_digest,
            retained_row_count: coverage.acceptance.accounting.retained_row_count })
        }),
        contribution_count: participants.contributions.length,
        evidence: Object.freeze(participants.prepared.map(({ row_id: rowId,
          semantic_owner: owner, evidence }) =>
          Object.freeze({ row_id: rowId, semantic_owner: owner, evidence }))),
        lineage_identity: lineageIdentity,
        receipt
      });
    } catch (error) {
      if (referenceRecord !== null) {
        if (!settlementEntered) {

          await certifyControlledContractReferencePreEffectFailure({ repoRoot: input.repoRoot,
            record: referenceRecord, marker });
          error.details = { ...error.details, changed: false };
        } else {

          error.details = { ...error.details, changed: null, retry_safe: false };
        }
      }
      throw error;
    }
  });
}

export async function reconcileControlledContractReferenceAttempt({ repoRoot, wkId, focus = null, identity }) {
  const latest = await inspectControlledContractWorkbenchAttempt({ repoRoot, identity });
  if (latest.usable) return null;
  const record = await getControlledContractAuthoringContinuation({ repoRoot, identity: latest.identity });
  if (record.wk_id !== wkId || record.focus !== focus) fail("controlled_contract_reference_attempt_invalid",
    "reference reconciliation subject changed");
  const outcome = latest.status === "applied"
    ? await readControlledContractReferenceAppliedReceipt({ repoRoot, record })
    : await readControlledContractReferenceAttemptOutcome({ repoRoot, record });
  if (outcome === null) assertControlledContractWorkbenchAttemptUsable(latest);
  return withCanonicalControlledContractSourceLease({ repoRoot, wkId, focus,
    mutation: { carrierKind: "contract" } }, async (source) => {
    const applied = outcome.state === "published";
    if (!applied && (source.record_source_digest !== record.workbench.source_identity.record_source_digest ||
        source.manifest_content_digest !== record.workbench.source_identity.manifest_digest)) {
      fail("controlled_contract_authoring_continuation_stale", "reference recovery source moved");
    }
    const transition = latest.status === "applied" ? record
      : await updateControlledContractAuthoringProofGraphContinuation({ repoRoot, wkId, focus,
        identity: record.identity, changes: { status: applied ? "applied" : "retryable",
          response_digest: record.workbench.response_digest,
          result_digest: applied ? outcome.receipt.receipt_identity : null } });
    return applied ? Object.freeze({ continuation: transition.identity,
      result_digest: outcome.receipt.receipt_identity,
      owner_result: Object.freeze({ receipt: outcome.receipt, replayed: true,
        source_current: source.record_source_digest === record.workbench.source_identity.record_source_digest }) }) : null;
  });
}

export { digest as controlledContractRepairDigest };
