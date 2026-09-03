

import { randomUUID } from "node:crypto";
import { link, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { processStartIdentity } from
  "../../lib/controlled-contract-carrier-set-publication.mjs";

import {
  ControlledContractToolError,
  applyControlledContractCarrierPatch,
  assertControlledContractOperationInput,
  controlledContractContentDigest,
  deriveCanonicalControlledContractAuthoringState,
  withCanonicalControlledContractSourceLease
} from "../../lib/controlled-contract-tools.mjs";
import {
  deriveControlledContractAcceptanceCoverage,
  deriveCriterionIdentitySet,
  projectAcceptanceCoverage
} from "../../lib/controlled-contract-acceptance-coverage.mjs";
import { composeControlledContractCoverageAuthoringSkeleton }
  from "../../lib/controlled-contract-coverage-authoring-skeleton.mjs";
import {
  ACCEPTANCE_COVERAGE_BINDING_KEYS,
  ACCEPTANCE_COVERAGE_CARRIER_VERSION,
  ACCEPTANCE_COVERAGE_MAX_BYTES,
  ACCEPTANCE_COVERAGE_MAX_ROWS,
  OBLIGATION_COVERAGE_MAX_BYTES,
  OBLIGATION_COVERAGE_MAX_ROWS,
  acceptanceCoverageCarrierPath,
  acceptanceCoverageSourcePath,
  acceptanceCoverageRows,
  assertObligationCoverageSourcePathIntegrity,
  exactObject,
  obligationCoverageSourceLocatorDigest,
  readAcceptanceCoverageCarrier,
  readCanonicalObligationSource,
  resolveAcceptanceCoverageFacts,
  resolveObligationCoverageFacts
} from "./acceptance-coverage-facts.mjs";
import {
  COVERAGE_REBASE_NON_AUTHORITY,
  applyCompleteRebaseResolution,
  assertConflictSetCurrent,
  planAcceptanceCoverageRebase,
  planObligationCoverageRebase,
  projectRebaseConflictPage,
  withOrderedCoverageLocks
} from "./acceptance-coverage-rebase.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import { controlledContractOperation } from "./refusal.mjs";
import {
  acceptanceCoverageDescribeCalls,
  attachOwnerProducedRecovery,
  coverageSelectorRecovery,
  obligationCoverageDescribeCalls
} from "./coverage-recovery-guidance.mjs";

let controlledContractRefactorCoverageHook = null;

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

async function acquireRefactorCoverageLock(file) {
  const lockFile = `${file}.lock`;
  const processStart = await processStartIdentity(process.pid).catch(() => null);
  if (processStart === null) throw new ControlledContractToolError(
    "controlled_contract_coverage_rebase_lock_unavailable",
    "coverage lock process identity is unavailable", { changed: false });
  const record = { schema_version: "controlled-contract-refactor-coverage-lock.v1",
    operation_token: randomUUID(), process_id: process.pid,
    process_start_identity: processStart };
  const create = async () => {
    let handle = null;
    try {
      handle = await open(lockFile, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
      return { file: lockFile, handle, record };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (handle !== null) await unlink(lockFile).catch(() => {});
      throw error;
    }
  };
  try {
    return await create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  let existing;
  try {
    existing = JSON.parse(await readFile(lockFile, "utf8"));
  } catch {
    throw new ControlledContractToolError(
      "controlled_contract_coverage_rebase_lock_unavailable",
      "coverage lock owner is unverifiable and remains untouched", { changed: false });
  }
  const valid = existing?.schema_version ===
      "controlled-contract-refactor-coverage-lock.v1" &&
    typeof existing.operation_token === "string" &&
    Number.isSafeInteger(existing.process_id) && existing.process_id > 0 &&
    typeof existing.process_start_identity === "string";
  if (!valid) throw new ControlledContractToolError(
    "controlled_contract_coverage_rebase_lock_unavailable",
    "coverage lock owner is unverifiable and remains untouched", { changed: false });
  const observedStart = await processStartIdentity(existing.process_id).catch(() => undefined);
  if (observedStart === undefined || observedStart === existing.process_start_identity) {
    throw new ControlledContractToolError(
      "controlled_contract_coverage_rebase_lock_unavailable",
      "coverage persistence has a live or unverifiable owner", { changed: false });
  }
  const quarantine = `${lockFile}.stale-${existing.operation_token}-${randomUUID()}`;
  try {
    await rename(lockFile, quarantine);
  } catch (error) {
    throw new ControlledContractToolError(
      "controlled_contract_coverage_rebase_lock_unavailable",
      "coverage stale-lock recovery lost the ownership race",
      { changed: false, cause: error?.code ?? null });
  }
  await refactorCoverageBoundary("coverage_stale_lock_quarantined", { file });
  try {
    const acquired = await create();
    await unlink(quarantine).catch(() => {});
    return acquired;
  } catch (error) {
    try {

      await link(quarantine, lockFile);
      await unlink(quarantine);
    } catch (restoreError) {
      if (restoreError?.code === "EEXIST") {
        await unlink(quarantine).catch(() => {});
      }
    }
    throw new ControlledContractToolError(
      "controlled_contract_coverage_rebase_lock_unavailable",
      "coverage stale-lock recovery lost the ownership race",
      { changed: false, cause: error?.code ?? null });
  }
}

async function releaseRefactorCoverageLock(lock) {
  await lock.handle.close().catch(() => {});
  let observed;
  try { observed = JSON.parse(await readFile(lock.file, "utf8")); } catch { return; }
  if (observed.operation_token === lock.record.operation_token &&
      observed.process_id === lock.record.process_id &&
      observed.process_start_identity === lock.record.process_start_identity) {
    await unlink(lock.file).catch(() => {});
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
  mode, obligationFacts = null, acceptanceFacts = null
}) {
  if (mode?.kind !== "replace_subgraph") {
    return Object.freeze({ obligation: null, acceptance: null });
  }
  const prepareFacts = (resolved) => {
    if (resolved === null) return null;
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
    return Object.freeze({ family: "obligation", rows: Object.freeze(rows),
      content: validated.content, bytes: validated.bytes,
      source_content_digest: resolved.source?.content_digest ?? null,
      prospective_content_digest: controlledContractContentDigest(validated.content) });
  })();
  const acceptance = plans.acceptance === null ? null : await (async () => {
    const resolved = plans.acceptance.refactorResolved;
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
    const content = acceptanceCoverageCarrierContent(input, resolved, rows,
      state.criterion_identities);
    const bytes = acceptanceCoverageCarrierBytes(content);
    return Object.freeze({ family: "acceptance", rows: Object.freeze(rows),
      content, bytes,
      source_content_digest: resolved.carrier?.content_digest ?? null,
      prospective_content_digest: controlledContractContentDigest(content) });
  })();
  return Object.freeze({ obligation, acceptance });
}

export async function prepareControlledContractRefactorCoverageSettlement({
  input, coverage
}) {
  const candidates = [];
  if (coverage.obligation !== null) candidates.push({
    family: "obligation",
    file: acceptanceCoverageSourcePath(input.repoRoot, input.wkId,
      input.focus ?? null, null),
    item: coverage.obligation
  });
  if (coverage.acceptance !== null) candidates.push({
    family: "acceptance",
    file: acceptanceCoverageCarrierPath(input.repoRoot, input.wkId,
      input.focus ?? null, null),
    item: coverage.acceptance
  });
  const locks = [];
  const staged = [];
  try {
    for (const file of [...new Set(candidates.flatMap(({ family, file }) =>
      family === "acceptance"
        ? [acceptanceCoverageSourcePath(input.repoRoot, input.wkId,
            input.focus ?? null, null), file]
        : [file]))].sort()) {
      locks.push(await acquireRefactorCoverageLock(file));
    }
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
    for (const lock of locks.reverse()) {
      await releaseRefactorCoverageLock(lock);
    }
    throw error;
  }
  const release = async () => {
    for (const entry of staged) if (entry.temporary !== null) {
      await unlink(entry.temporary).catch(() => {});
    }
    for (const lock of locks.reverse()) {
      await releaseRefactorCoverageLock(lock);
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
  const candidates = [];
  if (coverage.obligation !== null) candidates.push({ family: "obligation",
    file: acceptanceCoverageSourcePath(input.repoRoot, input.wkId,
      input.focus ?? null, null), item: coverage.obligation });
  if (coverage.acceptance !== null) candidates.push({ family: "acceptance",
    file: acceptanceCoverageCarrierPath(input.repoRoot, input.wkId,
      input.focus ?? null, null), item: coverage.acceptance });
  const lockFiles = [...new Set(candidates.flatMap(({ family, file }) =>
    family === "acceptance"
      ? [acceptanceCoverageSourcePath(input.repoRoot, input.wkId,
          input.focus ?? null, null), file]
      : [file]))].sort();
  const locks = [];
  const release = async () => {
    for (const lock of locks.reverse()) await releaseRefactorCoverageLock(lock);
  };
  try {
    for (const file of lockFiles) locks.push(await acquireRefactorCoverageLock(file));
    const receipts = {};
    for (const candidate of candidates) {
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
      finalize: release
    });
  } catch (error) {
    await release();
    throw error;
  }
}

function acceptanceCoverageOperationInput(input, fields) {
  return assertControlledContractOperationInput(input, [
    "repoRoot", "wkId", "focus", "selectedUnit", ...fields
  ]);
}

function acceptanceCoverageResolutionInput(input) {
  return {
    repoRoot: input.repoRoot,
    wkId: input.wkId,
    focus: input.focus ?? null,
    selectedUnit: input.selectedUnit ?? null
  };
}

function coverageFamilyContinuationCalls(input, family, operation = "query") {
  return Object.freeze([Object.freeze({
    tool: `workspace_controlled_contract_${family}_coverage_${operation}`,
    arguments: Object.freeze({
      unit: input.selectedUnit === undefined || input.selectedUnit === null
        ? input.wkId : `${input.wkId}#${input.selectedUnit}`,
      ...(input.focus === undefined || input.focus === null
        ? {} : { focus: input.focus })
    })
  })]);
}

function coverageAuthoringMutation(nextCalls, family, absent, resolved) {
  const operation = `workspace_controlled_contract_${family}_coverage_${
    absent ? "create" : "upsert"}`;
  const call = nextCalls.find(({ tool }) => tool === operation);
  return {
    operation,
    fixedArguments: structuredClone(call?.fixed_arguments ?? {
      unit: resolved.selectedUnit === null
        ? resolved.wkId : `${resolved.wkId}#${resolved.selectedUnit}`,
      ...(resolved.focus === null ? {} : { focus: resolved.focus })
    }),
    receiptFedDigestFields: absent ? [] : [
      "expected_content_digest",
      ...(family === "acceptance"
        ? ["carrier_identity.content_digest", "source_identity.content_digest"]
        : [])
    ]
  };
}

async function ownerProducedCoverageRecovery(input, error, {
  acceptance = false
} = {}) {
  let ownerState = null;
  let upstreamDescribe = null;
  try {
    ownerState = await deriveCanonicalControlledContractAuthoringState({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      continuation: null,
      request: {
        wk_id: input.wkId,
        ...(input.focus === undefined || input.focus === null
          ? {} : { focus: input.focus })
      }
    });
  } catch {

  }
  if (acceptance && (ownerState?.next_calls?.length ?? 0) === 0) {
    try {
      upstreamDescribe = await describeControlledContractObligationCoverageOperation(input);
    } catch {

    }
  }
  throw attachOwnerProducedRecovery(error, { input, ownerState, upstreamDescribe });
}

const ACCEPTANCE_COVERAGE_NON_AUTHORITY = Object.freeze({
  authoritative: false,
  authors_mappings_only: true,
  grants: Object.freeze([])
});

function changedAcceptanceCoverageBindings(bound, current) {
  if (!bound) return [];
  return ACCEPTANCE_COVERAGE_BINDING_KEYS.filter((key) => bound[key] !== current[key]);
}

function acceptanceCoverageUnitDigest(resolved) {
  return controlledContractContentDigest({
    selected_unit: controlledContractContentDigest(resolved.unit),
    bindings: resolved.bindings
  });
}

function acceptanceCoverageCriterionIdentities(resolved) {
  return deriveCriterionIdentitySet({
    criteria: resolved.criteria,
    selectedUnitDigest: acceptanceCoverageUnitDigest(resolved),
    bindings: resolved.bindings
  });
}

function acceptanceCoverageFactsFromRows(resolved, rows) {
  const normalizedRows = acceptanceCoverageRows(rows);
  const changedBindings = changedAcceptanceCoverageBindings(
    resolved.carrier?.content.source_bindings, resolved.bindings
  );
  const stale = changedBindings.length > 0;
  const unitDigest = acceptanceCoverageUnitDigest(resolved);
  const currentIdentities = acceptanceCoverageCriterionIdentities(resolved).identities;
  const rowByCriterion = new Map(normalizedRows.map((row) => [
    row.criterion_identity, row
  ]));
  return {
    unit: {
      id: resolved.selectedUnit === null
        ? resolved.wkId : `${resolved.wkId}#${resolved.selectedUnit}`,
      kind: resolved.selectedUnit === null ? "wk" : "slice",
      digest: unitDigest
    },
    criteria: structuredClone(resolved.criteria),
    bindings: structuredClone(resolved.bindings),
    ...(resolved.carrier?.content.criterion_identities === undefined
      ? {}
      : { priorCriterionIdentities: structuredClone(
          resolved.carrier.content.criterion_identities) }),
    mappings: normalizedRows.map(({ criterion_identity, node_ids }) => ({
      criterionIdentity: criterion_identity,
      nodeIds: structuredClone(node_ids)
    })),
    contractNodes: structuredClone(resolved.contractNodes),
    selectedPackNodeIds: structuredClone(resolved.selectedPackNodeIds),
    criterionAxes: currentIdentities.map(({ identity }) => {
      const axes = rowByCriterion.get(identity)?.axes;
      return {
        criterionIdentity: identity,
        structuralVerification: stale ? "stale" : axes?.structural_verification ?? "unknown",
        implementationOwnership: stale ? "stale" : axes?.implementation_ownership ?? "unknown",
        verificationOwnership: stale ? "stale" : axes?.verification_ownership ?? "unknown",
        scopeFeasibility: stale ? "stale" : axes?.scope_feasibility ?? "unknown"
      };
    }),
    ...(resolved.scope_facts === undefined ? {} : { scopeFacts: resolved.scope_facts }),
    proofCoverage: stale
      ? structuredClone((resolved.proof_coverage ?? []).map((fact) => ({
          ...fact, state: "stale"
        })))
      : structuredClone(resolved.proof_coverage ?? []),
    resultFacts: structuredClone(resolved.result_facts ?? null)
  };
}

function acceptanceCoverageCarrierContent(input, resolved, rows, criterionIdentities) {
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

function acceptanceCoverageCarrierIdentity(resolved) {
  return Object.freeze({
    carrier_kind: "controlled-acceptance",
    wk_id: resolved.wkId,
    focus: resolved.focus,
    selected_unit: resolved.selectedUnit,
    content_digest: resolved.carrier?.content_digest ?? null
  });
}

function acceptanceCoverageAuthoringIdentity(resolved) {
  return controlledContractContentDigest({
    unit_digest: acceptanceCoverageUnitDigest(resolved),
    source_identity: {
      source_kind: resolved.source.source_kind,
      content_digest: resolved.source.content_digest
    }
  });
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
  const sourceFile = acceptanceCoverageSourcePath(
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
  }, async () => withOrderedCoverageLocks(
    [`${sourceFile}.lock`, `${file}.lock`],
    "acceptance_coverage_persistence_busy",
    async () => {
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
    }
  ));
}

async function mutateControlledContractAcceptanceCoverage(input, {
  create,
  rowsFromResolved,
  resolveFacts = resolveAcceptanceCoverageFacts,
  persistCarrier = persistAcceptanceCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
}) {
  const resolutionInput = acceptanceCoverageResolutionInput(input);
  const resolved = await resolveFacts(resolutionInput, { requireCarrier: !create });
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
  const content = acceptanceCoverageCarrierContent(
    input, resolved, rows, state.criterion_identities
  );
  const bytes = acceptanceCoverageCarrierBytes(content);
  if (create) assertCompleteAcceptanceCoveragePopulation(rows, resolved);
  const prospectiveDigest = controlledContractContentDigest(content);
  if (!create && resolved.carrier.content_digest === prospectiveDigest) {
    return Object.freeze({
      carrier_kind: "controlled-acceptance",
      content_digest: prospectiveDigest,
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
  const immediatelyCurrent = await resolveFacts(resolutionInput, { requireCarrier: !create });
  if (input.expectedUnitDigest !== undefined) assertAcceptanceCoverageUnitCurrent(
    input.expectedUnitDigest, immediatelyCurrent, "final_compare"
  );
  assertAcceptanceCoverageSnapshotCurrent(resolved, immediatelyCurrent);
  const receipt = await persistCarrier({
    input, content, bytes, expectedSnapshot: immediatelyCurrent, resolveFacts,
    withSourceLease
  });
  const persisted = await readAcceptanceCoverageCarrier(input);
  if (receipt?.changed !== true || receipt.content_digest !== prospectiveDigest ||
      persisted?.content_digest !== prospectiveDigest) {
    throw new ControlledContractToolError(
      "acceptance_coverage_persistence_receipt_mismatch",
      "mutation did not persist the exact canonical carrier",
      { changed: false, expected_content_digest: prospectiveDigest,
        actual_content_digest: persisted?.content_digest ?? null }
    );
  }
  return Object.freeze({
    carrier_kind: "controlled-acceptance",
    content_digest: prospectiveDigest,
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
    const supportedNextCalls = absent
      ? ["workspace_controlled_contract_acceptance_coverage_create",
          "workspace_controlled_contract_acceptance_coverage_describe"]
      : changedBindings.length === 0
        ? ["workspace_controlled_contract_acceptance_coverage_query",
            "workspace_controlled_contract_acceptance_coverage_upsert",
            "workspace_controlled_contract_acceptance_coverage_remove",
            "workspace_controlled_contract_acceptance_coverage_describe"]
        : ["workspace_controlled_contract_acceptance_coverage_query",
            "workspace_controlled_contract_acceptance_coverage_rebase",
            "workspace_controlled_contract_acceptance_coverage_describe"];
    const semanticNextCalls = acceptanceCoverageDescribeCalls({
      resolved,
      carrierIdentity,
      sourceIdentity,
      unitDigest,
      changedBindings
    });
    const nextCalls = changedBindings.length === 0 ? semanticNextCalls
      : Object.freeze([...semanticNextCalls,
          coverageFamilyContinuationCalls(resolved, "acceptance", "describe")[0]]);
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
        nodes: resolved.contractNodes },
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

const ACCEPTANCE_COVERAGE_OPERATION_CURSOR_VERSION =
  "wiki-core-acceptance-coverage-operation-cursor.v1";
const ACCEPTANCE_COVERAGE_PROJECTION_CURSOR_VERSION =
  "acceptance-coverage-projection-cursor.v1";

function validateAcceptanceCoverageProjectionCursor(cursor) {
  try {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      throw new Error("embedded projection cursor encoding is invalid");
    }
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) {
      throw new Error("embedded projection cursor encoding is not canonical base64url");
    }
    const value = JSON.parse(decoded.toString("utf8"));
    const keys = [
      "version", "criterion_identity_digest", "projection_digest", "selector",
      "offset"
    ];
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(value, key)) ||
        Object.keys(value).some((key) => !keys.includes(key)) ||
        value.version !== ACCEPTANCE_COVERAGE_PROJECTION_CURSOR_VERSION ||
        !/^[0-9a-f]{64}$/u.test(value.criterion_identity_digest) ||
        !/^[0-9a-f]{64}$/u.test(value.projection_digest) ||
        !Number.isSafeInteger(value.offset) || value.offset < 0) {
      throw new Error("embedded projection cursor fields are invalid");
    }
    if (value.selector !== null) {
      const selectorKeys = ["criterion_identity", "node_id"];
      if (typeof value.selector !== "object" || Array.isArray(value.selector) ||
          Object.keys(value.selector).length !== 1 ||
          Object.keys(value.selector).some((key) => !selectorKeys.includes(key)) ||
          typeof value.selector[Object.keys(value.selector)[0]] !== "string" ||
          value.selector[Object.keys(value.selector)[0]].length === 0) {
        throw new Error("embedded projection cursor selector is invalid");
      }
    }
    return cursor;
  } catch (error) {
    throw new ControlledContractToolError(
      "acceptance_coverage_cursor_invalid",
      "continuation contains an invalid package projection cursor",
      { changed: false, cause: error.message }
    );
  }
}

function decodeAcceptanceCoverageOperationCursor(cursor, joinedDigest) {
  if (cursor === undefined) return undefined;
  try {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      throw new Error("continuation encoding is invalid");
    }
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) {
      throw new Error("continuation encoding is not canonical base64url");
    }
    const value = JSON.parse(decoded.toString("utf8"));
    if (value?.version === ACCEPTANCE_COVERAGE_PROJECTION_CURSOR_VERSION) {
      throw new ControlledContractToolError(
        "acceptance_coverage_cursor_wrong_layer",
        "package projection continuation cannot be used at the public operation layer",
        { changed: false }
      );
    }
    const keys = ["version", "joined_source_digest", "projection_cursor"];
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(value, key)) ||
        Object.keys(value).some((key) => !keys.includes(key))) {
      throw new Error("continuation fields are invalid");
    }
    if (value.version !== ACCEPTANCE_COVERAGE_OPERATION_CURSOR_VERSION ||
        typeof value.joined_source_digest !== "string" ||
        typeof value.projection_cursor !== "string" ||
        value.projection_cursor.length === 0) throw new Error(
      "continuation identity is invalid"
    );
    if (value.joined_source_digest !== joinedDigest) {
      throw new ControlledContractToolError(
        "acceptance_coverage_cursor_stale",
        "continuation belongs to different joined canonical sources"
      );
    }
    return validateAcceptanceCoverageProjectionCursor(value.projection_cursor);
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    throw new ControlledContractToolError(
      "acceptance_coverage_cursor_invalid", "continuation is malformed",
      { cause: error.message }
    );
  }
}

