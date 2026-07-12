

import { isNonEmptyString, isObject } from "./work-record-dispatch-shared.mjs";
import { SLICE_ID_PATTERN } from "./work-record-schema-constants.mjs";

const WORK_ITEM_ID_PATTERN = /^WK-[0-9]{4}$/;
const REPO_QUALIFIED_PREFIX_PATTERN = /^[^:]+:.+$/;

const SATISFIED_LOCAL_DEPENDENCY_STATUSES = new Set(["done"]);

function normalizeAliasHints(options = null, recordRepo = null) {
  const aliases = new Set();

  const add = (value) => {
    if (isNonEmptyString(value)) {
      aliases.add(value);
    }
  };

  if (isObject(options)) {
    for (const key of [
      "workspaceAliases",
      "workspace_aliases",
      "sameRepoAliases",
      "same_repo_aliases"
    ]) {
      const value = options[key];
      if (Array.isArray(value) || value instanceof Set) {
        for (const entry of value) {
          add(entry);
        }
      } else {
        add(value);
      }
    }

    for (const key of [
      "workspaceAlias",
      "workspace_alias",
      "rootIdentity",
      "root_identity",
      "workspaceRepoAlias",
      "workspace_repo_alias",
      "workspaceRepoIdentity",
      "workspace_repo_identity"
    ]) {
      add(options[key]);
    }
  }

  if (isNonEmptyString(recordRepo)) {
    const slashIndex = recordRepo.lastIndexOf("/");
    add(slashIndex >= 0 ? recordRepo.slice(slashIndex + 1) : recordRepo);
  }

  return aliases;
}

function isExactConfiguredAlias(prefix, options = null, recordRepo = null) {
  return isNonEmptyString(prefix) && normalizeAliasHints(options, recordRepo).has(prefix);
}

function parseLocalDependencyAddress(raw, defaultRecordId = null) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return null;
  }

  if (WORK_ITEM_ID_PATTERN.test(text)) {
    return {
      address: text,
      record_id: text,
      slice_id: null
    };
  }

  const hashIndex = text.indexOf("#");
  if (hashIndex >= 0) {
    const recordId = text.slice(0, hashIndex);
    const sliceId = text.slice(hashIndex + 1);
    if (WORK_ITEM_ID_PATTERN.test(recordId) && SLICE_ID_PATTERN.test(sliceId)) {
      return {
        address: `${recordId}#${sliceId}`,
        record_id: recordId,
        slice_id: sliceId
      };
    }
    return null;
  }

  if (SLICE_ID_PATTERN.test(text) && WORK_ITEM_ID_PATTERN.test(defaultRecordId)) {
    return {
      address: `${defaultRecordId}#${text}`,
      record_id: defaultRecordId,
      slice_id: text
    };
  }

  return null;
}

export function normalizeDependencyStatuses(dependencyStatuses = null) {
  const output = new Map();

  if (!isObject(dependencyStatuses)) {
    return output;
  }

  for (const [dependencyId, rawValue] of Object.entries(dependencyStatuses)) {
    if (!isNonEmptyString(dependencyId)) {
      continue;
    }

    if (typeof rawValue === "string") {
      output.set(dependencyId, { status: rawValue, reason: null });
      continue;
    }

    if (isObject(rawValue)) {
      output.set(dependencyId, {
        status: isNonEmptyString(rawValue.status) ? rawValue.status : "unknown",
        reason: isNonEmptyString(rawValue.reason) ? rawValue.reason : null
      });
    }
  }

  return output;
}

export function parseDependencyAddress(address, defaultRecordId = null, options = null) {
  if (!isNonEmptyString(address)) {
    return {
      kind: "typoed",
      record_id: null,
      recordId: null,
      slice_id: null,
      sliceId: null,
      external_repo: null,
      externalRepo: null,
      address: null,
      valid: false,
      repo_alias: null,
      normalized_address: null
    };
  }

  const text = address.trim();
  const colonIndex = text.indexOf(":");
  if (colonIndex > 0 && REPO_QUALIFIED_PREFIX_PATTERN.test(text)) {
    const repoPrefix = text.slice(0, colonIndex);
    const remainder = text.slice(colonIndex + 1);

    if (isExactConfiguredAlias(repoPrefix, options, options?.recordRepo ?? null)) {
      const local = parseLocalDependencyAddress(remainder, defaultRecordId);
      if (local) {
        return {
          kind: "local",
          record_id: local.record_id,
          recordId: local.record_id,
          slice_id: local.slice_id,
          sliceId: local.slice_id,
          external_repo: null,
          externalRepo: null,
          address: local.address,
          valid: true,
          repo_alias: repoPrefix,
          normalized_address: local.address
        };
      }
      return {
        kind: "typoed",
        record_id: null,
        recordId: null,
        slice_id: null,
        sliceId: null,
        external_repo: null,
        externalRepo: null,
        address: text,
        valid: false,
        repo_alias: repoPrefix,
        normalized_address: null
      };
    }

    return {
      kind: "external",
      record_id: null,
      recordId: null,
      slice_id: null,
      sliceId: null,
      external_repo: repoPrefix,
      externalRepo: repoPrefix,
      address: text,
      valid: true,
      repo_alias: null,
      normalized_address: text
    };
  }

  const local = parseLocalDependencyAddress(text, defaultRecordId);
  if (!local) {
    return {
      kind: "typoed",
      record_id: null,
      recordId: null,
      slice_id: null,
      sliceId: null,
      external_repo: null,
      externalRepo: null,
      address: text,
      valid: false,
      repo_alias: null,
      normalized_address: null
    };
  }

  return {
    kind: "local",
    record_id: local.record_id,
    recordId: local.record_id,
    slice_id: local.slice_id,
    sliceId: local.slice_id,
    external_repo: null,
    externalRepo: null,
    address: local.address,
    valid: true,
    repo_alias: null,
    normalized_address: local.address
  };
}

