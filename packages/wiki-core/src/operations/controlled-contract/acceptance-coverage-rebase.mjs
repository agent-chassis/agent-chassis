

import { open, unlink } from "node:fs/promises";

import {
  ControlledContractToolError,
  controlledContractContentDigest
} from "../../lib/controlled-contract-tools.mjs";

const REBASE_CONFLICT_SET_VERSION = "rebase-conflict-set.v1";
const REBASE_CURSOR_VERSION = "controlled-contract-coverage-rebase-cursor.v1";
const REBASE_PAGE_MAX_BYTES = 16384;

const CONFLICT_ORDER = Object.freeze([
  "invalid", "ambiguous", "duplicate", "absent_node", "changed",
  "removed", "new_unmapped"
]);

const NON_AUTHORITY = Object.freeze({
  authoritative: false,
  authors_mappings_only: true,
  grants: Object.freeze([]),
  denies: Object.freeze([
    "proof", "requirement", "admission", "policy", "dispatch", "review",
    "integration", "publication", "completion", "security"
  ])
});

function stableCompare(left, right) {
  return String(left).localeCompare(String(right), "en", { sensitivity: "case" });
}

function publicConflict({ family, kind, oldIdentity = null, currentIdentity = null,
  occurrence = 0, allowedDispositions }) {
  const identity = { family, kind, old_identity: oldIdentity,
    current_identity: currentIdentity, occurrence };
  return Object.freeze({
    conflict_id: controlledContractContentDigest(identity),
    kind,
    old_identity: oldIdentity === null ? null : Object.freeze(structuredClone(oldIdentity)),
    current_identity: currentIdentity === null
      ? null : Object.freeze(structuredClone(currentIdentity)),
    allowed_dispositions: Object.freeze([...allowedDispositions])
  });
}

function finalizePlan(family, currentnessVector, entries, safeRows) {
  const sorted = [...entries].sort((left, right) =>
    CONFLICT_ORDER.indexOf(left.public.kind) - CONFLICT_ORDER.indexOf(right.public.kind) ||
    stableCompare(left.public.conflict_id, right.public.conflict_id));
  const publicConflicts = sorted.map((entry) => entry.public);
  const currentnessDigest = controlledContractContentDigest(currentnessVector);
  const conflictDigest = controlledContractContentDigest(publicConflicts);
  const conflictSetIdentity = controlledContractContentDigest({
    schema_version: REBASE_CONFLICT_SET_VERSION,
    family,
    currentness_digest: currentnessDigest,
    conflict_digest: conflictDigest
  });
  return Object.freeze({
    family,
    currentnessVector: Object.freeze(structuredClone(currentnessVector)),
    currentnessDigest,
    conflictDigest,
    conflictSetIdentity,
    entries: Object.freeze(sorted),
    safeRows: Object.freeze(structuredClone(safeRows))
  });
}

function obligationRowIdentity(row) {
  return Object.freeze({
    obligation_id: row.obligation_id,
    source_locator: row.source_locator,
    source_locator_digest: row.source_locator_digest
  });
}

function obligationCriterionIdentity(criterion) {
  return Object.freeze({
    criterion_identity: criterion.identity,
    source_locator: criterion.source_locator
  });
}

function obligationProofIsCurrent(proof, selectedPacks) {
  if (proof?.kind === "explicit_gap") return true;
  if (proof?.kind !== "pack_mapping") return false;
  return selectedPacks.some((pack) =>
    pack.pack_id === proof.pack_id &&
    pack.profile_id === proof.profile_id &&
    pack.profile_version === proof.profile_version &&
    pack.requested_intents.includes(proof.requested_intent) &&
    pack.selectors.some((selector) =>
      selector.kind === proof.selector?.kind &&
      selector.component_id === proof.selector?.component_id &&
      selector.evaluation_stage === proof.evaluation_stage));
}

