import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as dependencyHelpers from './work-record-dispatch-dependencies.mjs';

const WORK_RECORDS_DIR_URL = new URL('../../../../wiki/work-records/', import.meta.url);

const MAX_NODES = 512;
const MAX_EDGES = 4096;
const MAX_PENDING = 256;

const KNOWN_LIFECYCLE_STATES = new Set([
  'inbox',
  'todo',
  'active',
  'review',
  'done',
  'blocked',
  'parked',
  'cancelled',
  'unknown',
]);

const RECORD_ID_RE = /^WK-\d+$/;
const SLICE_ID_RE = /^SLICE-[A-Za-z0-9._-]+$/;
const ADDRESS_RE = /^(WK-\d+)(?:#(SLICE-[A-Za-z0-9._-]+))?$/;

const helperApi = {
  ...(dependencyHelpers && typeof dependencyHelpers.default === 'object' && dependencyHelpers.default !== null
    ? dependencyHelpers.default
    : null),
  ...dependencyHelpers,
};

function pickHelper(...names) {
  for (const name of names) {
    if (typeof helperApi[name] === 'function') {
      return helperApi[name];
    }
  }
  return null;
}

const helperParseDependencyAddress = pickHelper(
  'parseDependencyAddress',
  'parseDependencyUnitAddress',
  'parseAddress',
);
const helperFindSliceById = pickHelper('findSliceById');

function isRecordShape(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && (
      typeof value.id === 'string'
      || Object.prototype.hasOwnProperty.call(value, 'schema_version')
      || Object.prototype.hasOwnProperty.call(value, 'record_kind')
      || Object.prototype.hasOwnProperty.call(value, 'status')
      || Object.prototype.hasOwnProperty.call(value, 'depends_on')
      || Object.prototype.hasOwnProperty.call(value, 'slices')
    ),
  );
}

function addSuppliedRecord(index, record, fallbackId = null) {
  if (!record || typeof record !== 'object') {
    return;
  }

  const recordId = typeof record.id === 'string' && RECORD_ID_RE.test(record.id)
    ? record.id
    : typeof fallbackId === 'string' && RECORD_ID_RE.test(fallbackId)
      ? fallbackId
      : null;

  if (!recordId) {
    return;
  }

  index.set(recordId, typeof record.id === 'string' && record.id === recordId ? record : { ...record, id: recordId });
}

function addSuppliedRecordCollection(index, collection) {
  if (!collection) {
    return;
  }

  if (collection instanceof Map) {
    for (const [fallbackId, record] of collection.entries()) {
      addSuppliedRecord(index, record, fallbackId);
    }
    return;
  }

  if (Array.isArray(collection)) {
    for (const record of collection) {
      addSuppliedRecord(index, record);
    }
    return;
  }

  if (typeof collection !== 'object') {
    return;
  }

  if (isRecordShape(collection)) {
    addSuppliedRecord(index, collection);
    return;
  }

  for (const [fallbackId, record] of Object.entries(collection)) {
    addSuppliedRecord(index, record, fallbackId);
  }
}

function collectSuppliedRecords(target, options) {
  const index = new Map();
  const sources = [target, options];

  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      continue;
    }

    addSuppliedRecordCollection(index, source.record);
    addSuppliedRecordCollection(index, source.work_record);
    addSuppliedRecordCollection(index, source.workRecord);
    addSuppliedRecordCollection(index, source.selected_record);
    addSuppliedRecordCollection(index, source.selectedRecord);
    addSuppliedRecordCollection(index, source.records);
    addSuppliedRecordCollection(index, source.work_records);
    addSuppliedRecordCollection(index, source.workRecords);
    addSuppliedRecordCollection(index, source.recordStore);
    addSuppliedRecordCollection(index, source.work_record_store);
    addSuppliedRecordCollection(index, source.workRecordStore);
  }

  return index;
}