function encodeAcceptanceCoverageOperationCursor(projectionCursor, joinedDigest) {
  return Buffer.from(JSON.stringify({
    version: ACCEPTANCE_COVERAGE_OPERATION_CURSOR_VERSION,
    joined_source_digest: joinedDigest,
    projection_cursor: projectionCursor
  }), "utf8").toString("base64url");
}

function publicAcceptanceCoverageSelector(selector) {
  if (selector === undefined) return undefined;
  if (Object.hasOwn(selector, "criterionIdentity")) return Object.freeze({
    kind: "criterion_identity",
    criterion_identity: selector.criterionIdentity
  });
  return Object.freeze({ kind: "contract_node", node_id: selector.nodeId });
}

function projectPublicAcceptanceCoverage(input) {
  try {
    return projectAcceptanceCoverage(input);
  } catch (error) {
    if (error?.code === "acceptance_coverage_projection_cursor_stale") {
      throw new ControlledContractToolError(
        "acceptance_coverage_cursor_invalid",
        "continuation contains tampered package projection currentness",
        { changed: false, cause: error.message }
      );
    }
    if (error?.code !== "acceptance_coverage_projection_cursor_invalid") throw error;
    if (error.message === "cursor offset is outside the selected population") {
      throw new ControlledContractToolError(
        "acceptance_coverage_cursor_exhausted",
        "continuation offset is at or beyond the current selected population",
        { changed: false }
      );
    }
    throw new ControlledContractToolError(
      "acceptance_coverage_cursor_invalid",
      "continuation contains an invalid package projection cursor",
      { changed: false, cause: error.message }
    );
  }
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
    const continuation = publicContinuation === null
      ? []
      : [{
          tool: "workspace_controlled_contract_acceptance_coverage_query",
          arguments: {
            unit: input.selectedUnit === undefined || input.selectedUnit === null
              ? input.wkId : `${input.wkId}#${input.selectedUnit}`,
            ...(input.focus === undefined || input.focus === null
              ? {} : { focus: input.focus }),
            ...(normalizedSelector === undefined
              ? {} : { selector: normalizedSelector }),
            cursor: publicContinuation
          }
        }];
    const allItems = projection.selector === null
      ? projection.totals.gaps
      : projection.totals.criteria + projection.unmapped_mandatory_node_ids.length;
    const nextOffset = projection.page.offset + projection.page.returned;
    return Object.freeze({
      ...projection,
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

const OBLIGATION_COVERAGE_NON_AUTHORITY = Object.freeze({
  authoritative: false,
  authors_obligations_only: true,
  grants: Object.freeze([]),
  denies: Object.freeze([
    "proof", "requirement", "admission", "dispatch", "review", "integration",
    "publication", "completion"
  ])
});

const OBLIGATION_COVERAGE_CARRIER_VERSION =
  "controlled-contract-obligation-coverage.v1";
const OBLIGATION_COVERAGE_PAGE_SIZE = 25;

function obligationCoverageOperationInput(input, fields) {
  return assertControlledContractOperationInput(input, [
    "repoRoot", "wkId", "focus", "selectedUnit", ...fields
  ]);
}

function obligationCoverageResolutionInput(input) {
  return {
    repoRoot: input.repoRoot,
    wkId: input.wkId,
    focus: input.focus ?? null,
    selectedUnit: input.selectedUnit ?? null
  };
}

async function controlledObligationCoverageOperation(callback) {
  return controlledContractOperation(async () => {
    try {
      return await callback();
    } catch (error) {
      if (error !== null && (typeof error === "object" || typeof error === "function")) {
        const details = error.details !== null && typeof error.details === "object" &&
          !Array.isArray(error.details) ? error.details : {};
        error.details = {
          ...structuredClone(details),
          authority: OBLIGATION_COVERAGE_NON_AUTHORITY
        };
      }
      throw error;
    }
  });
}

export async function refuseMalformedControlledContractObligationCoverageRequest({
  operation,
  issueCount,
  issues
}) {
  return controlledObligationCoverageOperation(async () => {
    throw new ControlledContractToolError(
      "obligation_coverage_request_invalid",
      "obligation-coverage request failed its closed public schema",
      {
        changed: false,
        phase: "request",
        operation,
        issue_count: issueCount,
        issues: structuredClone(issues)
      }
    );
  });
}

function obligationCoverageUnitAddress(resolved) {
  return resolved.selectedUnit === null
    ? resolved.wkId : `${resolved.wkId}#${resolved.selectedUnit}`;
}

function obligationCoverageSourceIdentity(resolved) {
  return Object.freeze({
    ...resolved.prospectiveIdentity,
    content_digest: resolved.source?.content_digest ?? null
  });
}

function obligationCoverageCriterion(selector, resolved, name = "criterionSelector") {
  exactObject(selector, ["kind", "criterion_identity"], name);
  if (selector.kind !== "criterion_identity" ||
      typeof selector.criterion_identity !== "string") {
    throw new ControlledContractToolError(
      "obligation_coverage_criterion_selector_invalid",
      "criterion selector must be one describe-emitted criterion identity",
      { changed: false, selector_kind: selector?.kind ?? null,
        next_calls: coverageSelectorRecovery({ family: "obligation", input: resolved }) }
    );
  }
  const criterion = resolved.criteria.find(
    ({ identity }) => identity === selector.criterion_identity
  );
  if (!criterion) throw new ControlledContractToolError(
    "obligation_coverage_criterion_selector_invalid",
    "criterion selector does not identify a current selected-unit criterion",
    { changed: false, selector_kind: selector.kind,
      next_calls: coverageSelectorRecovery({ family: "obligation", input: resolved }) }
  );
  return criterion;
}

function obligationCoverageMutationSelector(selector, recoveryInput) {
  exactObject(selector, ["kind", "obligation_id"], "obligationSelector");
  if (selector.kind !== "obligation_id" ||
      typeof selector.obligation_id !== "string" ||
      !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/u.test(selector.obligation_id)) {
    throw new ControlledContractToolError(
      "obligation_coverage_obligation_selector_invalid",
      "mutation selector must identify one stable obligation ID",
      { changed: false, selector_kind: selector?.kind ?? null,
        next_calls: coverageSelectorRecovery({
          family: "obligation", input: recoveryInput
        }) }
    );
  }
  return selector.obligation_id;
}

function obligationCoverageMechanism(mechanism, pkg, name) {
  exactObject(mechanism, ["owner", "kind", "selector"], name);
  if (typeof mechanism.owner !== "string" || mechanism.owner.length === 0 ||
      !pkg.OBLIGATION_COVERAGE_MECHANISM_KINDS.includes(mechanism.kind) ||
      typeof mechanism.selector !== "string" || mechanism.selector.length === 0) {
    throw new ControlledContractToolError(
      "obligation_coverage_mechanism_invalid",
      `${name} must use the package-owned typed mechanism vocabulary`,
      { changed: false }
    );
  }
  return structuredClone(mechanism);
}

function obligationCoverageProof(proof, resolved, pkg, name) {
  if (proof?.kind === "explicit_gap") {
    exactObject(proof, ["kind", "gap_kind", "reason"], name);
    if (!pkg.OBLIGATION_COVERAGE_GAP_KINDS.includes(proof.gap_kind) ||
        typeof proof.reason !== "string" || proof.reason.length === 0) {
      throw new ControlledContractToolError(
        "obligation_coverage_gap_invalid",
        `${name} must use the package-owned explicit-gap vocabulary`,
        { changed: false }
      );
    }
    return structuredClone(proof);
  }
  exactObject(proof, ["kind", "requested_intent", "selector", "evaluation_stage"], name);
  exactObject(proof.selector, ["kind", "component_id"], `${name}.selector`);
  if (proof.kind !== "pack_mapping" ||
      typeof proof.requested_intent !== "string" ||
      typeof proof.selector.kind !== "string" ||
      typeof proof.selector.component_id !== "string" ||
      !["pre_dispatch", "post_delivery"].includes(proof.evaluation_stage)) {
    throw new ControlledContractToolError(
      "obligation_coverage_pack_mapping_invalid",
      `${name} must select one exact server-admitted pack component`,
      { changed: false }
    );
  }
  const matches = resolved.selectedPacks.filter((pack) =>
    pack.requested_intents.includes(proof.requested_intent) &&
    pack.selectors.some((selector) =>
      selector.kind === proof.selector.kind &&
      selector.component_id === proof.selector.component_id &&
      selector.evaluation_stage === proof.evaluation_stage
    ));
  if (matches.length !== 1) throw new ControlledContractToolError(
    "obligation_coverage_pack_mapping_invalid",
    "pack mapping does not resolve to exactly one selected proof-plan pack",
    { changed: false, matching_pack_count: matches.length }
  );
  const [pack] = matches;
  return {
    kind: "pack_mapping",
    pack_id: pack.pack_id,
    requested_intent: proof.requested_intent,
    profile_id: pack.profile_id,
    profile_version: pack.profile_version,
    selector: structuredClone(proof.selector),
    evaluation_stage: proof.evaluation_stage
  };
}

async function materializeObligationCoverageRow(row, resolved, name = "row") {
  exactObject(row, [
    "obligation_id", "statement", "criterion_selector",
    "controlled_contract_node_ids", "mechanism", "proof"
  ], name);
  if (typeof row.obligation_id !== "string" ||
      !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/u.test(row.obligation_id)) {
    throw new ControlledContractToolError(
      "obligation_coverage_obligation_id_invalid",
      `${name}.obligation_id must be a stable obligation identity`,
      { changed: false }
    );
  }
  if (typeof row.statement !== "string" || row.statement.length === 0 ||
      row.statement !== row.statement.trim() || /[\r\n]/u.test(row.statement)) {
    throw new ControlledContractToolError(
      "obligation_coverage_statement_not_atomic",
      `${name}.statement must be one trimmed atomic statement`,
      { changed: false, obligation_id: row.obligation_id }
    );
  }
  const criterion = obligationCoverageCriterion(
    row.criterion_selector, resolved, `${name}.criterion_selector`
  );
  if (!Array.isArray(row.controlled_contract_node_ids) ||
      row.controlled_contract_node_ids.length === 0 ||
      new Set(row.controlled_contract_node_ids).size !==
        row.controlled_contract_node_ids.length ||
      row.controlled_contract_node_ids.some((id) =>
        typeof id !== "string" ||
        !resolved.contractNodes.some((node) => node.id === id))) {
    throw new ControlledContractToolError(
      "obligation_coverage_contract_node_invalid",
      `${name}.controlled_contract_node_ids must be exact current contract nodes`,
      { changed: false, obligation_id: row.obligation_id }
    );
  }
  const pkg = await loadControlledContractPackage();
  const sourceLocatorDigest = obligationCoverageSourceLocatorDigest({
    criterion: criterion.criterion,
    criterionIdentity: criterion.identity,
    criterionSetDigest: resolved.criterionIdentities.digest,
    obligationId: row.obligation_id,
    sourceLocator: criterion.source_locator,
    statement: row.statement
  });
  return {
    obligation_id: row.obligation_id,
    source_locator: criterion.source_locator,
    source_locator_digest: sourceLocatorDigest,
    statement: row.statement,
    controlled_contract_node_ids: structuredClone(row.controlled_contract_node_ids),
    mechanism: obligationCoverageMechanism(row.mechanism, pkg, `${name}.mechanism`),
    proof: obligationCoverageProof(row.proof, resolved, pkg, `${name}.proof`)
  };
}

function obligationCoverageCarrierContent(resolved, rows) {
  return {
    schema_version: OBLIGATION_COVERAGE_CARRIER_VERSION,
    wk_id: resolved.wkId,
    focus: resolved.selectedUnit,
    obligations: structuredClone(rows).sort((left, right) =>
      left.obligation_id.localeCompare(right.obligation_id, "en", { sensitivity: "case" })
    )
  };
}

async function validateObligationCoverageContent(resolved, rows) {
  if (rows.length > OBLIGATION_COVERAGE_MAX_ROWS) throw new ControlledContractToolError(
    "obligation_coverage_carrier_oversize",
    "obligation-coverage source exceeds its complete-authoring bounds",
    { changed: false, bound: "rows", maximum_rows: OBLIGATION_COVERAGE_MAX_ROWS,
      maximum_bytes: OBLIGATION_COVERAGE_MAX_BYTES, row_count: rows.length,
      byte_length: null }
  );
  const coveredLocators = new Set(rows.map(({ source_locator: locator }) => locator));
  const missingLocators = resolved.criteria.map(({ source_locator: locator }) => locator)
    .filter((locator) => !coveredLocators.has(locator));
  if (missingLocators.length > 0) throw new ControlledContractToolError(
    "obligation_coverage_population_incomplete",
    "every selected-unit criterion requires at least one authored obligation",
    { changed: false, missing_criterion_count: missingLocators.length }
  );
  const content = obligationCoverageCarrierContent(resolved, rows);
  const pkg = await loadControlledContractPackage();
  const validation = pkg.validateObligationCoverageCarrier(content);
  if (!validation.valid) {
    const diagnostic = validation.diagnostics[0];
    throw new ControlledContractToolError(
      diagnostic?.code ?? "obligation_coverage_row_invalid",
      "authored rows do not form one valid canonical obligation source",
      { changed: false, schema_errors: validation.schema_errors,
        diagnostics: validation.diagnostics }
    );
  }
  const bytes = Buffer.from(`${JSON.stringify(validation.carrier, null, 2)}\n`, "utf8");
  if (bytes.byteLength > OBLIGATION_COVERAGE_MAX_BYTES) {
    throw new ControlledContractToolError(
      "obligation_coverage_carrier_oversize",
      "obligation-coverage source exceeds its complete-authoring bounds",
      { changed: false, bound: "bytes", maximum_rows: OBLIGATION_COVERAGE_MAX_ROWS,
        maximum_bytes: OBLIGATION_COVERAGE_MAX_BYTES, row_count: rows.length,
        byte_length: bytes.byteLength }
    );
  }
  return Object.freeze({ content: validation.carrier, bytes });
}

function assertObligationCoverageAdmission(input, resolved, { create }) {
  if (create) {
    if (input.expectedContentDigest !== null) throw new ControlledContractToolError(
      "obligation_coverage_expected_absence_required",
      "create requires expected_content_digest null", { changed: false, phase: "admission" }
    );
    if (resolved.source !== null) throw new ControlledContractToolError(
      "obligation_coverage_expected_absence_mismatch",
      "canonical obligation source is already present", { changed: false, phase: "admission",
        actual_content_digest: resolved.source.content_digest }
    );
    if (input.expectedAuthoringIdentity !== resolved.authoringIdentity) {
      throw new ControlledContractToolError(
        "obligation_coverage_admission_stale",
        "describe-emitted authoring identity is stale",
        { changed: false, phase: "admission",
          expected_authoring_identity: input.expectedAuthoringIdentity,
          actual_authoring_identity: resolved.authoringIdentity }
      );
    }
    return;
  }
  if (resolved.source === null) throw new ControlledContractToolError(
    "obligation_coverage_source_not_found", "canonical obligation source is absent",
    { changed: false, phase: "admission" }
  );
  if (input.expectedContentDigest !== resolved.source.content_digest) {
    throw new ControlledContractToolError(
      "obligation_coverage_content_digest_mismatch",
      "canonical obligation source content-digest CAS mismatched",
      { changed: false, phase: "admission",
        expected_content_digest: input.expectedContentDigest,
        actual_content_digest: resolved.source.content_digest }
    );
  }
  if (!resolved.sourceCurrent) throw new ControlledContractToolError(
    "obligation_coverage_currentness_stale",
    "canonical obligation source is stale against server-resolved facts",
    { changed: false, phase: "admission", changed_bindings: resolved.staleReasons }
  );
}

function obligationCoverageSnapshotIdentity(resolved) {
  return JSON.stringify({
    authoring_identity: resolved.authoringIdentity,
    source_content_digest: resolved.source?.content_digest ?? null,
    source_current: resolved.sourceCurrent,
    stale_reasons: resolved.staleReasons
  });
}

function assertObligationCoverageFinalCompare(expected, actual) {
  if (obligationCoverageSnapshotIdentity(expected) !==
      obligationCoverageSnapshotIdentity(actual)) {
    throw new ControlledContractToolError(
      "obligation_coverage_final_compare_stale",
      "a mutation-relevant canonical identity changed before persistence",
      { changed: false, phase: "final_compare" }
    );
  }
}

async function assertObligationCoverageTargetIntegrity(resolved, { requireSource }) {
  return (await assertObligationCoverageSourcePathIntegrity({
    repoRoot: resolved.repoRoot,
    wkId: resolved.wkId,
    focus: resolved.focus,
    selectedUnit: resolved.selectedUnit
  }, { requireSource })).file;
}

async function persistObligationCoverageCarrier({
  input,
  expectedSnapshot,
  content,
  bytes,
  write,
  resolveFacts = resolveObligationCoverageFacts,
  directorySync = false,
  classifyPostCommit = false,
  persistenceEffects = {},
  withSourceLease = withCanonicalControlledContractSourceLease
}) {
  const file = await assertObligationCoverageTargetIntegrity(expectedSnapshot, {
    requireSource: expectedSnapshot.source !== null
  });
  const temporaryFile = `${file}.tmp-${randomUUID()}`;
  let temporary;
  const openFile = persistenceEffects.openFile ?? open;
  const renameFile = persistenceEffects.renameFile ?? rename;
  const unlinkFile = persistenceEffects.unlinkFile ?? unlink;
  const readCurrent = () => readCanonicalObligationSource({
    ...obligationCoverageResolutionInput(input), repoRoot: expectedSnapshot.repoRoot
  });
  const readReceipt = persistenceEffects.readReceipt ?? readCurrent;
  const resolveCommitted = persistenceEffects.resolveCommitted ?? readCurrent;
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
  }, async () => withOrderedCoverageLocks(
    [`${file}.lock`],
    "obligation_coverage_persistence_busy",
    async () => {
      try {
    const finalSnapshot = await resolveFacts(
      obligationCoverageResolutionInput(input), { requireSource: expectedSnapshot.source !== null }
    );
    assertObligationCoverageFinalCompare(expectedSnapshot, finalSnapshot);
    await assertObligationCoverageTargetIntegrity(finalSnapshot, {
      requireSource: expectedSnapshot.source !== null
    });
    if (!write) {
      const unchangedSnapshot = await resolveFacts(
        obligationCoverageResolutionInput(input), { requireSource: true }
      );
      assertObligationCoverageFinalCompare(expectedSnapshot, unchangedSnapshot);
      await assertObligationCoverageTargetIntegrity(unchangedSnapshot, {
        requireSource: true
      });
      return Object.freeze({
        content_digest: controlledContractContentDigest(content),
        byte_length: bytes.byteLength,
        changed: false
      });
    }
    temporary = await openFile(temporaryFile, "wx", 0o644);
    await temporary.writeFile(bytes);
    await temporary.sync();
    await temporary.close();
    temporary = null;
    const renameSnapshot = await resolveFacts(
      obligationCoverageResolutionInput(input), { requireSource: expectedSnapshot.source !== null }
    );
    assertObligationCoverageFinalCompare(expectedSnapshot, renameSnapshot);
    await assertObligationCoverageTargetIntegrity(renameSnapshot, {
      requireSource: expectedSnapshot.source !== null
    });
    await renameFile(temporaryFile, file);
    const expectedDigest = controlledContractContentDigest(content);
    try {
      if (directorySync) await syncDirectory(file);
      const persisted = await readReceipt();
      if (persisted?.content_digest !== expectedDigest) throw new ControlledContractToolError(
        "obligation_coverage_persistence_receipt_mismatch",
        "persisted source does not identify the exact canonical content",
        { phase: "receipt", expected_content_digest: expectedDigest,
          actual_content_digest: persisted?.content_digest ?? null }
      );
    } catch (error) {
      if (!classifyPostCommit) throw error;
      let committed = false;
      try {
        committed = (await resolveCommitted())?.content_digest === expectedDigest;
      } catch {
        committed = false;
      }
      return Object.freeze({
        status: "post_commit_failure",
        commit_state: committed ? "committed" : "indeterminate",
        content_digest: expectedDigest,
        byte_length: bytes.byteLength,
        failure_code: error?.code ?? "obligation_coverage_post_commit_failure"
      });
    }
        return Object.freeze({ content_digest: expectedDigest,
          byte_length: bytes.byteLength, changed: true });
      } finally {
        if (temporary) await temporary.close();
        try { await unlinkFile(temporaryFile); } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }
  ));
}

async function mutateControlledContractObligationCoverage(input, {
  create,
  rowsFromResolved,
  resolveFacts = resolveObligationCoverageFacts,
  persistCarrier = persistObligationCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
}) {
  const resolutionInput = obligationCoverageResolutionInput(input);
  const resolved = await resolveFacts(resolutionInput, {
    requireSource: !create
  });
  assertObligationCoverageAdmission(input, resolved, { create });
  const rows = await rowsFromResolved(resolved);
  const { content, bytes } = await validateObligationCoverageContent(resolved, rows);
  const prospectiveDigest = controlledContractContentDigest(content);
  const write = create || prospectiveDigest !== resolved.source.content_digest;
  const immediatelyCurrent = await resolveFacts(resolutionInput, {
    requireSource: !create
  });
  assertObligationCoverageFinalCompare(resolved, immediatelyCurrent);
  const receipt = await persistCarrier({
    input, expectedSnapshot: immediatelyCurrent, content, bytes, write,
    resolveFacts, withSourceLease
  });
  return Object.freeze({
    schema_version: "controlled-contract-obligation-coverage-mutation.v1",
    source_kind: "obligation-coverage",
    content_digest: receipt.content_digest,
    row_count: content.obligations.length,
    byte_length: receipt.byte_length,
    changed: receipt.changed,
    next_calls: coverageFamilyContinuationCalls(input, "obligation"),
    authority: OBLIGATION_COVERAGE_NON_AUTHORITY
  });
}

export async function describeControlledContractObligationCoverageOperation(input, {
  resolveFacts = resolveObligationCoverageFacts
} = {}) {
  return controlledObligationCoverageOperation(async () => {
    obligationCoverageOperationInput(input, []);
    let resolved;
    try {
      resolved = await resolveFacts(
        obligationCoverageResolutionInput(input)
      );
    } catch (error) {
      return ownerProducedCoverageRecovery(input, error);
    }
    const absent = resolved.source === null;
    const status = absent ? "source_absent"
      : resolved.sourceCurrent ? "source_present_current" : "source_present_stale";
    const supportedNextCalls = absent
      ? ["workspace_controlled_contract_obligation_coverage_create",
          "workspace_controlled_contract_obligation_coverage_describe"]
      : resolved.sourceCurrent
        ? ["workspace_controlled_contract_obligation_coverage_query",
            "workspace_controlled_contract_obligation_coverage_upsert",
            "workspace_controlled_contract_obligation_coverage_remove",
            "workspace_controlled_contract_obligation_coverage_describe"]
        : ["workspace_controlled_contract_obligation_coverage_query",
            "workspace_controlled_contract_obligation_coverage_rebase",
            "workspace_controlled_contract_obligation_coverage_describe"];
    const semanticNextCalls = obligationCoverageDescribeCalls({
      resolved,
      sourceIdentity: obligationCoverageSourceIdentity(resolved)
    });
    const nextCalls = resolved.sourceCurrent || absent ? semanticNextCalls
      : Object.freeze([...semanticNextCalls,
          coverageFamilyContinuationCalls(resolved, "obligation", "describe")[0]]);
    const pkg = await loadControlledContractPackage();
    const composedAuthoringSkeleton = composeControlledContractCoverageAuthoringSkeleton({
      surface: "obligation",
      unit: {
        address: obligationCoverageUnitAddress(resolved),
        selectedUnit: resolved.selectedUnit,
        focus: resolved.focus,
        digest: resolved.bindings.selectedUnitDigest
      },
      criterionIdentities: resolved.criterionIdentities.identities,
      contract: { contentDigest: resolved.contract.content_digest,
        nodes: resolved.contractNodes },
      proofPlan: { contentDigest: resolved.plan?.content_digest ?? null,
        selectedPacks: resolved.selectedPacks },
      carrier: { status, changedBindings: resolved.staleReasons },
      mutation: coverageAuthoringMutation(
        nextCalls, "obligation", absent, resolved
      ),
      obligation: {
        mechanisms: pkg.OBLIGATION_COVERAGE_MECHANISM_KINDS,
        gapAlternatives: pkg.OBLIGATION_COVERAGE_GAP_KINDS,
        expectedAuthoringIdentity: resolved.authoringIdentity,
        sourceIdentity: obligationCoverageSourceIdentity(resolved)
      }
    });
    const authoringSkeleton = status === "source_present_stale"
      ? Object.freeze(Object.fromEntries(Object.entries(composedAuthoringSkeleton).filter(
          ([key]) => key !== "mutation_handoff" && key !== "execution_handoff"
        )))
      : composedAuthoringSkeleton;
    return Object.freeze({
      schema_version: "controlled-contract-obligation-coverage-describe.v1",
      status,
      unit: Object.freeze({
        wk_id: resolved.wkId,
        controlled_focus: resolved.focus,
        selected_unit: resolved.selectedUnit,
        address: obligationCoverageUnitAddress(resolved),
        kind: resolved.selectedUnit === null ? "wk" : "slice",
        work_record_digest: resolved.bindings.workRecordDigest,
        selected_unit_digest: resolved.bindings.selectedUnitDigest
      }),
      work_record: Object.freeze({
        id: resolved.wkId,
        locator: `wiki/work-records/${resolved.wkId}.json`,
        content_digest: resolved.bindings.workRecordDigest
      }),
      controlled_contract: Object.freeze({
        generation: resolved.canonicalSet.generation,
        manifest_content_digest: resolved.canonicalSet.manifest_content_digest ?? null,
        content_digest: resolved.contract.content_digest,
        node_digest: resolved.bindings.contractNodeDigest,
        node_ids: Object.freeze(resolved.contractNodes.map(({ id }) => id))
      }),
      proof_plan: Object.freeze({
        generation: resolved.canonicalSet.generation,
        content_digest: resolved.plan?.content_digest ?? null,
        selected_pack_digest: resolved.bindings.selectedPackDigest,
        selected_packs: Object.freeze(structuredClone(resolved.selectedPacks))
      }),
      criterion_identities: resolved.criterionIdentities,
      source_locator: resolved.sourceLocator,
      source_identity: obligationCoverageSourceIdentity(resolved),
      prospective_carrier: Object.freeze({
        schema_version: OBLIGATION_COVERAGE_CARRIER_VERSION,
        wk_id: resolved.wkId,
        focus: resolved.selectedUnit,
        expected_content_digest: absent ? null : resolved.source.content_digest
      }),
      expected_absence: Object.freeze({ proven: absent, expected_content_digest: null }),
      authoring_identity: resolved.authoringIdentity,
      currentness: Object.freeze({ current: resolved.sourceCurrent,
        changed_bindings: resolved.staleReasons }),
      write_scope: Object.freeze({
        root: "wiki/contracts",
        target_locator_digest: resolved.sourceLocator.digest,
        containment: "server_resolved_exact_target"
      }),
      bounds: Object.freeze({ maximum_rows: OBLIGATION_COVERAGE_MAX_ROWS,
        maximum_bytes: OBLIGATION_COVERAGE_MAX_BYTES }),
      authoring_applicability: resolved.authoringApplicability,
      authoring_skeleton: authoringSkeleton,
      supported_next_calls: Object.freeze(supportedNextCalls),
      next_calls: nextCalls,
      authority: OBLIGATION_COVERAGE_NON_AUTHORITY
    });
  });
}

export async function createControlledContractObligationCoverageOperation(input, {
  resolveFacts = resolveObligationCoverageFacts,
  persistCarrier = persistObligationCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
} = {}) {
  return controlledObligationCoverageOperation(async () => {
    obligationCoverageOperationInput(input, [
      "expectedAuthoringIdentity", "expectedContentDigest", "rows"
    ]);
    if (typeof input.expectedAuthoringIdentity !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(input.expectedAuthoringIdentity) ||
        !Array.isArray(input.rows)) {
      throw new ControlledContractToolError(
        "obligation_coverage_request_invalid",
        "create requires one describe-emitted identity and complete authored rows",
        { changed: false }
      );
    }
    if (input.rows.length > OBLIGATION_COVERAGE_MAX_ROWS) {
      throw new ControlledContractToolError(
        "obligation_coverage_carrier_oversize",
        "obligation-coverage source exceeds its independent row ceiling",
        { changed: false, bound: "rows",
          maximum_rows: OBLIGATION_COVERAGE_MAX_ROWS,
          maximum_bytes: OBLIGATION_COVERAGE_MAX_BYTES,
          row_count: input.rows.length, byte_length: null }
      );
    }
    return mutateControlledContractObligationCoverage(input, {
      create: true,
      rowsFromResolved: async (resolved) => Promise.all(input.rows.map(
        (row, index) => materializeObligationCoverageRow(row, resolved, `rows[${index}]`)
      )),
      resolveFacts,
      persistCarrier,
      withSourceLease
    });
  });
}

export async function upsertControlledContractObligationCoverageOperation(input, {
  resolveFacts = resolveObligationCoverageFacts,
  persistCarrier = persistObligationCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
} = {}) {
  return controlledObligationCoverageOperation(async () => {
    obligationCoverageOperationInput(input, [
      "expectedContentDigest", "obligationSelector", "row"
    ]);
    const selectedId = obligationCoverageMutationSelector(
      input.obligationSelector, input);
    return mutateControlledContractObligationCoverage(input, {
      create: false,
      rowsFromResolved: async (resolved) => {
        const materialized = await materializeObligationCoverageRow(input.row, resolved);
        if (materialized.obligation_id !== selectedId) throw new ControlledContractToolError(
          "obligation_coverage_obligation_selector_invalid",
          "upsert row must match its typed obligation selector",
          { changed: false,
            next_calls: coverageSelectorRecovery({
              family: "obligation", input: resolved
            }) }
        );
        const rows = structuredClone(resolved.rows);
        const index = rows.findIndex(({ obligation_id: id }) => id === selectedId);
        if (index === -1) rows.push(materialized);
        else rows[index] = materialized;
        return rows;
      },
      resolveFacts,
      persistCarrier,
      withSourceLease
    });
  });
}

export async function removeControlledContractObligationCoverageOperation(input, {
  resolveFacts = resolveObligationCoverageFacts,
  persistCarrier = persistObligationCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
} = {}) {
  return controlledObligationCoverageOperation(async () => {
    obligationCoverageOperationInput(input, [
      "expectedContentDigest", "obligationSelector"
    ]);
    const selectedId = obligationCoverageMutationSelector(
      input.obligationSelector, input);
    return mutateControlledContractObligationCoverage(input, {
      create: false,
      rowsFromResolved: async (resolved) => {
        if (!resolved.rows.some(({ obligation_id: id }) => id === selectedId)) {
          throw new ControlledContractToolError(
            "obligation_coverage_obligation_selector_not_found",
            "remove selector does not identify a current obligation",
            { changed: false, obligation_id: selectedId,
              next_calls: coverageSelectorRecovery({
                family: "obligation", input: resolved
              }) }
          );
        }
        return resolved.rows.filter(({ obligation_id: id }) => id !== selectedId);
      },
      resolveFacts,
      persistCarrier,
      withSourceLease
    });
  });
}

async function obligationCoveragePatchOperations(operations, resolved) {
  if (!Array.isArray(operations)) return operations;
  return Promise.all(operations.map(async (operation, index) => {
    const name = `operations[${index}]`;
    if (operation?.op === "upsert") {
      exactObject(operation, ["op", "obligationSelector", "row"], name);
      const selectedId = obligationCoverageMutationSelector(
        operation.obligationSelector, resolved
      );
      const row = await materializeObligationCoverageRow(
        operation.row, resolved, `${name}.row`
      );
      if (row.obligation_id !== selectedId) throw new ControlledContractToolError(
        "obligation_coverage_obligation_selector_invalid",
        "patch upsert row does not match its typed obligation selector",
        { changed: false, operation_index: index }
      );
      return { op: "upsert", target: "obligations", id: selectedId, value: row };
    }
    exactObject(operation, ["op", "obligationSelector"], name);
    if (operation.op !== "remove") throw new ControlledContractToolError(
      "controlled_contract_patch_operation_invalid",
      "patch operation must be one typed upsert or remove variant",
      { changed: false, operation_index: index }
    );
    return { op: "remove", target: "obligations",
      id: obligationCoverageMutationSelector(operation.obligationSelector, resolved) };
  }));
}

function assertObligationCoveragePatchAdmission(input, resolved) {
  if (resolved.source === null) throw new ControlledContractToolError(
    "obligation_coverage_source_not_found",
    "patch requires one present canonical obligation source", { changed: false }
  );
  if (!resolved.sourceCurrent) throw new ControlledContractToolError(
    "obligation_coverage_currentness_stale",
    "patch cannot author a stale obligation source",
    { changed: false, changed_bindings: resolved.staleReasons }
  );
  const currentIdentity = obligationCoverageSourceIdentity(resolved);
  exactObject(input.sourceIdentity, Object.keys(currentIdentity), "sourceIdentity");
  const withoutDigest = (identity) => Object.fromEntries(
    Object.entries(identity).filter(([key]) => key !== "content_digest")
  );
  if (JSON.stringify(withoutDigest(input.sourceIdentity)) !==
      JSON.stringify(withoutDigest(currentIdentity))) {
    throw new ControlledContractToolError(
      "obligation_coverage_source_identity_mismatch",
      "patch source identity does not select the resolved canonical source",
      { changed: false }
    );
  }
  if (input.sourceIdentity.content_digest !== input.expectedContentDigest) {
    throw new ControlledContractToolError(
      "obligation_coverage_content_digest_mismatch",
      "patch source and expected content digests disagree", { changed: false }
    );
  }
  if (input.expectedAuthoringIdentity !== resolved.authoringIdentity) {
    throw new ControlledContractToolError(
      "obligation_coverage_admission_stale",
      "describe-emitted patch authoring identity is stale", { changed: false }
    );
  }
}

export async function patchControlledContractObligationCoverageOperation(input, {
  resolveFacts = resolveObligationCoverageFacts,
  persistCarrier = persistObligationCoverageCarrier,
  persistenceEffects = {},
  withSourceLease = withCanonicalControlledContractSourceLease
} = {}) {
  return controlledObligationCoverageOperation(async () => {
    obligationCoverageOperationInput(input, [
      "sourceIdentity", "expectedAuthoringIdentity", "expectedContentDigest",
      "operations"
    ]);
    const resolutionInput = obligationCoverageResolutionInput(input);
    const resolved = await resolveFacts(resolutionInput, { requireSource: true });
    assertObligationCoveragePatchAdmission(input, resolved);
    const patch = applyCoverageFamilyPatch(
      "obligation_coverage", { obligations: structuredClone(resolved.rows) },
      await obligationCoveragePatchOperations(input.operations, resolved)
    );
    const { content, bytes } = await validateObligationCoverageContent(
      resolved, patch.content.obligations
    );
    const currentDigest = resolved.source.content_digest;
    const prospectiveDigest = controlledContractContentDigest(content);
    const staleRequest = input.expectedContentDigest !== currentDigest;
    if (staleRequest && prospectiveDigest !== currentDigest) {
      throw new ControlledContractToolError(
        "obligation_coverage_content_digest_mismatch",
        "stale patch would change the current canonical source",
        { changed: false, expected_content_digest: input.expectedContentDigest,
          actual_content_digest: currentDigest }
      );
    }
    const status = staleRequest ? "already_satisfied"
      : prospectiveDigest === currentDigest ? "no_change" : "updated";
    const immediatelyCurrent = await resolveFacts(resolutionInput, { requireSource: true });
    assertObligationCoverageFinalCompare(resolved, immediatelyCurrent);
    const receipt = await persistCarrier({
      input, expectedSnapshot: immediatelyCurrent, content, bytes,
      write: status === "updated", resolveFacts, directorySync: true,
      classifyPostCommit: true, persistenceEffects, withSourceLease
    });
    const sourceIdentity = Object.freeze({
      ...obligationCoverageSourceIdentity(resolved),
      content_digest: prospectiveDigest
    });
    const common = {
      schema_version: "controlled-contract-obligation-coverage-patch.v1",
      source_kind: "obligation-coverage",
      previous_content_digest: currentDigest,
      content_digest: prospectiveDigest,
      operation_count: patch.operation_count,
      upsert_count: patch.upsert_count,
      remove_count: patch.remove_count,
      final_row_count: content.obligations.length,
      byte_length: bytes.byteLength,
      source_identity: sourceIdentity,
      authority: OBLIGATION_COVERAGE_NON_AUTHORITY
    };
    if (receipt.status === "post_commit_failure") return Object.freeze({
      ...common,
      status: receipt.status,
      commit_state: receipt.commit_state,
      failure_code: receipt.failure_code,
      next_calls: coverageFamilyContinuationCalls(input, "obligation", "describe")
    });
    return Object.freeze({
      ...common,
      status,
      changed: status === "updated",
      next_calls: coverageFamilyContinuationCalls(input, "obligation")
    });
  });
}

const OBLIGATION_COVERAGE_OPERATION_CURSOR_VERSION =
  "wiki-core-obligation-coverage-operation-cursor.v1";

function obligationCoverageQuerySelector(selector, resolved) {
  if (selector === undefined) return null;
  if (selector?.kind === "obligation_id") {
    exactObject(selector, ["kind", "obligation_id"], "selector");
    return { kind: selector.kind,
      obligation_id: obligationCoverageMutationSelector(selector, resolved) };
  }
  if (selector?.kind === "criterion_identity") {
    const criterion = obligationCoverageCriterion(selector, resolved, "selector");
    return { kind: selector.kind, criterion_identity: criterion.identity,
      source_locator: criterion.source_locator };
  }
  if (selector?.kind === "contract_node") {
    exactObject(selector, ["kind", "node_id"], "selector");
    if (typeof selector.node_id === "string" && resolved.contractNodes.some(
      ({ id }) => id === selector.node_id)) return structuredClone(selector);
  } else if (selector?.kind === "mechanism") {
    exactObject(selector, ["kind", "mechanism"], "selector");
    const mechanism = selector.mechanism;
    exactObject(mechanism, ["owner", "kind", "selector"], "selector.mechanism");
    if (["owner", "kind", "selector"].every((key) =>
      typeof mechanism[key] === "string" && mechanism[key].length > 0)) {
      return structuredClone(selector);
    }
  } else if (selector?.kind === "proof_kind") {
    exactObject(selector, ["kind", "proof_kind"], "selector");
    if (["explicit_gap", "pack_mapping"].includes(selector.proof_kind)) {
      return structuredClone(selector);
    }
  }
  throw new ControlledContractToolError(
    "obligation_coverage_query_selector_invalid",
    "query selector is not one current typed obligation selector",
    { changed: false, selector_kind: selector?.kind ?? null,
      next_calls: coverageSelectorRecovery({ family: "obligation", input: resolved }) }
  );
}

function obligationCoverageQueryMatches(row, selector) {
  if (selector === null) return true;
  if (selector.kind === "obligation_id") return row.obligation_id === selector.obligation_id;
  if (selector.kind === "criterion_identity") {
    return row.source_locator === selector.source_locator;
  }
  if (selector.kind === "contract_node") {
    return row.controlled_contract_node_ids.includes(selector.node_id);
  }
  if (selector.kind === "proof_kind") return row.proof.kind === selector.proof_kind;
  return ["owner", "kind", "selector"].every(
    (key) => row.mechanism[key] === selector.mechanism[key]
  );
}

function obligationCoverageProjectionCursor(selector, offset) {
  return Buffer.from(JSON.stringify({ selector, offset }), "utf8").toString("base64url");
}

function decodeObligationCoverageProjectionCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    exactObject(value, ["selector", "offset"], "obligation coverage projection cursor");
    if (!Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error(
      "cursor offset is invalid"
    );
    return value;
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    throw new ControlledContractToolError(
      "obligation_coverage_cursor_invalid", "continuation is malformed",
      { changed: false, cause: error.message }
    );
  }
}

function encodeObligationCoverageOperationCursor(projectionCursor, joinedDigest) {
  return Buffer.from(JSON.stringify({
    version: OBLIGATION_COVERAGE_OPERATION_CURSOR_VERSION,
    joined_source_digest: joinedDigest,
    projection_cursor: projectionCursor
  }), "utf8").toString("base64url");
}

function decodeObligationCoverageOperationCursor(cursor, joinedDigest) {
  if (cursor === undefined) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    exactObject(value, ["version", "joined_source_digest", "projection_cursor"],
      "obligation coverage continuation");
    if (value.version !== OBLIGATION_COVERAGE_OPERATION_CURSOR_VERSION ||
        typeof value.projection_cursor !== "string") throw new Error(
      "continuation identity is invalid"
    );
    if (value.joined_source_digest !== joinedDigest) throw new ControlledContractToolError(
      "obligation_coverage_cursor_stale",
      "continuation belongs to different joined canonical sources",
      { changed: false }
    );
    return decodeObligationCoverageProjectionCursor(value.projection_cursor);
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    throw new ControlledContractToolError(
      "obligation_coverage_cursor_invalid", "continuation is malformed",
      { changed: false, cause: error.message }
    );
  }
}

