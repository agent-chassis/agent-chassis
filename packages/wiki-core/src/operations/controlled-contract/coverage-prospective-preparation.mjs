import { resolveProofAuthoringCompleteness } from './proof-authoring-source.mjs';

import {
  ControlledContractToolError,
  controlledContractContentDigest
} from "../../lib/controlled-contract-tools.mjs";
import { validateObligationCoverageDraft } from "@agent-chassis/controlled-contract";
import {
  obligationCoverageSourceLocatorDigest,
  resolveAcceptanceCoverageFacts,
  resolveObligationCoverageFacts
} from "./acceptance-coverage-facts.mjs";
import {
  planAcceptanceCoverageRebase,
  planObligationCoverageRebase
} from "./acceptance-coverage-rebase.mjs";
import {
  acceptanceCoverageCarrierContent,
  acceptanceCoverageCriterionIdentities,
  obligationCoverageCarrierContent
} from "./acceptance-coverage-operations.mjs";

export const CONTROLLED_CONTRACT_COVERAGE_PREPARATION_SCHEMA =
  "controlled-contract-coverage-preparation.v1";

export const CONTROLLED_CONTRACT_COVERAGE_PREPARE_OWNERS = Object.freeze({
  obligation: "prepareControlledContractObligationCoverage",
  acceptance: "prepareControlledContractAcceptanceCoverage"
});

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, {
    changed: false, limb: "mechanical_failure",
    owner: "controlled_contract_coverage_preparation", ...details
  });
}

function assertMechanicallyDetermined(family, plan) {
  if (plan.entries.length === 0) return;
  const kinds = [...new Set(plan.entries.map(({ public: row }) => row.kind))].sort();
  fail(`${family}_coverage_preparation_unresolved`,
    "prospective coverage requires a semantic disposition and is not mechanically determined",
    { family, conflict_count: plan.entries.length, conflict_kinds: kinds,
      conflict_set_identity: plan.conflictSetIdentity });
}

function assertNoDanglingObligationNodes(rows, contractNodes) {
  const nodes = new Set(contractNodes.map(({ id }) => id));
  const dangling = rows.flatMap(({ obligation_id: id,
    controlled_contract_node_ids: ids }) =>
    (ids ?? []).filter((node) => !nodes.has(node)).map((node) => `${id}:${node}`));
  if (dangling.length > 0) fail(
    "obligation_coverage_dangling_claim",
    "prospective obligation coverage references a claim the prospective contract does not declare",
    { dangling: [...new Set(dangling)].sort() });
}

function assertNoDuplicateAcceptanceCredit(rows) {
  const seen = new Map();
  for (const row of rows) {
    seen.set(row.criterion_identity, (seen.get(row.criterion_identity) ?? 0) + 1);
  }
  const duplicated = [...seen.entries()].filter(([, count]) => count > 1)
    .map(([identity]) => identity).sort();
  if (duplicated.length > 0) fail(
    "acceptance_coverage_duplicate_mapping",
    "prospective acceptance coverage credits one criterion more than once",
    { duplicated });
}

function assertNoDanglingAcceptanceNodes(rows, contractNodes) {
  const nodes = new Set(contractNodes.map(({ id }) => id));
  const dangling = rows.flatMap(({ criterion_identity: identity, node_ids: ids }) =>
    (ids ?? []).filter((node) => !nodes.has(node)).map((node) => `${identity}:${node}`));
  if (dangling.length > 0) fail(
    "acceptance_coverage_dangling_claim",
    "prospective acceptance coverage references a claim the prospective contract does not declare",
    { dangling: [...new Set(dangling)].sort() });
}

function assertNoStaleAcceptanceRows(rows, criterionIdentities) {
  const current = new Set(criterionIdentities.identities.map(
    ({ identity }) => identity));
  const stale = rows.map(({ criterion_identity: identity }) => identity)
    .filter((identity) => !current.has(identity)).sort();
  if (stale.length > 0) fail(
    "acceptance_coverage_stale_row_presented_current",
    "prospective acceptance coverage presents a row for a criterion the current population does not contain",
    { stale });
}

function assertNoOutsidePackRelabelled(rows) {
  const relabelled = rows.filter((row) => Object.values(row.axes ?? {})
    .some((value) => value === "outside_pack") &&
    row.state === "covered").map(({ criterion_identity: id }) => id).sort();
  if (relabelled.length > 0) fail(
    "acceptance_coverage_outside_pack_relabelled",
    "an outside_pack evaluation is presented as covered",
    { criterion_identities: relabelled });
}

