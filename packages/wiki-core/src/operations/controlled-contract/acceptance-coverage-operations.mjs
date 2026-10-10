import { proofAuthoringCompletenessSummary, proofAuthoringIncompleteResult,
  proofAuthoringObligationsAccounted } from './proof-authoring-source.mjs';
export { upsertControlledContractObligationCoverageOperation, removeControlledContractObligationCoverageOperation,
  refuseMalformedControlledContractObligationCoverageRequest } from "./proof-authoring-operations.mjs";
export { queryControlledContractObligationCoverageOperation } from "./obligation-coverage-query.mjs";
import { obligationCoverageProjectionCursor, encodeObligationCoverageOperationCursor, decodeObligationCoverageOperationCursor } from "./proof-authoring-persistence.mjs";

import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ControlledContractToolError,
  controlledContractContentDigest,
  withCanonicalControlledContractSourceLease
} from "../../lib/controlled-contract-tools.mjs";
import { applyControlledContractCarrierPatch } from
  "@agent-chassis/controlled-contract/carrier-patch";
import {
  deriveControlledContractAcceptanceCoverage,
  deriveCriterionIdentitySet
} from "../../lib/controlled-contract-acceptance-coverage.mjs";
import { composeControlledContractCoverageAuthoringSkeleton }
  from "../../lib/controlled-contract-coverage-authoring-skeleton.mjs";
import { criterionIdentityInputs } from "./criterion-identity-projection.mjs";
import {
  ACCEPTANCE_COVERAGE_CARRIER_VERSION,
  ACCEPTANCE_COVERAGE_MAX_BYTES,
  ACCEPTANCE_COVERAGE_MAX_ROWS,
  acceptanceCoverageAuthoringIdentity,
  acceptanceCoverageCarrierPath,
  acceptanceCoverageFactsFromRows,
  acceptanceCoverageSourcePath,
  acceptanceCoverageRows,
  acceptanceCoverageUnitDigest,
  assertObligationCoverageSourcePathIntegrity,
  changedAcceptanceCoverageBindings,
  exactObject,
  obligationCoverageSourceLocatorDigest,
  readAcceptanceCoverageCarrier,
  readCanonicalObligationSource,
  rebindAcceptanceCoverageFactsToObligationSource,
  resolveAcceptanceCoverageFacts,
  resolveObligationCoverageFacts
} from "./acceptance-coverage-facts.mjs";
import {
  COVERAGE_REBASE_NON_AUTHORITY,
  applyCompleteRebaseResolution,
  assertConflictSetCurrent,
  planAcceptanceCoverageRebase,
  planObligationCoverageRebase,
  projectRebaseConflictPage
} from "./acceptance-coverage-rebase.mjs";
import { controlledContractOperation } from "./refusal.mjs";
import {
  coverageSelectorRecovery,
  obligationCoverageDescribeCalls
} from "./coverage-recovery-guidance.mjs";
import {
  ACCEPTANCE_COVERAGE_NON_AUTHORITY,
  acceptanceCoverageCarrierIdentity,
  acceptanceCoverageOperationInput,
  acceptanceCoverageResolutionInput,
  assertAcceptanceRebaseAttemptIdentity,
  coverageAuthoringMutation,
  coverageFamilyContinuationCalls,
  decodeAcceptanceCoverageOperationCursor,
  encodeAcceptanceCoverageOperationCursor,
  materializeObligationCoverageRow,
  ownerProducedCoverageRecovery,
  projectPublicAcceptanceCoverage,
  publicAcceptanceCoverageSelector,
  validateObligationCoverageContent
} from "./acceptance-coverage-operation-support.mjs";

let controlledContractRefactorCoverageHook = null;

function canonicalRetainedValue(value) {
  if (Array.isArray(value)) return value.map(canonicalRetainedValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalRetainedValue(value[key])])
  );
  return value;
}

export function setControlledContractRefactorCoverageHookForTest(hook = null) {
  if (hook !== null && typeof hook !== "function") {
    throw new TypeError("refactor coverage hook must be a function or null");
  }
  controlledContractRefactorCoverageHook = hook;
}

async function refactorCoverageBoundary(boundary, details) {
  if (controlledContractRefactorCoverageHook !== null) {
    await controlledContractRefactorCoverageHook(boundary, Object.freeze(details));
  }
}

export { resolveAcceptanceCoverageFacts, resolveObligationCoverageFacts };

function refactorProspectiveContractNodes(nodes, correspondence) {
  const mapped = new Map(correspondence.filter(({ old_identity: identity }) =>
    identity !== null).map((row) => [row.old_identity, row.new_identities]));
  const rows = [];
  for (const node of nodes) {
    const replacements = mapped.get(node.id);
    if (replacements === undefined) rows.push(structuredClone(node));
    else for (const id of replacements) rows.push({ ...structuredClone(node), id });
  }
  for (const { old_identity: oldIdentity, new_identities: newIdentities } of correspondence) {
    if (oldIdentity === null) for (const id of newIdentities) rows.push({ id });
  }
  return [...new Map(rows.sort((left, right) =>
    String(left.id).localeCompare(String(right.id))).map((row) => [row.id, row])).values()];
}

export function planControlledContractRefactorCoverageRebases({
  mode, obligationFacts = null, acceptanceFacts = null,
  prospectiveFacts = false
}) {
  if (mode?.kind !== "replace_subgraph") {
    return Object.freeze({ obligation: null, acceptance: null });
  }
  const prepareFacts = (resolved) => {
    if (resolved === null) return null;
    if (prospectiveFacts) return resolved;
    const contractNodes = refactorProspectiveContractNodes(
      resolved.contractNodes, mode.correspondence);
    return Object.freeze({ ...resolved, contractNodes,
      bindings: Object.freeze({ ...resolved.bindings,
        contractNodeDigest: controlledContractContentDigest(contractNodes) }) });
  };
  const obligationResolved = prepareFacts(obligationFacts);
  const acceptanceResolved = prepareFacts(acceptanceFacts);
  const obligationPlan = obligationResolved === null ? null
    : planObligationCoverageRebase(obligationResolved, {
        sourceLocatorDigest: obligationCoverageSourceLocatorDigest
      });
  const acceptancePlan = acceptanceResolved === null ||
      acceptanceResolved.carrier === null ? null
    : planAcceptanceCoverageRebase(acceptanceResolved,
        acceptanceCoverageCriterionIdentities(acceptanceResolved));
  return Object.freeze({
    obligation: obligationPlan === null ? null
      : Object.freeze({ ...obligationPlan, refactorResolved: obligationResolved }),
    acceptance: acceptancePlan === null ? null
      : Object.freeze({ ...acceptancePlan, refactorResolved: acceptanceResolved })
  });
}

