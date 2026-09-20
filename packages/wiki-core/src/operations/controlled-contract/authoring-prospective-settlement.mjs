import { prepareProofAuthoringSourceSettlement } from './proof-authoring-persistence.mjs';
import { prepareWorkRecordTestTargetSettlement } from '../work-records-store-io.mjs';

import {
  ControlledContractToolError,
  controlledContractCarrierFilename,
  controlledContractContentDigest
} from "../../lib/controlled-contract-tools.mjs";
import {
  prepareControlledContractRefactorCarrierSettlement,
  settleControlledContractRefactorTransaction
} from "../../lib/controlled-contract-carrier-set-publication.mjs";
import {
  retainControlledContractRefactorResource
} from "../../lib/controlled-contract-refactor-staging.mjs";
import {
  prepareControlledContractRefactorCoverageSettlement
} from "./acceptance-coverage-operations.mjs";

export const CONTROLLED_CONTRACT_AUTHORING_PROSPECTIVE_SCHEMA =
  "controlled-contract-authoring-prospective-compilation.v1";

export const CONTROLLED_CONTRACT_AUTHORING_SETTLEMENT_RECEIPT_SCHEMA =
  "controlled-contract-authoring-settlement-receipt.v1";

const RETAINED_TRANSACTION_SCHEMA =
  "controlled-contract-authoring-retained-transaction.v1";

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, {
    changed: false, limb: "mechanical_failure",
    owner: "controlled_contract_authoring_settlement", ...details
  });
}

function generationIdentity(canonicalSet) {
  return typeof canonicalSet.generation === "string"
    ? canonicalSet.generation : canonicalSet.generation?.id ?? null;
}

function assertOneOwnerPerBasename(contributions) {
  const seen = new Map();
  for (const contribution of contributions) {
    if (contribution === null || typeof contribution !== "object" ||
        typeof contribution.owner !== "string" ||
        typeof contribution.filename !== "string" ||
        contribution.content === null || typeof contribution.content !== "object" ||
        Array.isArray(contribution.content)) fail(
      "controlled_contract_authoring_contribution_invalid",
      "an owner contribution is not one named prepared carrier artifact");
    const prior = seen.get(contribution.filename);
    if (prior !== undefined && prior !== contribution.owner) fail(
      "controlled_contract_authoring_contribution_conflicting",
      "two semantic owners prepared the same canonical carrier",
      { filename: contribution.filename, owners: [prior, contribution.owner].sort() });
    if (prior !== undefined) fail(
      "controlled_contract_authoring_contribution_conflicting",
      "one semantic owner prepared the same canonical carrier twice",
      { filename: contribution.filename, owner: contribution.owner });
    seen.set(contribution.filename, contribution.owner);
  }
}

export function compileControlledContractAuthoringProspectiveMembers({
  wkId, focus = null, source, contributions
}) {
  if (!Array.isArray(contributions) || contributions.length === 0) fail(
    "controlled_contract_authoring_contribution_absent",
    "prospective compilation requires at least one prepared owner contribution");
  assertOneOwnerPerBasename(contributions);
  const members = structuredClone(source.canonical_members);
  const changed = [];
  for (const contribution of contributions) {
    const before = members[contribution.filename] ?? null;
    const beforeDigest = before === null
      ? null : controlledContractContentDigest(before);
    const afterDigest = controlledContractContentDigest(contribution.content);
    members[contribution.filename] = structuredClone(contribution.content);
    if (beforeDigest !== afterDigest) changed.push(contribution.filename);
  }

  const proofPlanBasename = controlledContractCarrierFilename({
    wkId, focus, carrierKind: "proof_plan"
  });
  const proofPlanContributed = contributions.some(({ filename }) =>
    filename === proofPlanBasename);
  const invalidatedProofPlan = !proofPlanContributed &&
    changed.some((filename) => filename !== proofPlanBasename) &&
    Object.hasOwn(members, proofPlanBasename);
  if (invalidatedProofPlan) delete members[proofPlanBasename];
  const memberDigests = Object.fromEntries(Object.entries(members)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([basename, content]) => [basename, controlledContractContentDigest(content)]));
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_AUTHORING_PROSPECTIVE_SCHEMA,
    wk_id: wkId,
    focus: focus ?? null,
    source: Object.freeze({
      generation: generationIdentity(source.canonical_set),
      manifest_content_digest: source.manifest_content_digest,
      record_source_digest: source.record_source_digest ?? null
    }),

    contributions: Object.freeze(contributions.map(({ owner, carrier_kind: kind,
      filename, content }) => Object.freeze({
      owner, carrier_kind: kind ?? null, filename,
      content_digest: controlledContractContentDigest(content)
    })).sort((left, right) => left.filename.localeCompare(right.filename))),
    changed_filenames: Object.freeze([...changed].sort()),
    invalidated_proof_plan: invalidatedProofPlan,
    canonical_members: members,
    member_digests: memberDigests
  });
}