function normalizeAddressInput(input) {
  if (typeof input === 'string') {
    return normalizeAddressString(input);
  }

  if (!input || typeof input !== 'object') {
    return { address: String(input ?? ''), recordId: null, sliceId: null, valid: false };
  }

  const recordId = typeof input.record_id === 'string'
    ? (RECORD_ID_RE.test(input.record_id) ? input.record_id : null)
    : typeof input.recordId === 'string'
      ? (RECORD_ID_RE.test(input.recordId) ? input.recordId : null)
      : typeof input.id === 'string' && RECORD_ID_RE.test(input.id)
        ? input.id
        : null;

  const sliceId = typeof input.slice_id === 'string'
    ? (SLICE_ID_RE.test(input.slice_id) ? input.slice_id : null)
    : typeof input.sliceId === 'string'
      ? (SLICE_ID_RE.test(input.sliceId) ? input.sliceId : null)
      : typeof input.id === 'string' && SLICE_ID_RE.test(input.id)
        ? input.id
        : null;

  if (recordId && sliceId) {
    return {
      address: `${recordId}#${sliceId}`,
      recordId,
      sliceId,
      valid: true,
    };
  }

  if (recordId) {
    return {
      address: recordId,
      recordId,
      sliceId: null,
      valid: true,
    };
  }

  if (typeof input.address === 'string') {
    return normalizeAddressString(input.address);
  }

  if (typeof input.id === 'string') {
    const normalizedId = normalizeAddressString(input.id);
    if (normalizedId.valid) {
      return normalizedId;
    }
  }

  return { address: String(input.id ?? ''), recordId: null, sliceId: null, valid: false };
}

function normalizeAddressString(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return { address: '', recordId: null, sliceId: null, valid: false };
  }

  const match = text.match(ADDRESS_RE);
  if (match) {
    return {
      address: match[2] ? `${match[1]}#${match[2]}` : match[1],
      recordId: match[1],
      sliceId: match[2] ?? null,
      valid: true,
    };
  }

  const [recordIdPart, sliceIdPart] = text.split('#', 2);
  const recordId = RECORD_ID_RE.test(recordIdPart) ? recordIdPart : null;
  const sliceId = sliceIdPart && SLICE_ID_RE.test(sliceIdPart) ? sliceIdPart : null;

  if (recordId && sliceId) {
    return {
      address: `${recordId}#${sliceId}`,
      recordId,
      sliceId,
      valid: true,
    };
  }

  if (recordId) {
    return {
      address: recordId,
      recordId,
      sliceId: null,
      valid: true,
    };
  }

  return { address: text, recordId: null, sliceId: null, valid: false };
}

function normalizeDependencyAddress(raw, defaultRecordId = null) {
  if (helperParseDependencyAddress) {
    try {
      const parsed = helperParseDependencyAddress(raw, defaultRecordId);
      const normalized = normalizeAddressInput(parsed);
      if (normalized.valid) {
        return normalized;
      }
    } catch {

    }
  }

  const normalized = normalizeAddressInput(raw);
  if (normalized.valid || !defaultRecordId) {
    return normalized;
  }

  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text && !text.includes('#') && SLICE_ID_RE.test(text) && RECORD_ID_RE.test(defaultRecordId)) {
      return {
        address: `${defaultRecordId}#${text}`,
        recordId: defaultRecordId,
        sliceId: text,
        valid: true,
      };
    }
  }

  return normalized;
}

function selectSlice(record, sliceId) {
  if (!sliceId || !record || !Array.isArray(record.slices)) {
    return null;
  }

  if (helperFindSliceById) {
    try {
      const found = helperFindSliceById(record, sliceId);
      if (found) {
        return found;
      }
    } catch {

    }
  }

  for (const slice of record.slices) {
    if (slice && slice.id === sliceId) {
      return slice;
    }
  }

  return null;
}