export async function finalizeControlledContractRefactorCoverageRebases({
  plans, obligationDispositions, acceptanceDispositions, input
}) {
  const obligation = plans.obligation === null ? null : await (async () => {
    const resolved = plans.obligation.refactorResolved;
    const rows = await applyCompleteRebaseResolution(plans.obligation,
      obligationDispositions, {
        normalizeRow: async (row, currentIdentity) => {
          const materialized = await materializeObligationCoverageRow(row, resolved);
          if (materialized.source_locator !== currentIdentity?.source_locator) {
            throw new ControlledContractToolError(
              "obligation_coverage_rebase_disposition_invalid",
              "semantic row does not select the conflict's exact current criterion",
              { changed: false });
          }
          return materialized;
        },
        rowMatchesCurrentIdentity: (row, currentIdentity) =>
          currentIdentity !== null && row.source_locator === currentIdentity.source_locator
    });
    const validated = await validateObligationCoverageContent(resolved, rows);
    const content = canonicalRetainedValue(
      JSON.parse(validated.bytes.toString("utf8")));
    return Object.freeze({ family: "obligation", rows: Object.freeze(rows),
      content, bytes: validated.bytes,
      source_content_digest: resolved.source?.content_digest ?? null,
      prospective_content_digest: controlledContractContentDigest(content) });
  })();
  const buildAcceptance = async () => plans.acceptance === null ? null : await (async () => {
    const resolved = obligation === null
      ? plans.acceptance.refactorResolved
      : rebindAcceptanceCoverageFactsToObligationSource(
        plans.acceptance.refactorResolved, obligation.content);
    let rows = await applyCompleteRebaseResolution(plans.acceptance,
      acceptanceDispositions, {
        normalizeRow: async (row) => acceptanceCoverageRows([row], "row")[0],
        rowMatchesCurrentIdentity: (row, currentIdentity) => currentIdentity !== null &&
          row.criterion_identity === currentIdentity.criterion_identity
      });
    rows = acceptanceCoverageRows(rows);
    assertUniqueAcceptanceCoverageCredit(rows);
    const state = deriveControlledContractAcceptanceCoverage(
      acceptanceCoverageFactsFromRows(resolved, rows));
    const authoredContent = acceptanceCoverageCarrierContent(input, resolved, rows,
      state.criterion_identities);
    const bytes = acceptanceCoverageCarrierBytes(authoredContent);
    const content = canonicalRetainedValue(JSON.parse(bytes.toString("utf8")));
    return Object.freeze({ family: "acceptance", rows: Object.freeze(rows),
      content, bytes,
      source_content_digest: resolved.carrier?.content_digest ?? null,
      prospective_content_digest: controlledContractContentDigest(content) });
  })();
  let acceptance = await buildAcceptance();
  if (obligation !== null) {
    const settledObligationDigest = controlledContractContentDigest(obligation.content);
    if (acceptance !== null &&
        acceptance.content.source_identity.content_digest !== settledObligationDigest) {
      acceptance = await buildAcceptance();
    }
    return Object.freeze({ obligation: Object.freeze({ ...obligation,
      prospective_content_digest: settledObligationDigest }), acceptance });
  }
  return Object.freeze({ obligation, acceptance });
}

export const CONTROLLED_CONTRACT_COVERAGE_FAMILIES = Object.freeze([
  "obligation", "acceptance"
]);

function coverageFamilyFile(family, input) {
  return family === "acceptance"
    ? acceptanceCoverageCarrierPath(input.repoRoot, input.wkId, input.focus ?? null, null)
    : acceptanceCoverageSourcePath(input.repoRoot, input.wkId, input.focus ?? null, null);
}

function coverageFamilyCandidates(input, coverage) {
  return CONTROLLED_CONTRACT_COVERAGE_FAMILIES.filter((family) =>
    coverage[family] !== null && coverage[family] !== undefined).map((family) =>
    ({ family, file: coverageFamilyFile(family, input), item: coverage[family] }));
}

export async function prepareControlledContractRefactorCoverageSettlement({
  input, coverage
}) {
  const candidates = coverageFamilyCandidates(input, coverage);
  const staged = [];
  try {
    for (const candidate of candidates) {
      await refactorCoverageBoundary("coverage_prepare", {
        family: candidate.family
      });
      const prior = await readFile(candidate.file).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      const observedDigest = prior === null ? null
        : controlledContractContentDigest(JSON.parse(prior.toString("utf8")));
      const bytes = Buffer.from(`${JSON.stringify(candidate.item.content, null, 2)}\n`, "utf8");
      const prospectiveDigest = controlledContractContentDigest(
        JSON.parse(bytes.toString("utf8")));
      const alreadyProspective = observedDigest === prospectiveDigest;
      if (!alreadyProspective && candidate.item.source_content_digest !== null &&
          prior === null) {
        throw new ControlledContractToolError(
          `${candidate.family}_coverage_rebase_stale`,
          "refactor coverage source disappeared before preparation", { changed: false });
      }
      if (!alreadyProspective && candidate.item.source_content_digest === null &&
          prior !== null) {
        throw new ControlledContractToolError(
          `${candidate.family}_coverage_rebase_stale`,
          "refactor expected an absent coverage source but observed one before preparation",
          { changed: false, expected_content_digest: null,
            actual_content_digest: observedDigest });
      }
      if (!alreadyProspective && prior !== null &&
          candidate.item.source_content_digest !== null) {
        if (observedDigest !== candidate.item.source_content_digest) throw new ControlledContractToolError(
          `${candidate.family}_coverage_rebase_stale`,
          "refactor coverage source changed before preparation", { changed: false,
            expected_content_digest: candidate.item.source_content_digest,
            actual_content_digest: observedDigest });
      }
      const temporary = alreadyProspective ? null
        : `${candidate.file}.refactor-${randomUUID()}`;
      if (temporary !== null) await writeFile(temporary, bytes,
        { flag: "wx", mode: 0o600 });
      staged.push({ ...candidate, prior, temporary, prospectiveDigest,
        alreadyProspective, committed: false });
      await refactorCoverageBoundary("coverage_staged", {
        family: candidate.family
      });
    }
  } catch (error) {
    for (const entry of staged) if (entry.temporary !== null) {
      await unlink(entry.temporary).catch(() => {});
    }
    throw error;
  }
  const release = async () => {
    for (const entry of staged) if (entry.temporary !== null) {
      await unlink(entry.temporary).catch(() => {});
    }
  };
  return Object.freeze({
    commit: async () => {
      const receipts = {};
      for (const entry of staged) {
        await refactorCoverageBoundary("coverage_commit", {
          family: entry.family
        });
        if (!entry.alreadyProspective) await rename(entry.temporary, entry.file);
        entry.committed = true;
        await refactorCoverageBoundary("coverage_committed", {
          family: entry.family
        });
        receipts[entry.family] = Object.freeze({
          source_content_digest: entry.item.source_content_digest,
          prospective_content_digest: entry.prospectiveDigest,
          changed: entry.item.source_content_digest !==
            entry.prospectiveDigest
        });
      }
      return Object.freeze(receipts);
    },
    compensate: async () => {
      for (const entry of [...staged].reverse()) {
        if (!entry.committed || entry.alreadyProspective) continue;
        await refactorCoverageBoundary("coverage_compensate", {
          family: entry.family
        });
        const observedBytes = await readFile(entry.file).catch((error) => {
          if (error?.code === "ENOENT") return null;
          throw error;
        });
        const observedDigest = observedBytes === null ? null
          : controlledContractContentDigest(JSON.parse(observedBytes.toString("utf8")));
        if (observedDigest !== entry.prospectiveDigest) {
          throw new ControlledContractToolError(
            `${entry.family}_coverage_rebase_stale`,
            "refactor compensation cannot overwrite concurrent coverage work",
            { changed: false,
              expected_content_digest: entry.prospectiveDigest,
              actual_content_digest: observedDigest });
        }
        if (entry.prior === null) await unlink(entry.file).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
        else {
          const rollback = `${entry.file}.rollback-${randomUUID()}`;
          await writeFile(rollback, entry.prior, { flag: "wx", mode: 0o600 });
          await rename(rollback, entry.file);
        }
      }
      await release();
    },
    finalize: release
  });
}