export function validateControlledContractAuthoringProspectiveMembers(prospective, {
  source = null
} = {}) {
  if (prospective === null || typeof prospective !== "object" ||
      prospective.schema_version !== CONTROLLED_CONTRACT_AUTHORING_PROSPECTIVE_SCHEMA ||
      prospective.canonical_members === null ||
      typeof prospective.canonical_members !== "object") fail(
    "controlled_contract_authoring_prospective_invalid",
    "prospective authoring compilation is not one complete canonical member set");
  const basenames = Object.keys(prospective.canonical_members).sort();
  if (basenames.length === 0) fail(
    "controlled_contract_authoring_prospective_invalid",
    "prospective authoring compilation publishes an empty canonical member set");
  for (const basename of basenames) {
    if (prospective.member_digests[basename] !== controlledContractContentDigest(
      prospective.canonical_members[basename])) fail(
      "controlled_contract_authoring_prospective_invalid",
      "prospective member digest does not match its content", { basename });
  }
  if (Object.keys(prospective.member_digests).sort().join("\u0000") !==
      basenames.join("\u0000")) fail(
    "controlled_contract_authoring_prospective_invalid",
    "prospective member digest population does not match its member population");
  if (source !== null) {
    if (prospective.source.generation !== generationIdentity(source.canonical_set) ||
        prospective.source.manifest_content_digest !== source.manifest_content_digest) fail(
      "controlled_contract_authoring_prospective_stale",
      "prospective compilation no longer binds its authenticated source generation", {
        expected_generation: prospective.source.generation,
        actual_generation: generationIdentity(source.canonical_set)
      });
  }
  return prospective;
}