function preparation({ family, wkId, focus, selectedUnit, facts, content,
  expectedDigest, rows, invalidations, criterionIdentities = null }) {
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_COVERAGE_PREPARATION_SCHEMA,
    family,
    owner: CONTROLLED_CONTRACT_COVERAGE_PREPARE_OWNERS[family],
    wk_id: wkId,
    focus: focus ?? null,
    selected_unit: selectedUnit ?? null,
    source_generation: facts.canonicalSet?.generation ?? null,
    source_manifest_content_digest:
      facts.canonicalSet?.manifest_content_digest ?? null,

    expected_content_digest: expectedDigest,
    prospective_content_digest: controlledContractContentDigest(content),
    content,
    accounting: Object.freeze({
      retained_row_count: rows.length,
      current_criterion_count: family === "obligation"
        ? facts.criteria.length : criterionIdentities.identities.length
    }),
    invalidations: Object.freeze([...invalidations].sort()),

    settlement_item: Object.freeze({
      content, source_content_digest: expectedDigest,
      prospective_content_digest: controlledContractContentDigest(content)
    })
  });
}

export function prepareControlledContractObligationCoverage(facts) {
  const plan = planObligationCoverageRebase(facts,
    { sourceLocatorDigest: obligationCoverageSourceLocatorDigest });
  assertMechanicallyDetermined("obligation", plan);

  const rows = plan.safeRows;
  assertNoDanglingObligationNodes(rows, facts.contractNodes);
  const content = obligationCoverageCarrierContent(facts, rows);
  return preparation({ family: "obligation", wkId: facts.wkId, focus: facts.focus,
    selectedUnit: facts.selectedUnit, facts, content,
    expectedDigest: facts.source?.content_digest ?? null, rows,
    invalidations: facts.staleReasons ?? [] });
}

export function validateControlledContractObligationCoveragePreparation(prepared, {
  facts
}) {
  if (prepared === null || typeof prepared !== "object" ||
      prepared.schema_version !== CONTROLLED_CONTRACT_COVERAGE_PREPARATION_SCHEMA ||
      prepared.family !== "obligation") fail(
    "obligation_coverage_preparation_invalid",
    "prospective obligation-coverage preparation is not one complete artifact");
  if (prepared.wk_id !== facts.wkId ||
      prepared.focus !== (facts.focus ?? null) ||
      prepared.selected_unit !== (facts.selectedUnit ?? null)) fail(
    "obligation_coverage_preparation_subject_mismatch",
    "prospective obligation coverage addresses another canonical subject");
  if (prepared.source_generation !== (facts.canonicalSet?.generation ?? null) ||
      prepared.source_manifest_content_digest !==
        (facts.canonicalSet?.manifest_content_digest ?? null)) fail(
    "obligation_coverage_preparation_stale",
    "prospective obligation coverage no longer binds its authenticated generation", {
      expected_generation: prepared.source_generation,
      actual_generation: facts.canonicalSet?.generation ?? null });
  if (prepared.expected_content_digest !== (facts.source?.content_digest ?? null)) fail(
    "obligation_coverage_preparation_stale",
    "the visible obligation-coverage source changed after preparation", {
      expected_content_digest: prepared.expected_content_digest,
      actual_content_digest: facts.source?.content_digest ?? null });
  if (prepared.prospective_content_digest !==
      controlledContractContentDigest(prepared.content)) fail(
    "obligation_coverage_preparation_invalid",
    "prospective obligation-coverage digest does not match its content");
  const rows = prepared.content.obligations ?? [];
  const validation = validateObligationCoverageDraft(prepared.content);
  if (!validation.valid) fail("obligation_coverage_preparation_invalid",
    "prospective obligation coverage failed incumbent package validation", {
      schema_errors: validation.schema_errors, diagnostics: validation.diagnostics
    });
  assertNoDanglingObligationNodes(rows, facts.contractNodes);
  if (controlledContractContentDigest(prepared.content) !== controlledContractContentDigest(
      obligationCoverageCarrierContent(facts, facts.draftRows))) fail(
    'obligation_coverage_preparation_content_mismatch',
    'Prospective preparation must preserve the owner-resolved draft rows');

  return prepared;
}