export async function prepareControlledContractRefactorCoverageReconciliation({
  input, coverage
}) {
  const receipts = {};
  for (const candidate of coverageFamilyCandidates(input, coverage)) {
    const observedBytes = await readFile(candidate.file).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    const observedDigest = observedBytes === null ? null
      : controlledContractContentDigest(JSON.parse(observedBytes.toString("utf8")));
    const prospectiveDigest = controlledContractContentDigest(candidate.item.content);
    if (observedDigest !== prospectiveDigest) {
      throw new ControlledContractToolError(
        `${candidate.family}_coverage_rebase_stale`,
        "visible coverage does not match the interrupted refactor settlement",
        { changed: false,
          expected_content_digest: prospectiveDigest,
          actual_content_digest: observedDigest });
    }
    receipts[candidate.family] = Object.freeze({
      source_content_digest: candidate.item.source_content_digest,
      prospective_content_digest: prospectiveDigest,
      changed: candidate.item.source_content_digest !==
        prospectiveDigest
    });
  }
  return Object.freeze({
    commit: async () => Object.freeze(receipts),
    compensate: async () => {},
    finalize: async () => {}
  });
}

export function acceptanceCoverageCriterionIdentities(resolved) {
  return deriveCriterionIdentitySet({
    criteria: criterionIdentityInputs(resolved.criteria),
    selectedUnitDigest: acceptanceCoverageUnitDigest(resolved),
    bindings: resolved.bindings
  });
}

export function acceptanceCoverageCarrierContent(input, resolved, rows,
  criterionIdentities) {
  return {
    schema_version: ACCEPTANCE_COVERAGE_CARRIER_VERSION,
    wk_id: input.wkId,
    ...(input.focus === undefined || input.focus === null ? {} : { focus: input.focus }),
    selected_unit: input.selectedUnit ?? null,
    source_identity: {
      source_kind: resolved.source.source_kind,
      content_digest: resolved.source.content_digest
    },
    source_bindings: structuredClone(resolved.bindings),
    criterion_identities: structuredClone(criterionIdentities),
    rows: acceptanceCoverageRows(rows)
  };
}

