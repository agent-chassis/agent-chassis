import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  TASK_RESULT_PROJECTION_VOCABULARY,
  taskResultPageAccounting,
  taskResultScalarRangeAccounting
} from "./task-result-projection-vocabulary.mjs";

export const TASK_RESULT_SNAPSHOT_DEFAULTS = Object.freeze({
  ttl_ms: 30 * 60 * 1000,
  capacity: 32,
  identity_bits: 256,
  maximum_items: 64,
  maximum_bytes: 16 * 1024,
  maximum_scalar_range_bytes: 8 * 1024
});

export class TaskResultSnapshotError extends Error {
  constructor(kind, reason, recovery = null, details = {}) {
    super(kind === "unavailable"
      ? "task-result snapshot is unavailable"
      : "task-result query is invalid");
    this.name = "TaskResultSnapshotError";
    this.code = kind === "unavailable"
      ? "task_result_snapshot_unavailable"
      : "task_result_query_invalid";
    this.kind = kind;
    this.details = Object.freeze({
      changed: false,
      reason,
      caller_correctable: true,
      recovery,
      ...details
    });
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])
  );
  return value;
}

function stable(value) {
  return JSON.stringify(canonical(value));
}

function matchesExpectedSourceIdentity(actual, expected) {
  if (expected === null) return true;
  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) return false;
  return Object.entries(canonical(expected)).every(([field, value]) =>
    Object.hasOwn(actual, field) && stable(actual[field]) === stable(value));
}

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    return Object.freeze(value);
  }
  return value;
}

function valueKind(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function pathValue(root, path, invalid, recovery) {
  let value = root;
  for (const segment of path) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) {
      throw invalid("field_unknown", recovery, { field_path: structuredClone(path) });
    }
    value = value[segment];
  }
  return value;
}

function decodePart(value) {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function defaultMeasure(value) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
}

function defaultAssertBound(value, maximumBytes) {
  if (defaultMeasure(value) > maximumBytes) {
    throw new RangeError("task-result projection exceeds its byte bound");
  }
  return value;
}