export async function queryControlledContractObligationCoverageOperation(input) {
  return controlledObligationCoverageOperation(async () => {
    obligationCoverageOperationInput(input, ["selector", "cursor"]);
    if (input.selector !== undefined && input.cursor !== undefined) {
      throw new ControlledContractToolError(
        "obligation_coverage_query_selector_invalid",
        "query accepts a typed selector or continuation, not both",
        { changed: false }
      );
    }
    const resolved = await resolveObligationCoverageFacts(
      obligationCoverageResolutionInput(input), { requireSource: true }
    );
    const joinedDigest = controlledContractContentDigest({
      authoring_identity: resolved.authoringIdentity,
      source_content_digest: resolved.source.content_digest,
      source_current: resolved.sourceCurrent,
      stale_reasons: resolved.staleReasons
    });
    const continued = decodeObligationCoverageOperationCursor(input.cursor, joinedDigest);
    const selector = continued?.selector ??
      obligationCoverageQuerySelector(input.selector, resolved);
    const offset = continued?.offset ?? 0;
    const rows = structuredClone(resolved.rows).sort((left, right) => {
      const leftGap = left.proof.kind === "explicit_gap" ? 0 : 1;
      const rightGap = right.proof.kind === "explicit_gap" ? 0 : 1;
      return leftGap - rightGap || left.obligation_id.localeCompare(
        right.obligation_id, "en", { sensitivity: "case" }
      );
    }).filter((row) => obligationCoverageQueryMatches(row, selector));
    if (offset > rows.length) throw new ControlledContractToolError(
      "obligation_coverage_cursor_stale",
      "continuation offset exceeds the current deterministic population",
      { changed: false }
    );
    const items = rows.slice(offset, offset + OBLIGATION_COVERAGE_PAGE_SIZE);
    const nextOffset = offset + items.length;
    const continuation = nextOffset >= rows.length ? null
      : encodeObligationCoverageOperationCursor(
        obligationCoverageProjectionCursor(selector, nextOffset), joinedDigest
      );
    const nextCalls = continuation === null ? [] : [{
      tool: "workspace_controlled_contract_obligation_coverage_query",
      arguments: {
        unit: obligationCoverageUnitAddress(resolved),
        ...(resolved.focus === null ? {} : { focus: resolved.focus }),
        cursor: continuation
      }
    }];
    return Object.freeze({
      schema_version: "controlled-contract-obligation-coverage-query.v1",
      status: resolved.sourceCurrent ? "source_present_current" : "source_present_stale",
      source_identity: obligationCoverageSourceIdentity(resolved),
      joined_source_digest: joinedDigest,
      selector: selector === null ? null : Object.freeze(structuredClone(selector)),
      totals: Object.freeze({
        all_rows: resolved.rows.length,
        matched_rows: rows.length,
        explicit_gaps: resolved.rows.filter(({ proof }) =>
          proof.kind === "explicit_gap").length,
        pack_mappings: resolved.rows.filter(({ proof }) =>
          proof.kind === "pack_mapping").length
      }),
      page: Object.freeze({
        offset,
        returned: items.length,
        remaining: rows.length - nextOffset,
        complete: continuation === null,
        continuation,
        items: Object.freeze(items)
      }),
      next_calls: Object.freeze(nextCalls),
      authority: Object.freeze({
        ...OBLIGATION_COVERAGE_NON_AUTHORITY,
        authors_obligations_only: false
      })
    });
  });
}