function acceptanceCoverageCarrierBytes(content) {
  let bytes;
  try {
    bytes = Buffer.from(`${JSON.stringify(content, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new ControlledContractToolError(
      "acceptance_coverage_request_invalid", "acceptance coverage carrier is not JSON",
      { changed: false, cause: error.message }
    );
  }
  if (content.rows.length > ACCEPTANCE_COVERAGE_MAX_ROWS ||
      bytes.byteLength > ACCEPTANCE_COVERAGE_MAX_BYTES) {
    throw new ControlledContractToolError(
      "acceptance_coverage_carrier_oversize",
      "acceptance coverage carrier exceeds its complete-authoring bounds",
      {
        changed: false,
        maximum_rows: ACCEPTANCE_COVERAGE_MAX_ROWS,
        maximum_bytes: ACCEPTANCE_COVERAGE_MAX_BYTES,
        row_count: content.rows.length,
        byte_length: bytes.byteLength
      }
    );
  }
  return bytes;
}

function assertUniqueAcceptanceCoverageCredit(rows) {
  const criteria = new Set();
  for (const row of rows) {
    if (criteria.has(row.criterion_identity) ||
        new Set(row.node_ids).size !== row.node_ids.length) {
      throw new ControlledContractToolError(
        "acceptance_coverage_duplicate_credit",
        "acceptance coverage rows contain duplicate criterion or node credit",
        { changed: false, criterion_identity: row.criterion_identity }
      );
    }
    criteria.add(row.criterion_identity);
  }
}

function assertCompleteAcceptanceCoveragePopulation(rows, resolved) {
  const required = acceptanceCoverageCriterionIdentities(resolved).identities
    .map(({ identity }) => identity);
  const returned = new Set(rows.map(({ criterion_identity: identity }) => identity));
  const requiredSet = new Set(required);
  const missing = required.filter((identity) => !returned.has(identity));
  const unknown = [...returned].filter((identity) => !requiredSet.has(identity));
  if (rows.length !== required.length || missing.length > 0 || unknown.length > 0) {
    throw new ControlledContractToolError(
      "acceptance_coverage_population_incomplete",
      "initial create requires exactly one row for every current selected-unit criterion",
      {
        changed: false,
        required_rows: required.length,
        returned_rows: rows.length,
        missing_criterion_count: missing.length,
        unknown_criterion_count: unknown.length
      }
    );
  }
}

function assertCriterionSelector(selector, resolved, name = "criterionSelector") {
  exactObject(selector, ["kind", "criterion_identity"], name);
  if (selector.kind !== "criterion_identity" ||
      typeof selector.criterion_identity !== "string" ||
      selector.criterion_identity.length === 0 ||
      !acceptanceCoverageCriterionIdentities(resolved).identities.some(
        ({ identity }) => identity === selector.criterion_identity)) {
    throw new ControlledContractToolError(
      "acceptance_coverage_criterion_selector_invalid",
      "criterion selector does not identify a current selected-unit criterion",
      { changed: false, selector_kind: selector?.kind ?? null,
        next_calls: coverageSelectorRecovery({ family: "acceptance", input: resolved }) }
    );
  }
  return selector.criterion_identity;
}

function acceptanceCoverageQuerySelector(selector, resolved) {
  if (selector === undefined) return undefined;
  exactObject(selector, ["kind", "criterion_identity", "node_id"], "selector");
  if (selector.kind === "criterion_identity") {
    return { criterionIdentity: assertCriterionSelector(selector, resolved, "selector") };
  }
  if (selector.kind === "contract_node" && typeof selector.node_id === "string" &&
      selector.node_id.length > 0 && resolved.contractNodes.some(
        ({ id }) => id === selector.node_id)) return { nodeId: selector.node_id };
  throw new ControlledContractToolError(
    "acceptance_coverage_criterion_selector_invalid",
    "query selector does not identify a current criterion or contract node",
    { changed: false, selector_kind: selector?.kind ?? null,
      next_calls: coverageSelectorRecovery({ family: "acceptance", input: resolved }) }
  );
}

function assertAcceptanceCoverageIdentityPreconditions(input, resolved, { create }) {
  exactObject(input.carrierIdentity,
    ["carrier_kind", "wk_id", "focus", "selected_unit", "content_digest"],
    "carrierIdentity");
  exactObject(input.sourceIdentity, ["source_kind", "content_digest"], "sourceIdentity");
  const currentIdentity = acceptanceCoverageCarrierIdentity(resolved);
  if (input.carrierIdentity.carrier_kind !== currentIdentity.carrier_kind ||
      input.carrierIdentity.wk_id !== currentIdentity.wk_id ||
      (input.carrierIdentity.focus ?? null) !== currentIdentity.focus ||
      (input.carrierIdentity.selected_unit ?? null) !== currentIdentity.selected_unit ||
      (create && input.carrierIdentity.content_digest !== currentIdentity.content_digest)) {
    throw new ControlledContractToolError(
      "acceptance_coverage_carrier_identity_mismatch",
      "carrier identity does not match the server-resolved coverage carrier",
      { changed: false }
    );
  }
  if (input.sourceIdentity.source_kind !== "obligation-coverage" ||
      resolved.source.source_kind !== input.sourceIdentity.source_kind ||
      resolved.source.content_digest !== input.sourceIdentity.content_digest) {
    throw new ControlledContractToolError(
      "acceptance_coverage_source_stale", "canonical acceptance source changed",
      { changed: false, expected: input.sourceIdentity.content_digest,
        actual: resolved.source.content_digest }
    );
  }
  const currentDigest = resolved.carrier?.content_digest ?? null;
  if (create ? currentDigest !== null || input.expectedContentDigest !== null
    : currentDigest === null || input.expectedContentDigest !== currentDigest ||
      input.carrierIdentity.content_digest !== currentDigest) {
    throw new ControlledContractToolError(
      create ? "acceptance_coverage_expected_absence_mismatch"
        : "acceptance_coverage_content_digest_mismatch",
      "canonical acceptance-coverage carrier precondition mismatched",
      { changed: false, expected_content_digest: input.expectedContentDigest,
        actual_content_digest: currentDigest }
    );
  }
  if (create) assertAcceptanceCoverageUnitCurrent(
    input.expectedUnitDigest, resolved, "admission"
  );
  const changedBindings = changedAcceptanceCoverageBindings(
    resolved.carrier?.content.source_bindings, resolved.bindings
  );
  if (!create && changedBindings.length > 0) throw new ControlledContractToolError(
    "acceptance_coverage_currentness_stale",
    "canonical acceptance-coverage bindings are stale",
    { changed: false, changed_bindings: changedBindings }
  );
}

function assertAcceptanceCoverageUnitCurrent(expectedUnitDigest, resolved, phase) {
  const actualUnitDigest = acceptanceCoverageUnitDigest(resolved);
  if (expectedUnitDigest !== actualUnitDigest) throw new ControlledContractToolError(
    phase === "admission"
      ? "acceptance_coverage_unit_currentness_stale"
      : "acceptance_coverage_final_compare_stale",
    phase === "admission"
      ? "described selected-unit identity is stale"
      : "described selected-unit identity changed before persistence",
    { changed: false, phase, expected_unit_digest: expectedUnitDigest,
      actual_unit_digest: actualUnitDigest }
  );
}

function acceptanceCoverageSnapshotIdentity(resolved) {
  return JSON.stringify({
    carrier: resolved.carrier?.content_digest ?? null,
    source: {
      kind: resolved.source.source_kind,
      digest: resolved.source.content_digest
    },
    bindings: resolved.bindings
  });
}

function assertAcceptanceCoverageSnapshotCurrent(expected, actual) {
  if (acceptanceCoverageSnapshotIdentity(expected) !==
      acceptanceCoverageSnapshotIdentity(actual)) {
    throw new ControlledContractToolError(
      "acceptance_coverage_final_compare_stale",
      "a mutation-relevant canonical identity changed before persistence",
      { changed: false }
    );
  }
}

async function persistAcceptanceCoverageCarrier({ input, content, bytes, expectedSnapshot,
  resolveFacts, write = true, directorySync = false, classifyPostCommit = false,
  persistenceEffects = {},
  withSourceLease = withCanonicalControlledContractSourceLease }) {
  const file = acceptanceCoverageCarrierPath(
    input.repoRoot, input.wkId, input.focus ?? null, input.selectedUnit ?? null
  );
  const temporaryFile = `${file}.tmp-${randomUUID()}`;
  let temporary = null;
  const openFile = persistenceEffects.openFile ?? open;
  const renameFile = persistenceEffects.renameFile ?? rename;
  const unlinkFile = persistenceEffects.unlinkFile ?? unlink;
  const readReceipt = persistenceEffects.readReceipt ?? readAcceptanceCoverageCarrier;
  const resolveCommitted = persistenceEffects.resolveCommitted ??
    readAcceptanceCoverageCarrier;
  const syncDirectory = persistenceEffects.syncDirectory ?? (async (target) => {
    const directory = await open(dirname(target), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  });
  return withSourceLease({
    repoRoot: input.repoRoot,
    wkId: input.wkId,
    focus: input.focus ?? null
  }, async () => {
    try {
    const finalSnapshot = await resolveFacts(acceptanceCoverageResolutionInput(input), {
      requireCarrier: expectedSnapshot.carrier !== null
    });
    if (input.expectedUnitDigest !== undefined) assertAcceptanceCoverageUnitCurrent(
      input.expectedUnitDigest, finalSnapshot, "final_compare"
    );
    assertAcceptanceCoverageSnapshotCurrent(expectedSnapshot, finalSnapshot);
    const expectedDigest = controlledContractContentDigest(content);
    if (!write) return Object.freeze({ content_digest: expectedDigest, changed: false });
    temporary = await openFile(temporaryFile, "wx", 0o644);
    await temporary.writeFile(bytes);
    await temporary.sync();
    await temporary.close();
    temporary = null;
    const renameSnapshot = await resolveFacts(acceptanceCoverageResolutionInput(input), {
      requireCarrier: expectedSnapshot.carrier !== null
    });
    if (input.expectedUnitDigest !== undefined) assertAcceptanceCoverageUnitCurrent(
      input.expectedUnitDigest, renameSnapshot, "final_compare"
    );
    assertAcceptanceCoverageSnapshotCurrent(expectedSnapshot, renameSnapshot);
    await renameFile(temporaryFile, file);
    try {
      if (directorySync) await syncDirectory(file);
      const persisted = await readReceipt(input);
      if (persisted?.content_digest !== expectedDigest) throw new ControlledContractToolError(
        "acceptance_coverage_persistence_receipt_mismatch",
        "persisted carrier does not identify the exact canonical content",
        { expected_content_digest: expectedDigest,
          actual_content_digest: persisted?.content_digest ?? null }
      );
    } catch (error) {
      if (!classifyPostCommit) throw error;
      let committed = false;
      try {
        committed = (await resolveCommitted(input))?.content_digest === expectedDigest;
      } catch {
        committed = false;
      }
      return Object.freeze({
        status: "post_commit_failure",
        commit_state: committed ? "committed" : "indeterminate",
        content_digest: expectedDigest,
        failure_code: error?.code ?? "acceptance_coverage_post_commit_failure"
      });
    }
    return Object.freeze({ content_digest: expectedDigest, changed: true });
    } finally {
      if (temporary !== null) await temporary.close();
      try {
        await unlinkFile(temporaryFile);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  });
}

function coveragePrePublicationRefusal(error) {
  if (!(error instanceof ControlledContractToolError) ||
      error.details?.changed !== undefined) return error;
  return new ControlledContractToolError(error.code, error.message, {
    ...error.details, changed: false, effect_phase: "pre_publication"
  });
}

async function mutateControlledContractAcceptanceCoverage(input, {
  create,
  rowsFromResolved,
  resolveFacts = resolveAcceptanceCoverageFacts,
  persistCarrier = persistAcceptanceCoverageCarrier,
  readPublishedCarrier = readAcceptanceCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
}) {
  let resolved, content, bytes, prospectiveDigest, immediatelyCurrent;
  try {
    const resolutionInput = acceptanceCoverageResolutionInput(input);
    resolved = await resolveFacts(resolutionInput, { requireCarrier: !create });
    assertAcceptanceCoverageIdentityPreconditions(input, resolved, { create });
    const rows = acceptanceCoverageRows(rowsFromResolved(resolved));
    if (rows.length > ACCEPTANCE_COVERAGE_MAX_ROWS) {
      throw new ControlledContractToolError(
        "acceptance_coverage_carrier_oversize",
        "acceptance coverage carrier exceeds its complete-authoring bounds",
        {
          changed: false,
          maximum_rows: ACCEPTANCE_COVERAGE_MAX_ROWS,
          maximum_bytes: ACCEPTANCE_COVERAGE_MAX_BYTES,
          row_count: rows.length,
          byte_length: null
        }
      );
    }
    assertUniqueAcceptanceCoverageCredit(rows);
    const state = deriveControlledContractAcceptanceCoverage(
      acceptanceCoverageFactsFromRows(resolved, rows)
    );
    content = acceptanceCoverageCarrierContent(
      input, resolved, rows, state.criterion_identities
    );
    bytes = acceptanceCoverageCarrierBytes(content);
    if (create) assertCompleteAcceptanceCoveragePopulation(rows, resolved);
    prospectiveDigest = controlledContractContentDigest(content);
    if (!create && resolved.carrier.content_digest === prospectiveDigest) {
      return Object.freeze({
        carrier_kind: "controlled-acceptance",
        content_digest: prospectiveDigest,
        authoring_identity: acceptanceCoverageAuthoringIdentity(resolved),
        carrier_identity: Object.freeze({
          ...acceptanceCoverageCarrierIdentity(resolved),
          content_digest: prospectiveDigest
        }),
        source_identity: Object.freeze({
          source_kind: resolved.source.source_kind,
          content_digest: resolved.source.content_digest
        }),
        changed: false,
        next_calls: coverageFamilyContinuationCalls(input, "acceptance"),
        authority: ACCEPTANCE_COVERAGE_NON_AUTHORITY
      });
    }
    immediatelyCurrent = await resolveFacts(resolutionInput, { requireCarrier: !create });
    if (input.expectedUnitDigest !== undefined) assertAcceptanceCoverageUnitCurrent(
      input.expectedUnitDigest, immediatelyCurrent, "final_compare"
    );
    assertAcceptanceCoverageSnapshotCurrent(resolved, immediatelyCurrent);
  } catch (error) {
    throw coveragePrePublicationRefusal(error);
  }
  const receipt = await persistCarrier({
    input, content, bytes, expectedSnapshot: immediatelyCurrent, resolveFacts,
    withSourceLease
  });
  const persisted = await readPublishedCarrier(input);
  if (receipt?.changed !== true || receipt.content_digest !== prospectiveDigest ||
      persisted?.content_digest !== prospectiveDigest) {
    throw new ControlledContractToolError(
      "acceptance_coverage_persistence_receipt_mismatch",
      "mutation did not persist the exact canonical carrier",
      { ...(persisted?.content_digest === prospectiveDigest ? { changed: true } : {}),
        commit_state: persisted?.content_digest === prospectiveDigest ? "committed" : "indeterminate",
        expected_content_digest: prospectiveDigest,
        receipt_content_digest: receipt?.content_digest ?? null,
        receipt_changed: receipt?.changed ?? null,
        actual_content_digest: persisted?.content_digest ?? null }
    );
  }
  return Object.freeze({
    carrier_kind: "controlled-acceptance",
    content_digest: prospectiveDigest,
    authoring_identity: acceptanceCoverageAuthoringIdentity(resolved),
    carrier_identity: Object.freeze({
      ...acceptanceCoverageCarrierIdentity(resolved),
      content_digest: prospectiveDigest
    }),
    source_identity: Object.freeze({
      source_kind: resolved.source.source_kind,
      content_digest: resolved.source.content_digest
    }),
    changed: true,
    next_calls: coverageFamilyContinuationCalls(input, "acceptance"),
    authority: ACCEPTANCE_COVERAGE_NON_AUTHORITY
  });
}

export async function describeControlledContractAcceptanceCoverageOperation(input, {
  resolveFacts = resolveAcceptanceCoverageFacts
} = {}) {
  return controlledContractOperation(async () => {
    acceptanceCoverageOperationInput(input, []);
    let resolved;
    try {
      resolved = await resolveFacts(acceptanceCoverageResolutionInput(input), {
        requireCarrier: false
      });
    } catch (error) {
      return ownerProducedCoverageRecovery(input, error, { acceptance: true });
    }
    const changedBindings = changedAcceptanceCoverageBindings(
      resolved.carrier?.content.source_bindings, resolved.bindings
    );
    const unitDigest = acceptanceCoverageUnitDigest(resolved);
    const criterionIdentities = acceptanceCoverageCriterionIdentities(resolved);
    const carrierIdentity = acceptanceCoverageCarrierIdentity(resolved);
    const sourceIdentity = Object.freeze({
      source_kind: resolved.source.source_kind,
      content_digest: resolved.source.content_digest
    });
    const absent = resolved.carrier === null;
    const status = absent ? "carrier_absent"
      : changedBindings.length === 0 ? "carrier_present_current" : "carrier_present_stale";
    const supportedNextCalls = Object.freeze([]);
    const nextCalls = Object.freeze([]);
    const composedAuthoringSkeleton = composeControlledContractCoverageAuthoringSkeleton({
      surface: "acceptance",
      unit: {
        address: resolved.selectedUnit === null
          ? resolved.wkId : `${resolved.wkId}#${resolved.selectedUnit}`,
        selectedUnit: resolved.selectedUnit,
        focus: resolved.focus,
        digest: unitDigest
      },
      criterionIdentities: criterionIdentities.identities,
      contract: { contentDigest: resolved.contract.content_digest,
        nodes: resolved.contractNodeSemantics },
      proofPlan: { contentDigest: resolved.plan?.content_digest ?? null,
        selectedPacks: resolved.selectedPacks },
      carrier: { status, changedBindings },
      mutation: coverageAuthoringMutation(
        nextCalls, "acceptance", absent, resolved
      )
    });
    const authoringSkeleton = status === "carrier_present_stale"
      ? Object.freeze(Object.fromEntries(Object.entries(composedAuthoringSkeleton).filter(
          ([key]) => key !== "mutation_handoff" && key !== "execution_handoff"
        )))
      : composedAuthoringSkeleton;
    return Object.freeze({
      schema_version: "controlled-contract-acceptance-coverage-describe.v1",
      status,
      unit: Object.freeze({
        wk_id: resolved.wkId,
        focus: resolved.focus,
        selected_unit: resolved.selectedUnit,
        address: resolved.selectedUnit === null
          ? resolved.wkId : `${resolved.wkId}#${resolved.selectedUnit}`,
        kind: resolved.selectedUnit === null ? "wk" : "slice",
        digest: unitDigest
      }),
      criterion_identities: criterionIdentities,
      source_identity: sourceIdentity,
      carrier_identity: carrierIdentity,
      authoring_identity: acceptanceCoverageAuthoringIdentity(resolved),
      expected_absence: Object.freeze({ proven: absent, expected_content_digest: null }),
      digests: Object.freeze({
        contract: resolved.contract.content_digest,
        proof_plan: resolved.plan?.content_digest ?? null,
        source: resolved.source.content_digest,
        carrier: resolved.carrier?.content_digest ?? null,
        bindings: controlledContractContentDigest(resolved.bindings)
      }),
      currentness: Object.freeze({ current: changedBindings.length === 0,
        changed_bindings: Object.freeze(changedBindings) }),
      bounds: Object.freeze({ maximum_rows: ACCEPTANCE_COVERAGE_MAX_ROWS,
        maximum_bytes: ACCEPTANCE_COVERAGE_MAX_BYTES }),
      obligation_resolution: proofAuthoringCompletenessSummary(resolved),
      authoring_applicability: resolved.authoringApplicability,
      authoring_skeleton: authoringSkeleton,
      supported_next_calls: Object.freeze(supportedNextCalls),
      next_calls: Object.freeze(nextCalls),
      authority: ACCEPTANCE_COVERAGE_NON_AUTHORITY
    });
  });
}