function defaultProjectPage({ result, domain, collection, selector, ordinal, maximumItems,
  descriptor }) {
  const source = result?.[collection];
  if (!Array.isArray(source)) {
    throw new TypeError(`task-result collection ${collection} is not an array`);
  }
  const rows = [...source].sort((left, right) => {
    const a = stable(left?.[descriptor.stable_id]);
    const b = stable(right?.[descriptor.stable_id]);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const selected = selector === null ? rows : rows.filter((row) =>
    Object.entries(selector).every(([key, value]) =>
      stable(row[key === "id" ? descriptor.stable_id : key]) === stable(value)));
  return Object.freeze({
    schema_version: "task-result-semantic-page.v1",
    domain,
    collection,
    selector,
    offset: ordinal,
    matched_count: selected.length,
    items: Object.freeze(selected.slice(ordinal, ordinal + maximumItems)),
    authority: Object.freeze({ kind: "advisory_evidence", confers: Object.freeze([]) })
  });
}

function defaultRowProjection(domain, collection, row, descriptor) {
  return Object.freeze({
    schema_version: "task-result-row-projection.v1",
    domain,
    collection,
    stable_id: row?.[descriptor.stable_id] ?? null,
    fields: Object.freeze(descriptor.fields.map((field) => Object.freeze({
      path: Object.freeze([field]),
      value_kind: valueKind(row?.[field])
    })))
  });
}

export function createTaskResultSnapshotRegistry({
  now = () => Date.now(),
  random = randomBytes,
  capacity = TASK_RESULT_SNAPSHOT_DEFAULTS.capacity,
  ttlMs = TASK_RESULT_SNAPSHOT_DEFAULTS.ttl_ms,
  maximumItems = TASK_RESULT_SNAPSHOT_DEFAULTS.maximum_items,
  maximumBytes = TASK_RESULT_SNAPSHOT_DEFAULTS.maximum_bytes,
  maximumScalarRangeBytes = TASK_RESULT_SNAPSHOT_DEFAULTS.maximum_scalar_range_bytes,
  collectionDescriptor = () => null,
  projectPage = defaultProjectPage,
  projectPageContext = () => null,
  projectRow = defaultRowProjection,
  measureProjectionBytes = defaultMeasure,
  assertProjectionBound = defaultAssertBound,
  queryOperationForDomain = (domain) => `${domain}_query`,
  unavailableError = (reason, recovery, details) =>
    new TaskResultSnapshotError("unavailable", reason, recovery, details),
  invalidError = (reason, recovery, details) =>
    new TaskResultSnapshotError("invalid", reason, recovery, details),
  accountingMode = "fields",
  schemaVersions = {}
} = {}) {
  if (![capacity, ttlMs, maximumItems, maximumBytes, maximumScalarRangeBytes]
    .every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError("task-result snapshot bounds must be positive safe integers");
  }
  if (!["fields", "nested"].includes(accountingMode)) {
    throw new TypeError("task-result accountingMode must be fields or nested");
  }
  const key = random(32);
  const snapshots = new Map();
  const tombstones = new Map();
  const schemas = Object.freeze({
    field: schemaVersions.field ?? "task-result-field.v1",
    row: schemaVersions.row ?? "task-result-row-projection.v1"
  });

  const unavailable = (reason, recovery, details = {}) =>
    unavailableError(reason, recovery, details);
  const invalid = (reason, recovery, details = {}) => invalidError(reason, recovery, details);

  function remember(identity, entry) {
    tombstones.set(identity, Object.freeze({ recovery: entry.recovery, domain: entry.domain }));
    while (tombstones.size > capacity * 2) tombstones.delete(tombstones.keys().next().value);
  }

  function expire() {
    const current = now();
    for (const [identity, entry] of snapshots) {
      if (entry.expires_at <= current) {
        remember(identity, entry);
        snapshots.delete(identity);
      }
    }
  }

  function touch(identity, entry) {
    snapshots.delete(identity);
    snapshots.set(identity, entry);
  }

  function put({ domain, result, sourceIdentity, recovery,
    resolveCurrentSourceIdentity = null }) {
    if (typeof domain !== "string" || domain.length === 0 ||
        result === null || typeof result !== "object" ||
        sourceIdentity === null || typeof sourceIdentity !== "object" ||
        recovery === null || typeof recovery !== "object") {
      throw new TypeError("task-result snapshot requires domain, result, sourceIdentity, and recovery");
    }
    expire();
    while (snapshots.size >= capacity) {
      const [identity, entry] = snapshots.entries().next().value;
      remember(identity, entry);
      snapshots.delete(identity);
    }
    let identity;
    do identity = random(32).toString("base64url"); while (snapshots.has(identity));
    const createdAt = now();
    const entry = Object.freeze({
      domain,
      result: freezeDeep(structuredClone(result)),
      source_identity: freezeDeep(canonical(sourceIdentity)),
      recovery: freezeDeep(structuredClone(recovery)),
      resolve_current_source_identity: resolveCurrentSourceIdentity,
      created_at: createdAt,
      expires_at: createdAt + ttlMs
    });
    snapshots.set(identity, entry);
    return identity;
  }

  function metadata(identity) {
    expire();
    const entry = snapshots.get(identity);
    if (!entry) return null;
    return Object.freeze({
      identity,
      domain: entry.domain,
      current: true,
      created_at: entry.created_at,
      expires_at: entry.expires_at
    });
  }

  function issueCursor(payload) {
    const body = Buffer.from(stable(payload), "utf8").toString("base64url");
    const mac = createHmac("sha256", key).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  function readCursor(value, recovery) {
    const parts = typeof value === "string" ? value.split(".") : [];
    if (parts.length !== 2) throw unavailable("cursor_authentication_failed", recovery);
    const expected = createHmac("sha256", key).update(parts[0]).digest();
    const supplied = decodePart(parts[1]);
    if (supplied === null || supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)) {
      throw unavailable("cursor_authentication_failed", recovery);
    }
    try {
      return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    } catch {
      throw unavailable("cursor_payload_invalid", recovery);
    }
  }

  function descriptorFor(domain, collection, recovery) {
    const descriptor = collectionDescriptor(domain, collection);
    if (descriptor === null || descriptor === undefined) {
      throw invalid("collection_unknown", recovery, { collection });
    }
    return descriptor;
  }

  function validateSelector(selector, descriptor, recovery) {
    if (selector === null) return null;
    if (typeof selector !== "object" || Array.isArray(selector) ||
        Object.keys(selector).length === 0 ||
        Object.keys(selector).some((key) => !descriptor.selectors.includes(key))) {
      throw invalid("selector_invalid", recovery, { collection: descriptor.collection });
    }
    return canonical(selector);
  }

  const bounded = (value, bound, context) =>
    assertProjectionBound(value, bound, context);

  async function query({ identity = null, domain = null, collection = null,
    selector = null, cursor = null, fieldPath = null, offset = null, length = null,
    maximumItems: requestedItems = maximumItems,
    maximumBytes: requestedBytes = maximumBytes,
    currentSourceIdentity = null,
    expectedSourceIdentity = null,
    recovery: callerRecovery = null }) {
    expire();
    const requestedDomain = domain;
    let ordinal = 0;
    let normalizedSelector = selector;
    let resolvedIdentity = identity;
    let recovery = identity === null
      ? callerRecovery
      : tombstones.get(identity)?.recovery ?? callerRecovery;
    if (cursor !== null) {
      if (identity !== null || selector !== null || fieldPath !== null ||
          offset !== null || length !== null || collection !== null) {
        throw invalid("cursor_and_selector_are_mutually_exclusive", recovery);
      }
      const bound = readCursor(cursor, recovery);
      recovery = snapshots.get(bound.identity)?.recovery ??
        tombstones.get(bound.identity)?.recovery ?? callerRecovery;
      if (requestedDomain !== null && requestedDomain !== bound.domain) {
        throw unavailable("cursor_domain_mismatch", recovery);
      }
      if (!matchesExpectedSourceIdentity(bound.source_identity, expectedSourceIdentity)) {
        throw unavailable("cursor_source_mismatch", recovery);
      }
      ({ identity: resolvedIdentity, domain, collection, selector: normalizedSelector,
        ordinal, maximum_items: requestedItems, maximum_bytes: requestedBytes,
        field_path: fieldPath = null } = bound);
      if (bound.expires_at <= now()) throw unavailable("cursor_expired", recovery);
    }
    const entry = snapshots.get(resolvedIdentity);
    recovery ??= entry?.recovery ?? tombstones.get(resolvedIdentity)?.recovery ?? callerRecovery;
    if (!entry) {
      throw unavailable("identity_unknown_expired_evicted_or_restarted", recovery);
    }
    if (domain !== entry.domain) throw unavailable("identity_domain_mismatch", recovery);
    if (!matchesExpectedSourceIdentity(entry.source_identity, expectedSourceIdentity)) {
      throw unavailable("identity_source_mismatch", recovery);
    }
    if (requestedItems < 1 || requestedItems > maximumItems ||
        requestedBytes !== maximumBytes) {
      throw invalid("query_bound_invalid", recovery);
    }
    if (fieldPath === null && (offset !== null || length !== null)) {
      throw invalid("scalar_range_requires_field_path", recovery);
    }
    const descriptor = descriptorFor(domain, collection, recovery);
    normalizedSelector = validateSelector(normalizedSelector, descriptor, recovery);
    touch(resolvedIdentity, entry);

    let current = currentSourceIdentity;
    if (current === null && typeof entry.resolve_current_source_identity === "function") {
      try {
        current = await entry.resolve_current_source_identity();
      } catch (error) {
        throw unavailable("source_identity_resolution_failed", recovery, {
          error_name: error instanceof Error ? error.name : "unknown"
        });
      }
    }
    current ??= entry.source_identity;
    const normalizedCurrent = canonical(current);
    const sourceCurrent = stable(normalizedCurrent) === stable(entry.source_identity);
    if (!sourceCurrent) {
      const changedSourceClasses = Object.keys({
        ...entry.source_identity, ...normalizedCurrent
      }).filter((field) => stable(entry.source_identity[field]) !==
        stable(normalizedCurrent[field])).sort();
      throw unavailable("source_identity_changed", recovery, {
        changed_source_classes: Object.freeze(changedSourceClasses)
      });
    }

    const selectedPage = projectPage({
      result: entry.result,
      domain,
      collection,
      selector: normalizedSelector,
      ordinal: fieldPath === null ? ordinal : 0,
      maximumItems: fieldPath === null ? requestedItems : 2,
      sourceCurrent,
      changedSourceClasses: [],
      descriptor
    });
    if (!selectedPage || !Array.isArray(selectedPage.items) ||
        !Number.isSafeInteger(selectedPage.matched_count)) {
      throw invalid("page_projector_invalid", recovery, { collection });
    }
    const pageContext = projectPageContext({
      result: entry.result,
      domain,
      collection,
      selector: normalizedSelector,
      sourceCurrent,
      descriptor
    });
    if (pageContext !== null &&
        (typeof pageContext !== "object" || Array.isArray(pageContext))) {
      throw invalid("page_context_projector_invalid", recovery, { collection });
    }

    const common = {
      domain,
      collection,
      selector: normalizedSelector,
      task_result_identity: resolvedIdentity,
      source_current: sourceCurrent,
      authority: selectedPage.authority,
      projection_vocabulary: TASK_RESULT_PROJECTION_VOCABULARY.continuation,
      supported_next_call: queryOperationForDomain(domain),
      ...(pageContext ?? {})
    };

    if (fieldPath !== null) {
      if (!Array.isArray(fieldPath) || fieldPath.length === 0 || fieldPath.length > 32 ||
          !fieldPath.every((part) => typeof part === "string" && part.length > 0 ||
            Number.isSafeInteger(part) && part >= 0)) {
        throw invalid("field_path_invalid", recovery);
      }
      if (normalizedSelector === null || typeof normalizedSelector.id !== "string" ||
          Object.keys(normalizedSelector).some((key) => key !== "id")) {
        throw invalid("field_requires_exact_row_identity", recovery);
      }
      if (selectedPage.matched_count !== 1 || selectedPage.items.length !== 1) {
        throw invalid("field_row_identity_not_unique", recovery,
          { matched_count: selectedPage.matched_count });
      }
      if (!descriptor.fields.includes(String(fieldPath[0]))) {
        throw invalid("field_unknown", recovery, { field_path: structuredClone(fieldPath) });
      }
      const value = pathValue(selectedPage.items[0], fieldPath, invalid, recovery);
      const kind = valueKind(value);
      const fieldCommon = {
        schema_version: schemas.field,
        ...common,
        field_path: Object.freeze([...fieldPath]),
        value_kind: kind
      };
      if (kind === "object" || kind === "array") {
        if (offset !== null || length !== null) throw invalid("range_requires_scalar", recovery);
        const complete = { ...fieldCommon, complete: true, total: Object.keys(value).length,
          value: structuredClone(value) };
        if (measureProjectionBytes(complete) <= requestedBytes) {
          return Object.freeze(bounded(complete, requestedBytes,
            { projection_class: "task_result_field", domain, collection }));
        }
        const keys = Object.keys(value);
        const fields = [];
        const candidateFor = (candidateFields) => {
          const nextOrdinal = ordinal + candidateFields.length;
          const hasMore = nextOrdinal < keys.length;
          const next = hasMore ? issueCursor({
            domain, identity: resolvedIdentity, collection, selector: normalizedSelector,
            ordinal: nextOrdinal, maximum_items: requestedItems,
            maximum_bytes: requestedBytes, field_path: fieldPath,
            expires_at: entry.expires_at,
            source_identity: entry.source_identity
          }) : null;
          const accounting = taskResultPageAccounting({
            total: keys.length, offset: ordinal,
            returned: candidateFields.length, cursor: next
          });
          return {
            ...fieldCommon,
            complete: accounting.complete,
            offset: ordinal,
            fields: candidateFields,
            ...(accountingMode === "fields" ? accounting : {
              total: keys.length,
              returned_count: candidateFields.length,
              omitted_count: accounting.remaining,
              has_more: !accounting.complete,
              cursor: next,
              accounting
            })
          };
        };
        for (const key_ of keys.slice(ordinal, ordinal + requestedItems)) {
          const field = Object.freeze({
            path: Object.freeze([...fieldPath, Array.isArray(value) ? Number(key_) : key_]),
            value_kind: valueKind(value[key_])
          });
          if (measureProjectionBytes(candidateFor([...fields, field])) > requestedBytes) break;
          fields.push(field);
        }
        if (fields.length === 0 && ordinal < keys.length) {
          throw invalid("field_inventory_entry_exceeds_delivery_bound", recovery);
        }
        return Object.freeze(bounded(candidateFor(Object.freeze(fields)), requestedBytes,
          { projection_class: "task_result_field_projection", domain, collection }));
      }

      const bytes = Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
      if (offset === null && length === null) {
        const complete = { ...fieldCommon, complete: true, total: bytes.length,
          value: structuredClone(value) };
        if (measureProjectionBytes(complete) <= requestedBytes) {
          return Object.freeze(bounded(complete, requestedBytes,
            { projection_class: "task_result_scalar", domain, collection }));
        }
        return Object.freeze(bounded({
          ...fieldCommon, complete: false, range_required: true,
          total: bytes.length, offset: 0, length: 0, unit: "utf8_bytes"
        }, requestedBytes, { projection_class: "task_result_scalar_metadata", domain, collection }));
      }
      if (!Number.isSafeInteger(offset) || offset < 0 ||
          !Number.isSafeInteger(length) || length < 1 ||
          length > Math.min(requestedBytes, maximumScalarRangeBytes) ||
          offset + length > bytes.length) {
        throw invalid("scalar_range_invalid", recovery,
          { offset, length, total: bytes.length });
      }
      const accounting = taskResultScalarRangeAccounting({ total: bytes.length, offset, length });
      return Object.freeze(bounded({
        ...fieldCommon,
        ...accounting,
        offset,
        length,
        unit: "utf8_bytes",
        value_base64: bytes.subarray(offset, offset + length).toString("base64")
      }, requestedBytes, { projection_class: "task_result_scalar_range", domain, collection }));
    }

    const items = [];
    let represented = 0;
    const candidateFor = (candidateItems, candidateCount) => {
      const nextOrdinal = ordinal + candidateCount;
      const hasMore = nextOrdinal < selectedPage.matched_count;
      const next = hasMore ? issueCursor({
        domain, identity: resolvedIdentity, collection, selector: normalizedSelector,
        ordinal: nextOrdinal, maximum_items: requestedItems,
        maximum_bytes: requestedBytes,
        expires_at: entry.expires_at,
        source_identity: entry.source_identity
      }) : null;
      const accounting = taskResultPageAccounting({
        total: selectedPage.matched_count,
        offset: ordinal,
        returned: candidateCount,
        cursor: next
      });
      const base = {
        ...selectedPage,
        ...common,
        offset: ordinal,
        items: candidateItems
      };
      return accountingMode === "fields"
        ? { ...base, ...accounting }
        : {
            ...base,
            returned_count: candidateCount,
            omitted_count: accounting.remaining,
            has_more: !accounting.complete,
            cursor: next,
            accounting
          };
    };
    for (const item of selectedPage.items) {
      if (measureProjectionBytes(candidateFor([...items, item], represented + 1)) <= requestedBytes) {
        items.push(item);
        represented += 1;
        continue;
      }
      if (represented > 0) break;
      const projection = projectRow(domain, collection, item, descriptor, schemas.row);
      if (measureProjectionBytes(candidateFor([projection], 1)) > requestedBytes) {
        throw invalid("row_field_inventory_exceeds_delivery_bound", recovery);
      }
      items.push(projection);
      represented = 1;
      break;
    }
    const projected = candidateFor(Object.freeze(items), represented);
    delete projected.next_ordinal;
    return Object.freeze(bounded(projected, requestedBytes,
      { projection_class: "task_result_page", domain, collection }));
  }

  return Object.freeze({ put, query, metadata, size: () => snapshots.size });
}