function createRecordLoadError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function loadRecord(recordId, suppliedRecords = null) {
  if (!recordId) {
    return null;
  }

  if (suppliedRecords?.has(recordId)) {
    return suppliedRecords.get(recordId) ?? null;
  }

  const fileUrl = new URL(`${recordId}.json`, WORK_RECORDS_DIR_URL);
  const filePath = fileURLToPath(fileUrl);
  let contents;

  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }

    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      throw createRecordLoadError(
        'permission_denied',
        `Unable to read canonical work record JSON at ${filePath}: ${error.message}`,
        error,
      );
    }

    throw createRecordLoadError(
      'record_load_failed',
      `Unable to read canonical work record JSON at ${filePath}: ${error.message}`,
      error,
    );
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw createRecordLoadError(
      'invalid_json',
      `Malformed canonical work record JSON at ${filePath}: ${error.message}`,
      error,
    );
  }
}

function getLifecycleState(record, slice) {
  const status = String(slice?.status ?? record?.status ?? 'unknown').toLowerCase();
  return KNOWN_LIFECYCLE_STATES.has(status) ? status : 'unknown';
}

function getSuperseded(record, slice) {
  return Boolean(
    record?.resolution === 'superseded'
      || record?.status === 'superseded'
      || record?.superseded_by
      || record?.supersededBy
      || slice?.resolution === 'superseded'
      || slice?.status === 'superseded'
      || slice?.superseded_by
      || slice?.supersededBy
      || slice?.superseded,
  );
}

function toArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  return [value];
}

function normalizeDependencyList(values, defaultRecordId = null) {
  const normalized = [];
  const seen = new Set();

  for (const value of toArray(values)) {
    const parsed = normalizeDependencyAddress(value, defaultRecordId);
    if (!parsed.address || seen.has(parsed.address)) {
      continue;
    }
    seen.add(parsed.address);
    normalized.push(parsed);
  }

  return normalized;
}

function getDirectDependencies(record, slice) {
  const dependencies = [];

  dependencies.push(...normalizeDependencyList(record?.depends_on, record?.id ?? null));

  if (slice) {
    dependencies.push(...normalizeDependencyList(slice.depends_on, record?.id ?? null));
  }

  const seen = new Set();
  const deduped = [];
  for (const dependency of dependencies) {
    if (seen.has(dependency.address)) {
      continue;
    }
    seen.add(dependency.address);
    deduped.push(dependency);
  }
  return deduped;
}

function loadUnitContext(address, unitCache, suppliedRecords = null) {
  if (unitCache.has(address)) {
    return unitCache.get(address);
  }

  const parsed = normalizeAddressInput(address);
  if (!parsed.valid) {
    const dangling = {
      address: parsed.address,
      record: null,
      slice: null,
      lifecycleState: 'unknown',
      superseded: false,
      dependsOn: [],
    };
    unitCache.set(address, dangling);
    return dangling;
  }

  const record = loadRecord(parsed.recordId, suppliedRecords);
  if (!record) {
    const dangling = {
      address: parsed.address,
      record: null,
      slice: null,
      lifecycleState: 'unknown',
      superseded: false,
      dependsOn: [],
    };
    unitCache.set(address, dangling);
    return dangling;
  }

  const slice = parsed.sliceId ? selectSlice(record, parsed.sliceId) : null;
  if (parsed.sliceId && !slice) {
    const dangling = {
      address: parsed.address,
      record,
      slice: null,
      lifecycleState: 'unknown',
      superseded: false,
      dependsOn: [],
    };
    unitCache.set(address, dangling);
    return dangling;
  }

  const lifecycleState = getLifecycleState(record, slice);
  const superseded = getSuperseded(record, slice);
  const dependsOn = getDirectDependencies(record, slice);

  const context = {
    address: parsed.address,
    record,
    slice,
    lifecycleState,
    superseded,
    dependsOn,
  };
  unitCache.set(address, context);
  return context;
}

function createNode(context) {
  return {
    id: context.address,
    lifecycle_state: context.lifecycleState,
    superseded: context.superseded,
  };
}

function normalizeTargetInput(target) {
  const parsed = normalizeAddressInput(target);
  if (parsed.valid) {
    return parsed.address;
  }

  if (typeof target === 'string') {
    return target.trim();
  }

  if (target && typeof target === 'object') {
    return String(target.target ?? target.address ?? target.id ?? target.unit ?? target.record_id ?? '');
  }

  return String(target ?? '');
}