export function prepareControlledContractAcceptanceCoverage(facts) {

  if ((facts.carrier ?? null) === null) fail(
    "acceptance_coverage_preparation_absent",
    "acceptance coverage has not been authored, so no mechanical preparation exists",
    { family: "acceptance" });
  const criterionIdentities = acceptanceCoverageCriterionIdentities(facts);
  const plan = planAcceptanceCoverageRebase(facts, criterionIdentities);
  assertMechanicallyDetermined("acceptance", plan);
  const rows = plan.safeRows;
  const content = acceptanceCoverageCarrierContent({ wkId: facts.wkId,
    focus: facts.focus, selectedUnit: facts.selectedUnit }, facts, rows,
  criterionIdentities);
  return preparation({ family: "acceptance", wkId: facts.wkId, focus: facts.focus,
    selectedUnit: facts.selectedUnit, facts, content,
    expectedDigest: facts.carrier?.content_digest ?? null, rows,
    criterionIdentities,
    invalidations: facts.changed_bindings ?? [] });
}

export function validateControlledContractAcceptanceCoveragePreparation(prepared, {
  facts
}) {
  if (prepared === null || typeof prepared !== "object" ||
      prepared.schema_version !== CONTROLLED_CONTRACT_COVERAGE_PREPARATION_SCHEMA ||
      prepared.family !== "acceptance") fail(
    "acceptance_coverage_preparation_invalid",
    "prospective acceptance-coverage preparation is not one complete artifact");
  if (prepared.wk_id !== facts.wkId ||
      prepared.focus !== (facts.focus ?? null) ||
      prepared.selected_unit !== (facts.selectedUnit ?? null)) fail(
    "acceptance_coverage_preparation_subject_mismatch",
    "prospective acceptance coverage addresses another canonical subject");
  if (prepared.source_generation !== (facts.canonicalSet?.generation ?? null)) fail(
    "acceptance_coverage_preparation_stale",
    "prospective acceptance coverage no longer binds its authenticated generation", {
      expected_generation: prepared.source_generation,
      actual_generation: facts.canonicalSet?.generation ?? null });
  if (prepared.expected_content_digest !== (facts.carrier?.content_digest ?? null)) fail(
    "acceptance_coverage_preparation_stale",
    "the visible acceptance-coverage carrier changed after preparation", {
      expected_content_digest: prepared.expected_content_digest,
      actual_content_digest: facts.carrier?.content_digest ?? null });
  if (prepared.prospective_content_digest !==
      controlledContractContentDigest(prepared.content)) fail(
    "acceptance_coverage_preparation_invalid",
    "prospective acceptance-coverage digest does not match its content");
  const rows = prepared.content.rows ?? [];
  assertNoDuplicateAcceptanceCredit(rows);
  assertNoDanglingAcceptanceNodes(rows, facts.contractNodes);
  assertNoStaleAcceptanceRows(rows, acceptanceCoverageCriterionIdentities(facts));
  assertNoOutsidePackRelabelled(rows);
  return prepared;
}

export async function deriveControlledContractCoverageProspectiveFacts({
  repoRoot, wkId, focus = null, selectedUnit = null, canonicalSet,
  prospectiveContract, prospectiveProofPlan = null,
  prospectiveProofPlanRequest = undefined, prospectiveEvaluationInputs = undefined,
  obligationSource = undefined
}, {
  resolveObligation = resolveProofAuthoringCompleteness,
  resolveAcceptance = resolveAcceptanceCoverageFacts
} = {}) {
  if (canonicalSet === null || typeof canonicalSet !== "object" ||
      prospectiveContract === null || typeof prospectiveContract !== "object") fail(
    "controlled_contract_coverage_prospective_source_incomplete",
    "prospective coverage facts require an authenticated carrier set and prospective contract");
  const canonicalOverride = {
    canonicalSet,
    contract: prospectiveContract,
    proofPlan: prospectiveProofPlan,
    ...(prospectiveProofPlanRequest === undefined
      ? {} : { proofPlanRequest: prospectiveProofPlanRequest }),
    ...(prospectiveEvaluationInputs === undefined
      ? {} : { evaluationInputs: prospectiveEvaluationInputs }),
    ...(obligationSource === undefined ? {} : { obligationSource })
  };
  const input = { repoRoot, wkId, focus, selectedUnit };
  return Object.freeze({
    obligation: await resolveObligation(input, { canonicalOverride }),
    acceptance: await resolveAcceptance(input, { canonicalOverride })
  });
}

export function controlledContractCoverageSettlementItems({
  obligation = null, acceptance = null
} = {}) {
  return Object.freeze({
    obligation: obligation === null ? null : obligation.settlement_item,
    acceptance: acceptance === null ? null : acceptance.settlement_item
  });
}