export async function createControlledContractAcceptanceCoverageOperation(input, {
  resolveFacts = resolveAcceptanceCoverageFacts,
  persistCarrier = persistAcceptanceCoverageCarrier,
  readPublishedCarrier = readAcceptanceCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
} = {}) {
  return controlledContractOperation(async () => {
    acceptanceCoverageOperationInput(input, ["carrierIdentity", "sourceIdentity",
      "expectedUnitDigest", "expectedContentDigest", "rows"]);
    if (typeof input.expectedUnitDigest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(input.expectedUnitDigest)) {
      throw new ControlledContractToolError(
        "acceptance_coverage_request_invalid",
        "create requires the expected_unit_digest returned by describe",
        { changed: false }
      );
    }
    if (input.expectedContentDigest !== null) throw new ControlledContractToolError(
      "acceptance_coverage_expected_absence_required",
      "create requires expected_content_digest null", { changed: false }
    );
    return mutateControlledContractAcceptanceCoverage(input, {
      create: true,
      rowsFromResolved: () => input.rows,
      resolveFacts,
      persistCarrier,
      readPublishedCarrier,
      withSourceLease
    });
  });
}

export async function upsertControlledContractAcceptanceCoverageOperation(input, {
  resolveFacts = resolveAcceptanceCoverageFacts,
  persistCarrier = persistAcceptanceCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
} = {}) {
  return controlledContractOperation(async () => {
    acceptanceCoverageOperationInput(input, ["carrierIdentity", "sourceIdentity",
      "expectedContentDigest", "criterionSelector", "row"]);
    const [row] = acceptanceCoverageRows([input.row], "row");
    return mutateControlledContractAcceptanceCoverage(input, {
      create: false,
      rowsFromResolved: (resolved) => {
        const selectedIdentity = assertCriterionSelector(input.criterionSelector, resolved);
        if (selectedIdentity !== row.criterion_identity) throw new ControlledContractToolError(
          "acceptance_coverage_criterion_selector_invalid",
          "upsert row does not match its typed criterion selector",
          { changed: false }
        );
        const rows = acceptanceCoverageRows(resolved.rows);
        const position = rows.findIndex(({ criterion_identity: identity }) =>
          identity === row.criterion_identity);
        if (position === -1) rows.push(row);
        else rows[position] = row;
        return rows;
      },
      resolveFacts,
      persistCarrier,
      withSourceLease
    });
  });
}