export function planObligationCoverageRebase(resolved, { sourceLocatorDigest }) {
  const entries = [];
  const safeRows = [];
  const criteriaByLocator = new Map(resolved.criteria.map((criterion) => [
    criterion.source_locator, criterion
  ]));
  const nodeIds = new Set(resolved.contractNodes.map(({ id }) => id));
  const obligationIdCounts = new Map();
  for (const row of resolved.rows) {
    obligationIdCounts.set(row.obligation_id,
      (obligationIdCounts.get(row.obligation_id) ?? 0) + 1);
  }
  const coveredLocators = new Set();

  resolved.rows.forEach((row, occurrence) => {
    const current = criteriaByLocator.get(row.source_locator) ?? null;
    const oldIdentity = obligationRowIdentity(row);
    const currentIdentity = current === null ? null : obligationCriterionIdentity(current);
    let kind = null;
    let allowed = ["replace", "remove"];
    if (current === null) {
      kind = "removed";
      allowed = ["remove"];
    } else if (!Array.isArray(row.controlled_contract_node_ids) ||
        row.controlled_contract_node_ids.some((id) => !nodeIds.has(id))) {
      kind = "absent_node";
    } else if (!obligationProofIsCurrent(row.proof, resolved.selectedPacks)) {
      kind = "changed";
    } else {
      const expectedDigest = sourceLocatorDigest({
        criterion: current.criterion,
        criterionIdentity: current.identity,
        criterionSetDigest: resolved.criterionIdentities.digest,
        obligationId: row.obligation_id,
        sourceLocator: current.source_locator,
        statement: row.statement
      });
      if (expectedDigest !== row.source_locator_digest) kind = "changed";
    }
    const retainable = kind === null;
    if (kind === null && obligationIdCounts.get(row.obligation_id) > 1) {
      kind = "duplicate";
      allowed = ["retain", "replace", "remove"];
    }
    if (kind === null) {
      safeRows.push(structuredClone(row));
      coveredLocators.add(row.source_locator);
      return;
    }
    const publicValue = publicConflict({ family: "obligation", kind,
      oldIdentity, currentIdentity, occurrence, allowedDispositions: allowed });
    entries.push(Object.freeze({ public: publicValue, oldRow: structuredClone(row),
      currentIdentity, retainable }));
  });

  for (const criterion of resolved.criteria) {
    if (coveredLocators.has(criterion.source_locator)) continue;
    const hasTargetedConflict = entries.some(({ currentIdentity }) =>
      currentIdentity?.source_locator === criterion.source_locator);
    if (hasTargetedConflict) continue;
    const currentIdentity = obligationCriterionIdentity(criterion);
    entries.push(Object.freeze({
      public: publicConflict({ family: "obligation", kind: "new_unmapped",
        currentIdentity, allowedDispositions: ["add"] }),
      oldRow: null,
      currentIdentity,
      retainable: false
    }));
  }

  return finalizePlan("obligation", {
    authoring_identity: resolved.authoringIdentity,
    source_content_digest: resolved.source?.content_digest ?? null,
    criterion_identity_digest: resolved.criterionIdentities.digest,
    contract_node_digest: resolved.bindings.contractNodeDigest,
    selected_pack_digest: resolved.bindings.selectedPackDigest,
    stale_reasons: resolved.staleReasons
  }, entries, safeRows);
}

function acceptanceRowIdentity(row) {
  return Object.freeze({ criterion_identity: row.criterion_identity });
}

function currentAcceptanceIdentity(entry) {
  return Object.freeze({ criterion_identity: entry.identity,
    source: entry.source });
}