export function collectPreconditionGraph(target, options = {}) {
  const targetAddress = normalizeTargetInput(target);
  const suppliedRecords = collectSuppliedRecords(target, options);
  const unitCache = new Map();
  const result = {
    target: targetAddress,
    nodes: [],
    edges: [],
  };

  const nodesById = new Map();
  const edgeKeys = new Set();
  const visited = new Set();
  const scheduled = new Set();
  const queue = [];
  let head = 0;

  function canAddPending() {
    return queue.length - head < MAX_PENDING;
  }

  function addNode(context) {
    if (nodesById.has(context.address)) {
      return nodesById.get(context.address);
    }

    if (result.nodes.length >= MAX_NODES) {
      result.over_cap = true;
      return null;
    }

    const node = createNode(context);
    nodesById.set(context.address, node);
    result.nodes.push(node);
    return node;
  }

  function addEdge(from, to) {
    const key = `${from}\u0000${to}`;
    if (edgeKeys.has(key)) {
      return true;
    }

    if (result.edges.length >= MAX_EDGES) {
      result.over_cap = true;
      return false;
    }

    edgeKeys.add(key);
    result.edges.push({ from, to });
    return true;
  }

  function enqueue(address) {
    if (visited.has(address) || scheduled.has(address)) {
      return;
    }

    if (!canAddPending()) {
      result.over_cap = true;
      return;
    }

    scheduled.add(address);
    queue.push(address);
  }

  enqueue(targetAddress);

  while (head < queue.length) {
    const currentAddress = queue[head++];
    scheduled.delete(currentAddress);
    visited.add(currentAddress);

    const context = loadUnitContext(currentAddress, unitCache, suppliedRecords);
    if (result.over_cap) {
      break;
    }

    if (!addNode(context)) {
      break;
    }

    for (const dependency of context.dependsOn) {
      if (!dependency.address) {
        continue;
      }

      if (!addEdge(context.address, dependency.address)) {
        break;
      }

      const dependencyContext = loadUnitContext(dependency.address, unitCache, suppliedRecords);
      if (result.over_cap) {
        break;
      }

      if (!addNode(dependencyContext)) {
        break;
      }

      if (!dependencyContext.record) {
        continue;
      }

      if (!visited.has(dependencyContext.address) && !scheduled.has(dependencyContext.address)) {
        if (!canAddPending()) {
          result.over_cap = true;
          break;
        }
        scheduled.add(dependencyContext.address);
        queue.push(dependencyContext.address);
      }
    }

    if (result.over_cap) {
      break;
    }
  }

  if (!nodesById.has(targetAddress)) {
    const targetContext = loadUnitContext(targetAddress, unitCache, suppliedRecords);
    if (result.nodes.length < MAX_NODES) {
      addNode(targetContext);
    } else {
      result.over_cap = true;
    }
  }

  if (result.over_cap) {
    return {
      signal: 'fail_closed',
      reason: 'precondition graph exceeded the configured cap',
    };
  }

  if (options && typeof options === 'object' && options.includeTargetNodeOnly === true) {
    const narrowed = {
      target: result.target,
      nodes: result.nodes.filter((node) => node.id === result.target),
      edges: result.edges.filter((edge) => edge.from === result.target),
    };
    if (result.over_cap) {
      narrowed.over_cap = true;
    }
    return narrowed;
  }

  return result;
}

export const buildPreconditionGraph = collectPreconditionGraph;
export const getPreconditionGraph = collectPreconditionGraph;
export const createPreconditionGraph = collectPreconditionGraph;
export const producePreconditionGraph = collectPreconditionGraph;
export const computePreconditionGraph = collectPreconditionGraph;

const preconditionGraphProducer = Object.assign(collectPreconditionGraph, {
  collectPreconditionGraph,
  buildPreconditionGraph,
  getPreconditionGraph,
  createPreconditionGraph,
  producePreconditionGraph,
  computePreconditionGraph,
});

export default preconditionGraphProducer;