function rebaseNextCalls(input, result) {
  if (result.continuation === null || result.continuation === undefined) return result;
  const [call] = result.next_calls;
  return Object.freeze({
    ...result,
    next_calls: Object.freeze([{
      ...call,
      arguments: Object.freeze({
        unit: input.selectedUnit === undefined || input.selectedUnit === null
          ? input.wkId : `${input.wkId}#${input.selectedUnit}`,
        ...(input.focus === undefined || input.focus === null ? {} : { focus: input.focus }),
        ...call.arguments
      })
    }])
  });
}

function assertSourceRebaseAttemptIdentity(input, resolved) {
  exactObject(input.sourceIdentity, [
    "source_kind", "wk_id", "controlled_focus", "selected_unit",
    "locator_digest", "content_digest"
  ], "sourceIdentity");
  if (input.expectedAuthoringIdentity !== resolved.authoringIdentity ||
      JSON.stringify(input.sourceIdentity) !==
        JSON.stringify(obligationCoverageSourceIdentity(resolved))) {
    throw new ControlledContractToolError(
      "obligation_coverage_rebase_stale",
      "stale describe identity no longer matches server-resolved source facts",
      { changed: false, fresh_describe_required: true }
    );
  }
}

export async function rebaseControlledContractObligationCoverageOperation(input, {
  resolveFacts = resolveObligationCoverageFacts,
  persistCarrier = persistObligationCoverageCarrier,
  withSourceLease = withCanonicalControlledContractSourceLease
} = {}) {
  return controlledObligationCoverageOperation(async () => {
    const fields = input.mode === "attempt"
      ? ["mode", "expectedAuthoringIdentity", "sourceIdentity"]
      : input.mode === "page"
        ? ["mode", "conflictSetIdentity", "cursor"]
        : input.mode === "resolve"
          ? ["mode", "conflictSetIdentity", "dispositions"] : ["mode"];
    obligationCoverageOperationInput(input, fields);
    if (!["attempt", "page", "resolve"].includes(input.mode)) {
      throw new ControlledContractToolError(
        "obligation_coverage_rebase_request_invalid",
        "rebase requires one closed attempt, page, or resolve variant",
        { changed: false }
      );
    }
    const resolutionInput = obligationCoverageResolutionInput(input);
    const resolved = await resolveFacts(resolutionInput, { requireSource: true });
    if (resolved.sourceCurrent) return Object.freeze({
      schema_version: "controlled-contract-obligation-coverage-rebase.v1",
      status: "already_current", source_identity: obligationCoverageSourceIdentity(resolved),
      content_digest: resolved.source.content_digest, row_count: resolved.rows.length,
      changed: false, authority: OBLIGATION_COVERAGE_NON_AUTHORITY
    });
    if (input.mode === "attempt") assertSourceRebaseAttemptIdentity(input, resolved);
    const plan = planObligationCoverageRebase(resolved, {
      sourceLocatorDigest: obligationCoverageSourceLocatorDigest
    });
    const staleRecovery = coverageFamilyContinuationCalls(
      input, "obligation", "describe")[0];
    if (input.mode !== "attempt") assertConflictSetCurrent(
      plan, input.conflictSetIdentity, staleRecovery
    );
    if (input.mode === "page" || (input.mode === "attempt" && plan.entries.length > 0)) {
      const projected = projectRebaseConflictPage(plan,
        input.mode === "page" ? { cursor: input.cursor, staleRecovery } : { staleRecovery });
      return rebaseNextCalls(input, Object.freeze({
        ...projected, authority: OBLIGATION_COVERAGE_NON_AUTHORITY
      }));
    }
    let rows = plan.safeRows;
    if (input.mode === "resolve") {
      rows = await applyCompleteRebaseResolution(plan, input.dispositions, {
        normalizeRow: async (row, currentIdentity) => {
          const materialized = await materializeObligationCoverageRow(row, resolved);
          if (materialized.source_locator !== currentIdentity?.source_locator) {
            throw new ControlledContractToolError(
              "obligation_coverage_rebase_disposition_invalid",
              "semantic row does not select the conflict's current criterion",
              { changed: false }
            );
          }
          return materialized;
        },
        rowMatchesCurrentIdentity: (row, currentIdentity) =>
          currentIdentity !== null && row.source_locator === currentIdentity.source_locator
      });
    }
    const { content, bytes } = await validateObligationCoverageContent(resolved, rows);
    const digest = controlledContractContentDigest(content);
    const immediatelyCurrent = await resolveFacts(resolutionInput, { requireSource: true });
    assertObligationCoverageFinalCompare(resolved, immediatelyCurrent);
    const receipt = await persistCarrier({ input, expectedSnapshot: immediatelyCurrent,
      content, bytes, write: digest !== resolved.source.content_digest,
      resolveFacts, withSourceLease });
    return Object.freeze({
      schema_version: "controlled-contract-obligation-coverage-rebase.v1",
      status: receipt.changed ? "resolved" : "already_current",
      source_identity: Object.freeze({ ...obligationCoverageSourceIdentity(resolved),
        content_digest: receipt.content_digest }),
      content_digest: receipt.content_digest,
      row_count: content.obligations.length,
      byte_length: receipt.byte_length,
      changed: receipt.changed,
      authority: OBLIGATION_COVERAGE_NON_AUTHORITY
    });
  });
}