export function planAcceptanceCoverageRebase(resolved, criterionIdentities) {
  const entries = [];
  const safeRows = [];
  const currentByIdentity = new Map(criterionIdentities.identities.map((entry) => [
    entry.identity, entry
  ]));
  const priorEntries = resolved.carrier?.content.criterion_identities?.identities ?? [];
  const priorByIdentity = new Map(priorEntries.map((entry) => [entry.identity, entry]));
  const currentByPosition = new Map(criterionIdentities.identities.map((entry) => [
    entry.position, entry
  ]));
  const nodeIds = new Set(resolved.contractNodes.map(({ id }) => id));
  const identityCounts = new Map();
  for (const row of resolved.rows) {
    identityCounts.set(row.criterion_identity,
      (identityCounts.get(row.criterion_identity) ?? 0) + 1);
  }
  const covered = new Set();

  resolved.rows.forEach((row, occurrence) => {
    const oldIdentity = acceptanceRowIdentity(row);
    const exactCurrent = currentByIdentity.get(row.criterion_identity) ?? null;
    const prior = priorByIdentity.get(row.criterion_identity) ?? null;
    const positionalCurrent = prior === null ? null : currentByPosition.get(prior.position) ?? null;
    let kind = null;
    let current = exactCurrent;
    let allowed = ["replace", "remove"];
    if (!Array.isArray(row.node_ids) ||
        new Set(row.node_ids).size !== row.node_ids.length) {
      kind = "invalid";
    } else if (exactCurrent === null) {
      current = positionalCurrent;
      kind = positionalCurrent === null ? "removed" : "changed";
      allowed = positionalCurrent === null ? ["remove"] : ["replace", "remove"];
    } else if (row.node_ids.some((id) => !nodeIds.has(id))) {
      kind = "absent_node";
    }
    const retainable = kind === null;
    if (kind === null && identityCounts.get(row.criterion_identity) > 1) {
      kind = "duplicate";
      allowed = ["retain", "replace", "remove"];
    }
    if (kind === null) {
      safeRows.push(structuredClone(row));
      covered.add(row.criterion_identity);
      return;
    }
    const currentIdentity = current === null ? null : currentAcceptanceIdentity(current);
    entries.push(Object.freeze({
      public: publicConflict({ family: "acceptance", kind, oldIdentity,
        currentIdentity, occurrence, allowedDispositions: allowed }),
      oldRow: structuredClone(row), currentIdentity, retainable
    }));
  });

  for (const current of criterionIdentities.identities) {
    if (covered.has(current.identity)) continue;
    const hasTargetedConflict = entries.some(({ currentIdentity }) =>
      currentIdentity?.criterion_identity === current.identity);
    if (hasTargetedConflict) continue;
    const currentIdentity = currentAcceptanceIdentity(current);
    entries.push(Object.freeze({
      public: publicConflict({ family: "acceptance", kind: "new_unmapped",
        currentIdentity, allowedDispositions: ["add"] }),
      oldRow: null, currentIdentity, retainable: false
    }));
  }

  return finalizePlan("acceptance", {
    carrier_content_digest: resolved.carrier?.content_digest ?? null,
    source_content_digest: resolved.source.content_digest,
    source_bindings: resolved.bindings,
    criterion_identity_digest: criterionIdentities.digest
  }, entries, safeRows);
}

function encodeCursor(plan, offset) {
  return Buffer.from(JSON.stringify({
    version: REBASE_CURSOR_VERSION,
    family: plan.family,
    conflict_set_identity: plan.conflictSetIdentity,
    currentness_digest: plan.currentnessDigest,
    conflict_digest: plan.conflictDigest,
    applied_page_limit_bytes: REBASE_PAGE_MAX_BYTES,
    offset
  }), "utf8").toString("base64url");
}

function staleRecoveryDetails(staleRecovery, details = {}) {
  return {
    changed: false,
    fresh_describe_required: true,
    ...(staleRecovery === undefined ? {} : {
      next_calls: Object.freeze([Object.freeze(structuredClone(staleRecovery))])
    }),
    ...details
  };
}