export async function removeControlledContractAcceptanceCoverageOperation(input, {
  resolveFacts = resolveAcceptanceCoverageFacts,
  persistCarrier = persistAcceptanceCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
} = {}) {
  return controlledContractOperation(async () => {
    acceptanceCoverageOperationInput(input, ["carrierIdentity", "sourceIdentity",
      "expectedContentDigest", "criterionSelector"]);
    return mutateControlledContractAcceptanceCoverage(input, {
      create: false,
      rowsFromResolved: (resolved) => {
        const selectedIdentity = assertCriterionSelector(input.criterionSelector, resolved);
        return acceptanceCoverageRows(resolved.rows).filter(
          ({ criterion_identity: identity }) => identity !== selectedIdentity
        );
      },
      resolveFacts,
      persistCarrier,
      withSourceLease
    });
  });
}

function acceptanceCoveragePatchOperations(operations, resolved) {
  if (!Array.isArray(operations)) return operations;
  return operations.map((operation, index) => {
    const name = `operations[${index}]`;
    if (operation?.op === "upsert") {
      exactObject(operation, ["op", "criterionSelector", "row"], name);
      const selectedIdentity = assertCriterionSelector(
        operation.criterionSelector, resolved, `${name}.criterionSelector`
      );
      const [row] = acceptanceCoverageRows([operation.row], `${name}.row`);
      if (selectedIdentity !== row.criterion_identity) throw new ControlledContractToolError(
        "acceptance_coverage_criterion_selector_invalid",
        "patch upsert row does not match its typed criterion selector",
        { changed: false, operation_index: index }
      );
      return { op: "upsert", target: "rows", id: selectedIdentity, value: row };
    }
    exactObject(operation, ["op", "criterionSelector"], name);
    if (operation.op !== "remove") throw new ControlledContractToolError(
      "controlled_contract_patch_operation_invalid",
      "patch operation must be one typed upsert or remove variant",
      { changed: false, operation_index: index }
    );
    return { op: "remove", target: "rows",
      id: assertCriterionSelector(
        operation.criterionSelector, resolved, `${name}.criterionSelector`
      ) };
  });
}

