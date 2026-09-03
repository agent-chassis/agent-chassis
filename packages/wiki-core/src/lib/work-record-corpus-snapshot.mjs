import path from "node:path";
import {
  attachWorkRecordReadScopeAlias,
  computeWorkRecordSourceDigest,
  parseWorkRecordJson,
  validateWorkRecord
} from "./work-record-schema.mjs";
import { captureCanonicalWorkRecordInventory } from "./work-record-store.mjs";

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

function increment(instrumentation, metrics, name, amount = 1) {
  metrics[name] = (metrics[name] || 0) + amount;
  if (typeof instrumentation?.increment === "function") {
    instrumentation.increment(name, amount);
  }
}

function missingLoad(targetDir, candidate) {
  return {
    valid: false,
    source_path: candidate.absolutePath,
    source_path_relative: candidate.relativePath,
    source_digest: null,
    record_id: null,
    record: null,
    diagnostics: [
      {
        code: "missing_json_record",
        severity: "error",
        message: `Missing canonical work record JSON: ${candidate.relativePath}`,
        path: candidate.relativePath
      }
    ],
    duplicate_claims: []
  };
}

function parsedLoad(candidate, parsed, instrumentation, metrics) {
  if (!parsed.ok) {
    return {
      valid: false,
      source_path: candidate.absolutePath,
      source_path_relative: candidate.relativePath,
      source_digest: null,
      record_id: null,
      record: null,
      diagnostics: [...parsed.diagnostics],
      duplicate_claims: []
    };
  }

  increment(instrumentation, metrics, "source_digest_count");
  const sourceDigest = computeWorkRecordSourceDigest(parsed.value);
  increment(instrumentation, metrics, "validation_count");
  const diagnostics = validateWorkRecord(parsed.value, {
    sourcePath: candidate.absolutePath,
    sourceDigest
  });
  const record = attachWorkRecordReadScopeAlias(parsed.value);

  return {
    valid: diagnostics.every((entry) => entry.severity !== "error"),
    source_path: candidate.absolutePath,
    source_path_relative: candidate.relativePath,
    source_digest: sourceDigest,
    record_id: record.id || null,
    record,
    diagnostics,
    duplicate_claims: []
  };
}

function claimantProjection(candidate, recordId) {
  return {
    absolutePath: candidate.absolutePath,
    path: candidate.relativePath,
    id: recordId
  };
}

export async function createWorkRecordCorpusSnapshot({
  dir = ".",
  recordStore = null,
  instrumentation = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  const metrics = {
    canonical_inventory_count: 0,
    canonical_bytes_read: 0,
    canonical_read_count: 0,
    evidence_sidecar_open_count: 0,
    parse_count: 0,
    validation_count: 0,
    source_digest_count: 0,
    snapshot_acquire_count: 1,
    snapshot_release_count: 0
  };
  if (typeof instrumentation?.increment === "function") {
    instrumentation.increment("snapshot_acquire_count", 1);
    instrumentation.increment("evidence_sidecar_open_count", 0);
  }
  const inventoryInstrumentation = {
    increment(name, amount = 1) {
      increment(instrumentation, metrics, name, amount);
    }
  };
  const inventory = await captureCanonicalWorkRecordInventory({
    dir: targetDir,
    recordStore,
    instrumentation: inventoryInstrumentation
  });

  let retainedEntries = [];
  let retainedLoads = [];
  let retainedClaimantsById = new Map();
  let retainedRecordsById = new Map();
  let retainedAllocatedValues = new Set();
  let retainedPrefixesByPath = new Map();

  for (const candidate of inventory) {
    let load;
    if (candidate.readError || candidate.rawBytes === null) {
      load = missingLoad(targetDir, candidate);
    } else {
      increment(instrumentation, metrics, "parse_count");
      const parsed = parseWorkRecordJson(candidate.rawBytes.toString("utf8"), {
        sourcePath: candidate.absolutePath
      });
      load = parsedLoad(candidate, parsed, instrumentation, metrics);
    }

    const prefix = Object.freeze([...candidate.prefix]);
    candidate.rawBytes = null;
    candidate.prefix = null;
    candidate.readError = null;
    retainedPrefixesByPath.set(candidate.relativePath, prefix);
    retainedPrefixesByPath.set(candidate.absolutePath, prefix);
    retainedEntries.push({
      absolutePath: candidate.absolutePath,
      path: candidate.relativePath,
      prefix,
      load
    });
    retainedLoads.push(load);

    if (load.record && hasOwn(load.record, "id") && load.record.id) {
      const claimants = retainedClaimantsById.get(load.record.id) || [];
      claimants.push(claimantProjection(candidate, load.record.id));
      retainedClaimantsById.set(load.record.id, claimants);
    }
  }

  for (const entry of retainedEntries) {
    const load = entry.load;
    if (load.record_id) {
      const claimants = retainedClaimantsById.get(load.record_id) || [];
      const duplicates = claimants.filter(
        (claimant) => path.resolve(claimant.absolutePath) !== path.resolve(load.source_path)
      );
      if (duplicates.length > 0) {
        load.duplicate_claims = duplicates.map((claimant) => ({
          path: claimant.path,
          id: claimant.id
        }));
        load.diagnostics.push({
          code: "duplicate_record_id",
          severity: "error",
          message: `Record id ${load.record_id} is also claimed by ${duplicates
            .map((claimant) => claimant.path)
            .join(", ")}`,
          path: load.source_path_relative
        });
        load.valid = false;
      }
    }

    const expectedId = path.basename(load.source_path, ".json");
    if (!load.record || !load.record_id || load.record_id !== expectedId) {
      continue;
    }
    const match = load.record_id.match(/^WK-(\d{4})$/);
    if (match) {
      retainedAllocatedValues.add(Number.parseInt(match[1], 10));
    }
    if (!retainedRecordsById.has(load.record_id)) {
      retainedRecordsById.set(load.record_id, load);
    }
  }

  for (const [recordId, claimants] of retainedClaimantsById) {
    retainedClaimantsById.set(recordId, deepFreeze([...claimants]));
  }
  retainedEntries = deepFreeze(retainedEntries);
  retainedLoads = deepFreeze(retainedLoads);
  const canonicalPaths = Object.freeze(retainedEntries.map((entry) => entry.path));
  const claimedIds = Object.freeze([...retainedClaimantsById.keys()]);
  let released = false;

  return Object.freeze({
    entries: retainedEntries,
    canonicalPaths,
    loads: retainedLoads,
    claimedIds,
    get metrics() {
      return deepFreeze({ ...metrics });
    },
    getRecordById(id) {
      return retainedRecordsById?.get(String(id)) || null;
    },
    getClaimantsById(id) {
      return retainedClaimantsById?.get(String(id)) || Object.freeze([]);
    },
    hasAllocatedValue(value) {
      return retainedAllocatedValues?.has(Number(value)) || false;
    },
    getCanonicalPrefix(requestedPath) {
      if (!retainedPrefixesByPath) {
        return null;
      }
      const stringPath = String(requestedPath);
      return (
        retainedPrefixesByPath.get(stringPath) ||
        retainedPrefixesByPath.get(path.resolve(targetDir, stringPath)) ||
        null
      );
    },
    release() {
      if (released) {
        return;
      }
      released = true;
      retainedEntries = null;
      retainedLoads = null;
      retainedClaimantsById = null;
      retainedRecordsById = null;
      retainedAllocatedValues = null;
      retainedPrefixesByPath = null;
      metrics.snapshot_release_count += 1;
      if (typeof instrumentation?.increment === "function") {
        instrumentation.increment("snapshot_release_count", 1);
      }
    }
  });
}