function decodeCursor(plan, cursor, staleRecovery) {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const keys = Object.keys(value).sort();
    const expected = ["applied_page_limit_bytes", "conflict_digest",
      "conflict_set_identity", "currentness_digest", "family", "offset", "version"].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected) ||
        value.version !== REBASE_CURSOR_VERSION || value.family !== plan.family ||
        value.conflict_set_identity !== plan.conflictSetIdentity ||
        value.currentness_digest !== plan.currentnessDigest ||
        value.conflict_digest !== plan.conflictDigest ||
        value.applied_page_limit_bytes !== REBASE_PAGE_MAX_BYTES ||
        !Number.isSafeInteger(value.offset) || value.offset < 0 ||
        value.offset >= plan.entries.length) throw new Error("cursor facts are stale");
    return value.offset;
  } catch (error) {
    throw new ControlledContractToolError(
      "controlled_contract_coverage_rebase_cursor_stale",
      "rebase continuation no longer identifies the complete current conflict population",
      staleRecoveryDetails(staleRecovery, { cause: error.message })
    );
  }
}

function pageShape(plan, conflicts, offset, continuation) {
  const nextOffset = offset + conflicts.length;
  return {
    schema_version: REBASE_CONFLICT_SET_VERSION,
    status: "conflicts",
    conflict_set_identity: plan.conflictSetIdentity,
    currentness_digest: plan.currentnessDigest,
    conflict_digest: plan.conflictDigest,
    total_count: plan.entries.length,
    returned_count: conflicts.length,
    omitted_count: plan.entries.length - nextOffset,
    offset,
    conflicts,
    continuation,
    authority: NON_AUTHORITY
  };
}

export function projectRebaseConflictPage(plan, { cursor, staleRecovery } = {}) {
  const offset = cursor === undefined ? 0 : decodeCursor(plan, cursor, staleRecovery);
  const selected = [];
  for (let index = offset; index < plan.entries.length; index += 1) {
    const candidate = [...selected, plan.entries[index].public];
    const hasMore = offset + candidate.length < plan.entries.length;
    const continuation = hasMore ? encodeCursor(plan, offset + candidate.length) : null;
    const shape = pageShape(plan, candidate, offset, continuation);

    if (Buffer.byteLength(JSON.stringify(shape), "utf8") >
        REBASE_PAGE_MAX_BYTES - 2048) {
      if (selected.length === 0) throw new ControlledContractToolError(
        "controlled_contract_coverage_rebase_conflict_oversize",
        "one typed conflict cannot fit within the conflict-page byte ceiling",
        { changed: false, maximum_page_bytes: REBASE_PAGE_MAX_BYTES }
      );
      break;
    }
    selected.push(plan.entries[index].public);
  }
  const nextOffset = offset + selected.length;
  const continuation = nextOffset < plan.entries.length
    ? encodeCursor(plan, nextOffset) : null;
  const page = pageShape(plan, selected, offset, continuation);
  const nextCalls = continuation === null ? [] : [{
    tool: plan.family === "obligation"
      ? "workspace_controlled_contract_obligation_coverage_rebase"
      : "workspace_controlled_contract_acceptance_coverage_rebase",
    arguments: Object.freeze({
      mode: "page",
      conflict_set_identity: plan.conflictSetIdentity,
      cursor: continuation
    })
  }];
  return Object.freeze({ ...page, next_calls: Object.freeze(nextCalls) });
}