function applyCoverageFamilyPatch(carrierKind, content, operations) {
  try {
    return applyControlledContractCarrierPatch({ content, carrierKind, operations });
  } catch (error) {
    throw new ControlledContractToolError(
      error?.code ?? "controlled_contract_patch_operation_invalid",
      error?.message ?? "coverage-family patch is invalid",
      { changed: false, ...(error?.details ?? {}) }
    );
  }
}

function assertAcceptanceCoveragePatchAdmission(input, resolved) {
  if (resolved.carrier === null) throw new ControlledContractToolError(
    "acceptance_coverage_carrier_not_found",
    "patch requires one present acceptance-coverage carrier", { changed: false }
  );
  exactObject(input.carrierIdentity,
    ["carrier_kind", "wk_id", "focus", "selected_unit", "content_digest"],
    "carrierIdentity");
  exactObject(input.sourceIdentity, ["source_kind", "content_digest"], "sourceIdentity");
  const currentIdentity = acceptanceCoverageCarrierIdentity(resolved);
  if (input.carrierIdentity.carrier_kind !== currentIdentity.carrier_kind ||
      input.carrierIdentity.wk_id !== currentIdentity.wk_id ||
      (input.carrierIdentity.focus ?? null) !== currentIdentity.focus ||
      (input.carrierIdentity.selected_unit ?? null) !== currentIdentity.selected_unit) {
    throw new ControlledContractToolError(
      "acceptance_coverage_carrier_identity_mismatch",
      "patch carrier identity does not select the resolved carrier", { changed: false }
    );
  }
  if (input.sourceIdentity.source_kind !== resolved.source.source_kind ||
      input.sourceIdentity.content_digest !== resolved.source.content_digest) {
    throw new ControlledContractToolError(
      "acceptance_coverage_source_stale", "canonical acceptance source changed",
      { changed: false }
    );
  }
  assertAcceptanceCoverageUnitCurrent(input.expectedUnitDigest, resolved, "admission");
  if (input.expectedAuthoringIdentity !== acceptanceCoverageAuthoringIdentity(resolved)) {
    throw new ControlledContractToolError(
      "acceptance_coverage_admission_stale",
      "describe-emitted patch authoring identity is stale", { changed: false }
    );
  }
  if (input.carrierIdentity.content_digest !== input.expectedContentDigest) {
    throw new ControlledContractToolError(
      "acceptance_coverage_content_digest_mismatch",
      "patch carrier and expected content digests disagree", { changed: false }
    );
  }
  const changedBindings = changedAcceptanceCoverageBindings(
    resolved.carrier.content.source_bindings, resolved.bindings
  );
  if (changedBindings.length > 0) throw new ControlledContractToolError(
    "acceptance_coverage_currentness_stale",
    "patch cannot author a stale acceptance-coverage carrier",
    { changed: false, changed_bindings: changedBindings }
  );
}

export async function patchControlledContractAcceptanceCoverageOperation(input, {
  resolveFacts = resolveAcceptanceCoverageFacts,
  persistCarrier = persistAcceptanceCoverageCarrier,
  persistenceEffects = {},
  withSourceLease = withCanonicalControlledContractSourceLease
} = {}) {
  return controlledContractOperation(async () => {
    acceptanceCoverageOperationInput(input, [
      "carrierIdentity", "sourceIdentity", "expectedUnitDigest",
      "expectedAuthoringIdentity", "expectedContentDigest", "operations"
    ]);
    const resolutionInput = acceptanceCoverageResolutionInput(input);
    const resolved = await resolveFacts(resolutionInput, { requireCarrier: true });
    assertAcceptanceCoveragePatchAdmission(input, resolved);
    const patch = applyCoverageFamilyPatch(
      "acceptance_coverage", { rows: acceptanceCoverageRows(resolved.rows) },
      acceptanceCoveragePatchOperations(input.operations, resolved)
    );
    const rows = acceptanceCoverageRows(patch.content.rows);
    assertUniqueAcceptanceCoverageCredit(rows);
    const state = deriveControlledContractAcceptanceCoverage(
      acceptanceCoverageFactsFromRows(resolved, rows)
    );
    const content = acceptanceCoverageCarrierContent(
      input, resolved, rows, state.criterion_identities
    );
    const bytes = acceptanceCoverageCarrierBytes(content);
    const currentDigest = resolved.carrier.content_digest;
    const prospectiveDigest = controlledContractContentDigest(content);
    const staleRequest = input.expectedContentDigest !== currentDigest;
    if (staleRequest && prospectiveDigest !== currentDigest) {
      throw new ControlledContractToolError(
        "acceptance_coverage_content_digest_mismatch",
        "stale patch would change the current canonical carrier",
        { changed: false, expected_content_digest: input.expectedContentDigest,
          actual_content_digest: currentDigest }
      );
    }
    const status = staleRequest ? "already_satisfied"
      : prospectiveDigest === currentDigest ? "no_change" : "updated";
    const immediatelyCurrent = await resolveFacts(resolutionInput, { requireCarrier: true });
    assertAcceptanceCoverageSnapshotCurrent(resolved, immediatelyCurrent);
    const receipt = await persistCarrier({
      input, content, bytes, expectedSnapshot: immediatelyCurrent, resolveFacts,
      write: status === "updated", directorySync: true, classifyPostCommit: true,
      persistenceEffects, withSourceLease
    });
    const carrierIdentity = Object.freeze({
      ...acceptanceCoverageCarrierIdentity(resolved),
      content_digest: prospectiveDigest
    });
    const common = {
      schema_version: "controlled-contract-acceptance-coverage-patch.v1",
      carrier_kind: "controlled-acceptance",
      previous_content_digest: currentDigest,
      content_digest: prospectiveDigest,
      operation_count: patch.operation_count,
      upsert_count: patch.upsert_count,
      remove_count: patch.remove_count,
      final_row_count: rows.length,
      carrier_identity: carrierIdentity,
      source_identity: Object.freeze(structuredClone(input.sourceIdentity)),
      authority: ACCEPTANCE_COVERAGE_NON_AUTHORITY
    };
    if (receipt.status === "post_commit_failure") return Object.freeze({
      ...common,
      status: receipt.status,
      commit_state: receipt.commit_state,
      failure_code: receipt.failure_code,
      next_calls: coverageFamilyContinuationCalls(input, "acceptance", "describe")
    });
    return Object.freeze({
      ...common,
      status,
      changed: status === "updated",
      next_calls: coverageFamilyContinuationCalls(input, "acceptance")
    });
  });
}