export async function settleControlledContractAuthoringProspectiveMembers({
  repoRoot, wkId, focus = null, source, prospective, coverage = null,
  obligationSource = null, obligationSources = [], publishCarriers = true, targetRecord = null, selectedUnit = null, assertDefinitions = async () => {}
}, {
  prepareCarrierSettlement = prepareControlledContractRefactorCarrierSettlement,
  prepareCoverageSettlement = prepareControlledContractRefactorCoverageSettlement,
  settle = settleControlledContractRefactorTransaction,
  retain = retainControlledContractRefactorResource
} = {}) {
  if (publishCarriers) validateControlledContractAuthoringProspectiveMembers(prospective, { source });
  const plannedGeneration = prospective.source.generation;

  const finalized = await retain({
    repoRoot, resourceKind: "finalized_transaction",
    payload: {
      schema_version: RETAINED_TRANSACTION_SCHEMA,
      wk_id: wkId,
      focus: focus ?? null,
      source: structuredClone(prospective.source),
      contributions: structuredClone(prospective.contributions),
      obligation_sources: obligationSources.map(item => ({ selected_unit: item.initial.selectedUnit, content_digest: controlledContractContentDigest(item.content) })),
      obligation_source_digest: obligationSource === null ? null : controlledContractContentDigest(obligationSource.content),
      target_record_digest: targetRecord === null ? null : controlledContractContentDigest(targetRecord),
      changed_filenames: structuredClone(prospective.changed_filenames),
      invalidated_proof_plan: prospective.invalidated_proof_plan,
      member_digests: structuredClone(prospective.member_digests)
    }
  });
  let carrierReceipt = null;
  let coverageReceipt = null;
  let settled = false;
  try {
    const settlement = await settle({

    assertSourceLease: async () => {
      await assertDefinitions();
      if (generationIdentity(source.canonical_set) !== plannedGeneration) fail(
        "controlled_contract_authoring_source_lease_stale",
        "authoring source lease no longer binds its prepared generation", {
          expected_generation: plannedGeneration,
          actual_generation: generationIdentity(source.canonical_set)
        });
    },
    participants: [
      ...obligationSources.map(item => ({ name: `obligation_source:${item.initial.selectedUnit ?? 'parent'}`,
        prepare: () => prepareProofAuthoringSourceSettlement(item) })),
      ...(obligationSource === null ? [] : [{ name: 'obligation_source',
        prepare: () => prepareProofAuthoringSourceSettlement(obligationSource) }]),
      ...(coverage === null ? [] : [{ name: "coverage", prepare: async () => {
        const prepared = await prepareCoverageSettlement({
          input: { repoRoot, wkId, focus: focus ?? null }, coverage
        });
        return Object.freeze({ ...prepared, commit: async () => {
          coverageReceipt = await prepared.commit();
          return coverageReceipt;
        } });
      } }]),
      ...(publishCarriers ? [{ name: "canonical_generation", prepare: async () => {
        const prepared = await prepareCarrierSettlement({
          repoRoot, repository: source.record.repo, wkId, focus: focus ?? null,
          profile: "canonical_authoring",
          expected_manifest_digest: source.manifest_content_digest,
          sourceLease: source.lease,
          canonical_members: prospective.canonical_members
        });
        return Object.freeze({ ...prepared, commit: async () => {
          carrierReceipt = await prepared.commit();
          return carrierReceipt;
        } });
      } }] : [])
      ,...(targetRecord === null ? [] : [{ name: 'work_record_targets', terminal: true,
        prepare: () => prepareWorkRecordTestTargetSettlement({ dir: repoRoot, id: wkId,
          selectedUnit, record: targetRecord, lease: source.record_lease,
          allowProofPosture: controlledContractContentDigest(
            targetRecord.proof_posture ?? null) !== controlledContractContentDigest(
            source.record.proof_posture ?? null) }) }])
    ]
    });
    settled = true;
    const receipt = Object.freeze({
      schema_version: CONTROLLED_CONTRACT_AUTHORING_SETTLEMENT_RECEIPT_SCHEMA,
      wk_id: wkId,
      focus: focus ?? null,
      transaction_identity: finalized.identity,
      source: structuredClone(prospective.source),
      target: Object.freeze({
        generation: carrierReceipt?.generation ?? null,
        manifest_content_digest: carrierReceipt?.manifest_content_digest ?? null
      }),
      settlement_status: settlement.status,
      committed_participants: structuredClone(settlement.committed_participants),
      contribution_count: prospective.contributions.length,
      changed_filename_count: prospective.changed_filenames.length,
      coverage_changed: coverageReceipt === null ? null : true,
      outcome: carrierReceipt?.no_op === true ? "no_op" : "written"
    });
    const retained = await retain({
      repoRoot, resourceKind: "receipt", payload: receipt
    });
    return Object.freeze({ ...receipt, receipt_identity: retained.identity });
  } catch (error) {
    if (!settled && carrierReceipt === null || error.details?.settlement_status === 'compensated') throw error;

    const { changed: _changed, ...details } = error?.details ?? {};
    throw new ControlledContractToolError(
      error?.code ?? "controlled_contract_authoring_post_commit_failure",
      error?.message ?? "authoring publication committed but closeout failed", {
        ...details,
        changed: carrierReceipt?.no_op === true ? false : true,
        retry_safe: false,
        publication_outcome: "established",
        publication_phase: "post_commit_closeout",
        target_generation: carrierReceipt?.generation ?? null,
        target_manifest_digest: carrierReceipt?.manifest_content_digest ?? null,
        owner: "controlled_contract_authoring_settlement"
      }
    );
  }
}