export async function applyCompleteRebaseResolution(plan, dispositions, {
  normalizeRow,
  rowMatchesCurrentIdentity
}) {
  if (!Array.isArray(dispositions)) throw new ControlledContractToolError(
    "controlled_contract_coverage_rebase_resolution_invalid",
    "resolution requires one complete disposition array", { changed: false }
  );
  const byId = new Map();
  for (const disposition of dispositions) {
    if (disposition === null || typeof disposition !== "object" ||
        Array.isArray(disposition)) throw new ControlledContractToolError(
      "controlled_contract_coverage_rebase_resolution_invalid",
      "every disposition must be one closed semantic object", { changed: false }
    );
    const expectedKeys = disposition.disposition === "replace" ||
      disposition.disposition === "add"
      ? ["conflict_id", "disposition", "row"]
      : ["conflict_id", "disposition"];
    if (JSON.stringify(Object.keys(disposition).sort()) !==
        JSON.stringify(expectedKeys.sort()) ||
        typeof disposition.conflict_id !== "string" ||
        !["retain", "replace", "add", "remove"].includes(disposition.disposition) ||
        byId.has(disposition.conflict_id)) throw new ControlledContractToolError(
      "controlled_contract_coverage_rebase_resolution_invalid",
      "dispositions must be closed, unique, and use the allowed vocabulary",
      { changed: false }
    );
    byId.set(disposition.conflict_id, disposition);
  }
  if (byId.size !== plan.entries.length || plan.entries.some(
    ({ public: conflict }) => !byId.has(conflict.conflict_id))) {
    throw new ControlledContractToolError(
      "controlled_contract_coverage_rebase_resolution_incomplete",
      "resolution must disposition every recomputed conflict exactly once",
      { changed: false, expected_count: plan.entries.length, actual_count: byId.size }
    );
  }
  const rows = structuredClone(plan.safeRows);
  for (const entry of plan.entries) {
    const disposition = byId.get(entry.public.conflict_id);
    if (!entry.public.allowed_dispositions.includes(disposition.disposition)) {
      throw new ControlledContractToolError(
        "controlled_contract_coverage_rebase_disposition_invalid",
        "disposition is not allowed for the recomputed conflict class",
        { changed: false, conflict_id: entry.public.conflict_id,
          disposition: disposition.disposition }
      );
    }
    if (disposition.disposition === "remove") continue;
    if (disposition.disposition === "retain") {
      if (entry.oldRow === null || entry.retainable !== true || !rowMatchesCurrentIdentity(
        entry.oldRow, entry.currentIdentity)) throw new ControlledContractToolError(
        "controlled_contract_coverage_rebase_disposition_invalid",
        "retain requires one exact still-current semantic row",
        { changed: false, conflict_id: entry.public.conflict_id }
      );
      rows.push(structuredClone(entry.oldRow));
      continue;
    }
    const row = await normalizeRow(disposition.row, entry.currentIdentity,
      disposition.disposition);
    if (!rowMatchesCurrentIdentity(row, entry.currentIdentity)) {
      throw new ControlledContractToolError(
        "controlled_contract_coverage_rebase_disposition_invalid",
        "semantic row does not resolve to the conflict's exact current identity",
        { changed: false, conflict_id: entry.public.conflict_id }
      );
    }
    rows.push(row);
  }
  return rows;
}

export function assertConflictSetCurrent(plan, conflictSetIdentity, staleRecovery) {
  if (conflictSetIdentity !== plan.conflictSetIdentity) throw new ControlledContractToolError(
    "controlled_contract_coverage_rebase_stale",
    "conflict set no longer identifies the complete currentness vector",
    staleRecoveryDetails(staleRecovery, {
      expected_conflict_set_identity: conflictSetIdentity,
      actual_conflict_set_identity: plan.conflictSetIdentity
    })
  );
}

export async function withOrderedCoverageLocks(lockFiles, busyCode, callback) {
  const held = [];
  try {
    for (const lockFile of lockFiles) {
      try {
        const handle = await open(lockFile, "wx", 0o600);
        held.push({ handle, lockFile });
      } catch (error) {
        throw new ControlledContractToolError(
          busyCode, "coverage persistence is already in progress",
          { changed: false, phase: "lock", cause: error?.code ?? null }
        );
      }
    }
    return await callback();
  } finally {
    for (const { handle, lockFile } of held.reverse()) {
      await handle.close();
      try { await unlink(lockFile); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

export {
  NON_AUTHORITY as COVERAGE_REBASE_NON_AUTHORITY,
  REBASE_PAGE_MAX_BYTES
};