function assertAcceptanceRebaseAttemptIdentity(input, resolved) {
  exactObject(input.carrierIdentity,
    ["carrier_kind", "wk_id", "focus", "selected_unit", "content_digest"],
    "carrierIdentity");
  exactObject(input.sourceIdentity, ["source_kind", "content_digest"], "sourceIdentity");
  const currentCarrier = acceptanceCoverageCarrierIdentity(resolved);
  const currentSource = {
    source_kind: resolved.source.source_kind,
    content_digest: resolved.source.content_digest
  };
  if (JSON.stringify(input.carrierIdentity) !== JSON.stringify(currentCarrier) ||
      JSON.stringify(input.sourceIdentity) !== JSON.stringify(currentSource) ||
      input.expectedUnitDigest !== acceptanceCoverageUnitDigest(resolved)) {
    throw new ControlledContractToolError(
      "acceptance_coverage_rebase_stale",
      "stale describe identity no longer matches server-resolved mapping facts",
      { changed: false, fresh_describe_required: true }
    );
  }
}

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
      requireSource: true
    });
    if (!sourceFacts.sourceCurrent) throw new ControlledContractToolError(
      "acceptance_coverage_rebase_source_stale",
      "acceptance mapping cannot rebase before its obligation source is current",
      { changed: false, supported_next_call:
        "workspace_controlled_contract_obligation_coverage_rebase" }
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
    const staleRecovery = coverageFamilyContinuationCalls(
      input, "acceptance", "describe")[0];
    if (input.mode !== "attempt") assertConflictSetCurrent(
      plan, input.conflictSetIdentity, staleRecovery
    );
    if (input.mode === "page" || (input.mode === "attempt" && plan.entries.length > 0)) {
      return rebaseNextCalls(input, projectRebaseConflictPage(plan,
        input.mode === "page" ? { cursor: input.cursor, staleRecovery } : { staleRecovery }));
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