export function normalizeDependencyAddress(address, defaultRecordId = null, options = null) {
  return parseDependencyAddress(address, defaultRecordId, options);
}

export function resolveDependencyAddress(address, defaultRecordId = null, options = null) {
  return parseDependencyAddress(address, defaultRecordId, options);
}

export function collectDeclaredDependencyAddresses(record, selectedUnit) {
  const entries = [];
  const seen = new Set();

  const addEntry = (address, source) => {
    if (!isNonEmptyString(address)) {
      return;
    }
    const key = `${source}::${address}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push({ address, source });
  };

  for (const address of Array.isArray(record?.depends_on) ? record.depends_on : []) {
    addEntry(address, "record");
  }

  if (selectedUnit?.kind === "slice") {
    for (const address of Array.isArray(selectedUnit?.depends_on) ? selectedUnit.depends_on : []) {
      addEntry(address, "slice");
    }
  }

  return entries;
}

export function findSliceById(record, sliceId) {
  if (!isObject(record) || !Array.isArray(record.slices)) {
    return null;
  }
  for (const slice of record.slices) {
    if (isObject(slice) && slice.id === sliceId) {
      return slice;
    }
  }
  return null;
}

export function buildDependencyEvidenceEntry({
  address,
  source,
  loadedRecord,
  additionalRecords,
  sameRepoAliases = null,
  supplied
}) {
  const parsed = parseDependencyAddress(address, loadedRecord?.id ?? null, {
    sameRepoAliases,
    recordRepo: loadedRecord?.repo ?? null
  });
  const baseEntry = {
    address,
    source,
    record_id: parsed.record_id,
    slice_id: parsed.slice_id,
    external_repo: parsed.external_repo,
    selected_status: null,
    marker: "resolved",
    provenance: "none",
    reason: supplied?.reason ?? null
  };

  if (parsed.kind === "typoed") {
    return { ...baseEntry, marker: "typoed" };
  }

  if (parsed.kind === "external") {
    if (supplied) {
      return {
        ...baseEntry,
        selected_status: supplied.status,
        marker: "external_supplied",
        provenance: "supplied"
      };
    }
    return { ...baseEntry, marker: "external_without_supplied_status" };
  }

  const targetRecord = parsed.record_id === loadedRecord?.id
    ? loadedRecord
    : additionalRecords?.get(parsed.record_id) ?? null;

  if (!targetRecord) {
    if (supplied) {
      return {
        ...baseEntry,
        selected_status: supplied.status,
        marker: "resolved",
        provenance: "supplied"
      };
    }
    return { ...baseEntry, marker: "missing" };
  }

  if (parsed.slice_id) {
    const slice = findSliceById(targetRecord, parsed.slice_id);
    if (slice) {
      if (supplied) {
        return {
          ...baseEntry,
          selected_status: supplied.status,
          marker: "resolved",
          provenance: "supplied"
        };
      }
      return {
        ...baseEntry,
        selected_status: isNonEmptyString(slice.status) ? slice.status : null,
        marker: "resolved",
        provenance: "canonical_wk_json"
      };
    }
    if (supplied) {
      return {
        ...baseEntry,
        selected_status: supplied.status,
        marker: "resolved",
        provenance: "supplied"
      };
    }
    return { ...baseEntry, marker: "unresolved" };
  }

  if (supplied) {
    return {
      ...baseEntry,
      selected_status: supplied.status,
      marker: "resolved",
      provenance: "supplied"
    };
  }

  return {
    ...baseEntry,
    selected_status: isNonEmptyString(targetRecord.status) ? targetRecord.status : null,
    marker: "resolved",
    provenance: "canonical_wk_json"
  };
}

export function resolveDependencyEvidenceVector({
  record,
  selectedUnit,
  dependencyStatuses,
  additionalRecords
}) {
  const sameRepoAliases = normalizeAliasHints(null, record?.repo ?? null);
  const declared = collectDeclaredDependencyAddresses(record, selectedUnit);
  const evidence = [];
  const declaredAddresses = new Set();

  for (const entry of declared) {
    const supplied = dependencyStatuses.get(entry.address) ?? null;
    evidence.push(
      buildDependencyEvidenceEntry({
        address: entry.address,
        source: entry.source,
        loadedRecord: record,
        additionalRecords,
        sameRepoAliases,
        supplied
      })
    );
    declaredAddresses.add(entry.address);
  }

  for (const [address, status] of dependencyStatuses.entries()) {
    if (declaredAddresses.has(address)) {
      continue;
    }
    const parsed = parseDependencyAddress(address, record?.id ?? null, {
      sameRepoAliases,
      recordRepo: record?.repo ?? null
    });
    evidence.push({
      address,
      source: "supplied",
      record_id: parsed.record_id,
      slice_id: parsed.slice_id,
      external_repo: parsed.external_repo,
      selected_status: status.status,
      marker: parsed.kind === "typoed" ? "typoed" : "supplied_only",
      provenance: "supplied",
      reason: status.reason ?? null
    });
  }

  return evidence;
}

export function collectDeclaredInterRecordIds(record, selectedUnit) {
  const ids = new Set();
  const sameRepoAliases = normalizeAliasHints(null, record?.repo ?? null);
  for (const entry of collectDeclaredDependencyAddresses(record, selectedUnit)) {
    const parsed = parseDependencyAddress(entry.address, record?.id ?? null, {
      sameRepoAliases,
      recordRepo: record?.repo ?? null
    });
    if (
      parsed.kind === "local" &&
      isNonEmptyString(parsed.record_id) &&
      parsed.record_id !== record.id
    ) {
      ids.add(parsed.record_id);
    }
  }
  return ids;
}

export async function loadAdditionalDependencyRecords({ record, selectedUnit, dir, recordStore }) {
  const interRecordIds = collectDeclaredInterRecordIds(record, selectedUnit);
  if (interRecordIds.size === 0) {
    return new Map();
  }

  const { loadWorkRecordById } = await import("./work-record-store.mjs");
  const additional = new Map();
  for (const id of interRecordIds) {
    try {
      const loaded = await loadWorkRecordById({ dir, id, recordStore });
      if (loaded?.valid && isObject(loaded.record)) {
        additional.set(id, loaded.record);
      }
    } catch {

    }
  }
  return additional;
}

export function isSatisfiedLocalDependencyStatus(status) {
  return typeof status === "string" && SATISFIED_LOCAL_DEPENDENCY_STATUSES.has(status);
}

export function collectDependencyBlockers(dependencyEvidence) {
  const blockers = [];
  for (const entry of Array.isArray(dependencyEvidence) ? dependencyEvidence : []) {
    if (entry.selected_status === "blocked") {
      blockers.push({
        code: "blocked_dependency",
        reason: entry.reason || `Dependency ${entry.address} is blocked`
      });
      continue;
    }
    if (entry.marker === "typoed") {
      blockers.push({
        code: "blocked_dependency",
        reason: `Dependency address ${entry.address} is not a valid WK or repo-qualified id`
      });
      continue;
    }
    if (entry.marker === "unresolved" && entry.provenance !== "supplied") {
      blockers.push({
        code: "blocked_dependency",
        reason: `Dependency slice ${entry.address} could not be resolved against canonical WK JSON`
      });
      continue;
    }
    if (
      entry.marker === "resolved" &&
      entry.provenance === "canonical_wk_json" &&
      !isSatisfiedLocalDependencyStatus(entry.selected_status)
    ) {
      const statusLabel = isNonEmptyString(entry.selected_status)
        ? entry.selected_status
        : "unknown";
      blockers.push({
        code: "blocked_dependency",
        reason: `Dependency ${entry.address} is ${statusLabel}; only status "done" satisfies a declared local dependency`
      });
    }
  }
  return blockers;
}

export function summarizeDependencyEvidenceProvenance(dependencyEvidence) {
  const buckets = {
    canonical_wk_json: 0,
    supplied: 0,
    none: 0,
    other: 0
  };

  for (const entry of Array.isArray(dependencyEvidence) ? dependencyEvidence : []) {
    const provenance = isNonEmptyString(entry?.provenance) ? entry.provenance : "none";
    if (provenance === "canonical_wk_json" || provenance === "supplied" || provenance === "none") {
      buckets[provenance] += 1;
    } else {
      buckets.other += 1;
    }
  }

  return {
    count: Array.isArray(dependencyEvidence) ? dependencyEvidence.length : 0,
    canonical_wk_json: buckets.canonical_wk_json,
    supplied: buckets.supplied,
    none: buckets.none,
    other: buckets.other
  };
}