export async function queryControlledContractAcceptanceCoverageOperation(input, {
  resolveFacts = resolveAcceptanceCoverageFacts
} = {}) {
  return controlledContractOperation(async () => {
    acceptanceCoverageOperationInput(input, ["selector", "cursor"]);
    const resolved = await resolveFacts(acceptanceCoverageResolutionInput(input), {
      requireCarrier: true
    });
    const state = deriveControlledContractAcceptanceCoverage(
      acceptanceCoverageFactsFromRows(resolved, resolved.rows)
    );
    const selector = acceptanceCoverageQuerySelector(input.selector, resolved);
    const projectionCursor = decodeAcceptanceCoverageOperationCursor(
      input.cursor, state.unit_digest
    );
    const projection = projectPublicAcceptanceCoverage({
      criterionIdentities: state.criterion_identities,
      evaluation: state.evaluation,
      criterionAxes: state.criterion_axes,
      ...(selector === undefined ? {} : { selector }),
      ...(projectionCursor === undefined ? {} : { cursor: projectionCursor })
    });
    if (projectionCursor !== undefined &&
        projection.page.offset >= projection.page.total) {
      throw new ControlledContractToolError(
        "acceptance_coverage_cursor_exhausted",
        "continuation offset is at or beyond the current selected population",
        { changed: false }
      );
    }
    const publicContinuation = projection.page.continuation === null
      ? null
      : encodeAcceptanceCoverageOperationCursor(
        projection.page.continuation, state.unit_digest
      );
    const normalizedSelector = publicAcceptanceCoverageSelector(selector);
    const continuation = [];
    const allItems = projection.selector === null
      ? projection.totals.gaps
      : projection.totals.criteria + projection.unmapped_mandatory_node_ids.length;
    const nextOffset = projection.page.offset + projection.page.returned;
    return Object.freeze({
      ...projection,
      obligation_resolution: proofAuthoringCompletenessSummary(resolved),
      unit: Object.freeze({
        wk_id: resolved.wkId,
        focus: resolved.focus,
        selected_unit: resolved.selectedUnit,
        digest: acceptanceCoverageUnitDigest(resolved)
      }),
      authoring_identity: acceptanceCoverageAuthoringIdentity(resolved),
      totals: Object.freeze({
        ...projection.totals,
        all_items: allItems,
        matched_items: projection.page.total
      }),
      page: Object.freeze({
        ...projection.page,
        remaining: projection.page.total - nextOffset,
        complete: publicContinuation === null,
        continuation: publicContinuation
      }),
      next_calls: Object.freeze(continuation),
      authority: Object.freeze({ ...ACCEPTANCE_COVERAGE_NON_AUTHORITY,
        authors_mappings_only: false })
    });
  });
}

export { proofAuthoringCarrierContent as obligationCoverageCarrierContent } from './proof-authoring-source.mjs';

export async function rebaseControlledContractAcceptanceCoverageOperation(input, {
  resolveFacts = resolveAcceptanceCoverageFacts,
  resolveSourceFacts = resolveObligationCoverageFacts,
  persistCarrier = persistAcceptanceCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
} = {}) {
  return controlledContractOperation(async () => {
    const fields = input.mode === "attempt"
      ? ["mode", "carrierIdentity", "sourceIdentity", "expectedUnitDigest"]
      : input.mode === "page"
        ? ["mode", "conflictSetIdentity", "cursor"]
        : input.mode === "resolve"
          ? ["mode", "conflictSetIdentity", "dispositions"] : ["mode"];
    acceptanceCoverageOperationInput(input, fields);
    if (!["attempt", "page", "resolve"].includes(input.mode)) {
      throw new ControlledContractToolError(
        "acceptance_coverage_rebase_request_invalid",
        "rebase requires one closed attempt, page, or resolve variant",
        { changed: false }
      );
    }
    const resolutionInput = acceptanceCoverageResolutionInput(input);
    const resolved = await resolveFacts(resolutionInput, { requireCarrier: true });
    const sourceFacts = await resolveSourceFacts(resolutionInput, {
      requireSource: true, allowIncomplete: true
    });

    if (sourceFacts.resolution != null && !proofAuthoringObligationsAccounted(sourceFacts)) {
      return proofAuthoringIncompleteResult(sourceFacts);
    }
    if (!sourceFacts.sourceCurrent) throw new ControlledContractToolError(
      "acceptance_coverage_rebase_source_stale",
      "acceptance mapping cannot rebase before its obligation source is current",
      { changed: false }
    );
    const changedBindings = changedAcceptanceCoverageBindings(
      resolved.carrier.content.source_bindings, resolved.bindings
    );
    if (changedBindings.length === 0) return Object.freeze({
      schema_version: "controlled-contract-acceptance-coverage-rebase.v1",
      status: "already_current", carrier_identity: acceptanceCoverageCarrierIdentity(resolved),
      content_digest: resolved.carrier.content_digest, row_count: resolved.rows.length,
      changed: false, authority: COVERAGE_REBASE_NON_AUTHORITY
    });
    if (input.mode === "attempt") assertAcceptanceRebaseAttemptIdentity(input, resolved);
    const criterionIdentities = acceptanceCoverageCriterionIdentities(resolved);
    const plan = planAcceptanceCoverageRebase(resolved, criterionIdentities);
    const staleRecovery = null;
    if (input.mode !== "attempt") assertConflictSetCurrent(
      plan, input.conflictSetIdentity, staleRecovery
    );
    if (input.mode === "page" || (input.mode === "attempt" && plan.entries.length > 0)) {
      return projectRebaseConflictPage(plan,
        input.mode === "page" ? { cursor: input.cursor, staleRecovery } : { staleRecovery });
    }
    let rows = plan.safeRows;
    if (input.mode === "resolve") {
      rows = await applyCompleteRebaseResolution(plan, input.dispositions, {
        normalizeRow: async (row) => acceptanceCoverageRows([row], "row")[0],
        rowMatchesCurrentIdentity: (row, currentIdentity) => currentIdentity !== null &&
          row.criterion_identity === currentIdentity.criterion_identity
      });
    }
    rows = acceptanceCoverageRows(rows);
    assertUniqueAcceptanceCoverageCredit(rows);
    const state = deriveControlledContractAcceptanceCoverage(
      acceptanceCoverageFactsFromRows(resolved, rows)
    );
    const content = acceptanceCoverageCarrierContent(
      input, resolved, rows, state.criterion_identities
    );
    const bytes = acceptanceCoverageCarrierBytes(content);
    const prospectiveDigest = controlledContractContentDigest(content);
    const immediatelyCurrent = await resolveFacts(resolutionInput, { requireCarrier: true });
    assertAcceptanceCoverageSnapshotCurrent(resolved, immediatelyCurrent);
    const receipt = await persistCarrier({ input, content, bytes,
      expectedSnapshot: immediatelyCurrent, resolveFacts, withSourceLease });
    if (receipt.content_digest !== prospectiveDigest) throw new ControlledContractToolError(
      "acceptance_coverage_persistence_receipt_mismatch",
      "rebase did not persist the exact complete semantic carrier",
      { changed: false, expected_content_digest: prospectiveDigest,
        actual_content_digest: receipt.content_digest }
    );
    return Object.freeze({
      schema_version: "controlled-contract-acceptance-coverage-rebase.v1",
      status: "resolved",
      carrier_identity: Object.freeze({ ...acceptanceCoverageCarrierIdentity(resolved),
        content_digest: prospectiveDigest }),
      content_digest: prospectiveDigest,
      row_count: rows.length,
      byte_length: bytes.byteLength,
      changed: true,
      authority: COVERAGE_REBASE_NON_AUTHORITY
    });
  });
}
