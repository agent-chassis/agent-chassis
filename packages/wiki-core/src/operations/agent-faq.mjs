

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_FAQ_SCHEMA_VERSION = "agent-faq.v1";
export const AGENT_FAQ_CORPUS_FILENAME = "agent-faq.v1.json";
export const AGENT_FAQ_CORPUS_RELATIVE_PATH =
  "packages/wiki-core/data/agent-faq.v1.json";
export const AGENT_FAQ_ACTOR_VALUES = Object.freeze([
  "agent",
  "operator",
  "agent_or_operator"
]);

export const AGENT_FAQ_TIER_VISIBILITY_VALUES = Object.freeze([
  "free_local",
  "paid_cce",
  "operator_only"
]);
export const AGENT_FAQ_REGISTERED_TIER_FREE_LOCAL = "free_local";
export const AGENT_FAQ_REGISTERED_TIER_PAID_CCE = "paid_cce";
const AGENT_FAQ_INDEX_MAX_RESULTS = 40;
const AGENT_FAQ_RELATED_CODE_MAX_RESULTS = 8;
const AGENT_FAQ_INDEX_MAX_RESPONSE_BYTES = 4 * 1024;
const AGENT_FAQ_SELECTED_MAX_RESPONSE_BYTES = 64 * 1024;

const INDEX_STRING_MAX_JSON_BYTES = 160;
const INDEX_RELATED_CODE_MAX_JSON_BYTES = 96;
const INDEX_SYMPTOM_MAX_JSON_BYTES = 160;
const INDEX_RELATED_CODES_MAX_RESULTS = 4;
const DETAIL_ENTRY_MAX_JSON_BYTES = 24 * 1024;
const DETAIL_STRING_MAX_JSON_BYTES = 4 * 1024;
const DETAIL_CONTAINER_MAX_ITEMS = 32;
const DETAIL_MAX_NODES = 256;
const DETAIL_MAX_DEPTH = 8;
const OMIT = Symbol("omit");

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORPUS_PATH = path.join(
  THIS_DIR,
  "../../data",
  AGENT_FAQ_CORPUS_FILENAME
);

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      freezeDeep(value[key]);
    }
    return Object.freeze(value);
  }
  return value;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function jsonBytes(value, pretty = false) {
  return Buffer.byteLength(JSON.stringify(value, null, pretty ? 2 : 0), "utf8");
}

function clipString(value, maxJsonBytes) {
  if (jsonBytes(value) <= maxJsonBytes) {
    return { value, truncated: false };
  }
  const marker = "…";
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (jsonBytes(`${value.slice(0, middle)}${marker}`) <= maxJsonBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return { value: `${value.slice(0, low)}${marker}`, truncated: true };
}

function compactIndexEntry(entry) {
  let clipped = false;
  const take = (value, limit) => {
    const result = clipString(value, limit);
    clipped ||= result.truncated;
    return result.value;
  };
  const compact = {
    id: take(entry.id, INDEX_STRING_MAX_JSON_BYTES),
    title: take(entry.title, INDEX_STRING_MAX_JSON_BYTES),
    actor: entry.actor,
    related_codes: (entry.related_codes ?? [])
      .slice(0, INDEX_RELATED_CODES_MAX_RESULTS)
      .map((code) => take(code, INDEX_RELATED_CODE_MAX_JSON_BYTES))
  };
  clipped ||= (entry.related_codes?.length ?? 0) > compact.related_codes.length;
  if (
    isNonEmptyString(entry.symptom) &&
    jsonBytes(entry.symptom) <= INDEX_SYMPTOM_MAX_JSON_BYTES
  ) {
    compact.symptom = entry.symptom;
  }
  return { entry: compact, clipped };
}

function boundedDetailValue(value, state, depth = 0) {
  if (state.nodes <= 0 || depth > DETAIL_MAX_DEPTH) {
    state.truncated = true;
    return OMIT;
  }
  state.nodes -= 1;
  if (typeof value === "string") {
    const clipped = clipString(
      value,
      Math.min(DETAIL_STRING_MAX_JSON_BYTES, state.bytes)
    );
    const bytes = jsonBytes(clipped.value);
    if (bytes > state.bytes) {
      state.truncated = true;
      return OMIT;
    }
    state.bytes -= bytes;
    state.truncated ||= clipped.truncated;
    return clipped.value;
  }
  if (value === null || typeof value !== "object") {
    const bytes = jsonBytes(value);
    if (bytes > state.bytes) {
      state.truncated = true;
      return OMIT;
    }
    state.bytes -= bytes;
    return value;
  }

  const isArray = Array.isArray(value);
  if (state.bytes < 2) {
    state.truncated = true;
    return OMIT;
  }
  state.bytes -= 2;
  const output = isArray ? [] : {};
  const values = isArray ? value : Object.entries(value);
  for (const item of values.slice(0, DETAIL_CONTAINER_MAX_ITEMS)) {
    const key = isArray ? null : item[0];
    const child = isArray ? item : item[1];
    const overhead = (isArray ? 0 : jsonBytes(key) + 1) + (Object.keys(output).length > 0 ? 1 : 0);
    if (overhead >= state.bytes) {
      state.truncated = true;
      break;
    }
    state.bytes -= overhead;
    const projected = boundedDetailValue(child, state, depth + 1);
    if (projected === OMIT) {
      state.truncated = true;
      break;
    }
    if (isArray) output.push(projected);
    else output[key] = projected;
  }
  state.truncated ||= values.length > DETAIL_CONTAINER_MAX_ITEMS;
  return output;
}

function boundedDetailEntry(entry) {
  const state = {
    bytes: DETAIL_ENTRY_MAX_JSON_BYTES,
    nodes: DETAIL_MAX_NODES,
    truncated: false
  };
  return { entry: boundedDetailValue(entry, state), clipped: state.truncated };
}

function fail(corpusPath, message) {
  return new Error(`agent-faq corpus (${corpusPath}): ${message}`);
}

function validateRoute(corpusPath, route, where) {
  if (!isObject(route)) {
    throw fail(corpusPath, `${where} must be an object`);
  }
  if (!isNonEmptyString(route.tool)) {
    throw fail(corpusPath, `${where}.tool must be a non-empty string`);
  }
}

function validateStringArray(corpusPath, value, where) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.some((entry) => !isNonEmptyString(entry))) {
    throw fail(corpusPath, `${where} must be an array of non-empty strings when present`);
  }
}

function validateEntry(corpusPath, entry, index, seenIds) {
  const where = `entries[${index}]`;
  if (!isObject(entry)) {
    throw fail(corpusPath, `${where} must be an object`);
  }
  for (const field of ["id", "title", "symptom", "cause"]) {
    if (!isNonEmptyString(entry[field])) {
      throw fail(corpusPath, `${where}.${field} must be a non-empty string`);
    }
  }
  if (seenIds.has(entry.id)) {
    throw fail(corpusPath, `duplicate entry id "${entry.id}"`);
  }
  seenIds.add(entry.id);

  if (!AGENT_FAQ_ACTOR_VALUES.includes(entry.actor)) {
    throw fail(
      corpusPath,
      `${where}.actor must be one of ${AGENT_FAQ_ACTOR_VALUES.join(", ")}`
    );
  }

  if (
    !Array.isArray(entry.tier_visibility) ||
    entry.tier_visibility.length === 0 ||
    entry.tier_visibility.some((value) => !AGENT_FAQ_TIER_VISIBILITY_VALUES.includes(value))
  ) {
    throw fail(
      corpusPath,
      `${where}.tier_visibility must be a non-empty array of ${AGENT_FAQ_TIER_VISIBILITY_VALUES.join(", ")}`
    );
  }

  if (!Array.isArray(entry.routes)) {
    throw fail(corpusPath, `${where}.routes must be an array`);
  }
  entry.routes.forEach((route, routeIndex) =>
    validateRoute(corpusPath, route, `${where}.routes[${routeIndex}]`)
  );

  if (entry.fork !== undefined) {
    if (!Array.isArray(entry.fork)) {
      throw fail(corpusPath, `${where}.fork must be an array when present`);
    }
    entry.fork.forEach((branch, branchIndex) => {
      const branchWhere = `${where}.fork[${branchIndex}]`;
      if (!isObject(branch)) {
        throw fail(corpusPath, `${branchWhere} must be an object`);
      }
      if (!isNonEmptyString(branch.when)) {
        throw fail(corpusPath, `${branchWhere}.when must be a non-empty string`);
      }
      if (!AGENT_FAQ_ACTOR_VALUES.includes(branch.actor)) {
        throw fail(
          corpusPath,
          `${branchWhere}.actor must be one of ${AGENT_FAQ_ACTOR_VALUES.join(", ")}`
        );
      }
      if (!Array.isArray(branch.routes)) {
        throw fail(corpusPath, `${branchWhere}.routes must be an array`);
      }
      branch.routes.forEach((route, routeIndex) =>
        validateRoute(corpusPath, route, `${branchWhere}.routes[${routeIndex}]`)
      );
    });
  }

  validateStringArray(corpusPath, entry.related_codes, `${where}.related_codes`);
  validateStringArray(corpusPath, entry.related_docs, `${where}.related_docs`);
  validateStringArray(corpusPath, entry.related_records, `${where}.related_records`);
}

export function loadAgentFaqCorpus({ corpusPath = DEFAULT_CORPUS_PATH } = {}) {
  let raw;
  try {
    raw = readFileSync(corpusPath, "utf8");
  } catch (error) {
    throw fail(corpusPath, `could not be read (${error.code || error.message})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw fail(corpusPath, `is not valid JSON (${error.message})`);
  }

  if (!isObject(parsed)) {
    throw fail(corpusPath, "must be a JSON object");
  }
  if (parsed.schema_version !== AGENT_FAQ_SCHEMA_VERSION) {
    throw fail(
      corpusPath,
      `schema_version must be "${AGENT_FAQ_SCHEMA_VERSION}" (found ${JSON.stringify(parsed.schema_version)})`
    );
  }
  if (!Array.isArray(parsed.entries)) {
    throw fail(corpusPath, "entries must be an array");
  }

  const seenIds = new Set();
  parsed.entries.forEach((entry, index) =>
    validateEntry(corpusPath, entry, index, seenIds)
  );

  return freezeDeep(JSON.parse(JSON.stringify(parsed)));
}

export function listAgentFaqEntries(options = {}) {
  return loadAgentFaqCorpus(options).entries;
}

export function getAgentFaqEntryById(id, options = {}) {
  if (!isNonEmptyString(id)) {
    return null;
  }
  return listAgentFaqEntries(options).find((entry) => entry.id === id) ?? null;
}

export function filterAgentFaqEntriesByRelatedCode(code, options = {}) {
  if (!isNonEmptyString(code)) {
    return [];
  }
  return listAgentFaqEntries(options).filter(
    (entry) => Array.isArray(entry.related_codes) && entry.related_codes.includes(code)
  );
}

function agentFaqEntryVisibleForTier(entry, registeredTier) {
  const set = Array.isArray(entry?.tier_visibility)
    ? entry.tier_visibility.filter((value) => AGENT_FAQ_TIER_VISIBILITY_VALUES.includes(value))
    : [];
  if (set.length === 0) {
    return false;
  }
  const tier = AGENT_FAQ_TIER_VISIBILITY_VALUES.includes(registeredTier)
    ? registeredTier
    : AGENT_FAQ_REGISTERED_TIER_FREE_LOCAL;
  if (tier === AGENT_FAQ_REGISTERED_TIER_PAID_CCE) {
    return set.includes(AGENT_FAQ_REGISTERED_TIER_FREE_LOCAL) || set.includes(AGENT_FAQ_REGISTERED_TIER_PAID_CCE);
  }
  if (tier === AGENT_FAQ_REGISTERED_TIER_FREE_LOCAL) {
    return set.includes(AGENT_FAQ_REGISTERED_TIER_FREE_LOCAL);
  }
  return set.includes(tier);
}

export function getAgentFaq({
  id = null,
  related_code = null,
  registered_tier = null,
  corpusPath = DEFAULT_CORPUS_PATH
} = {}) {
  const corpus = loadAgentFaqCorpus({ corpusPath });
  const tierFiltered = isNonEmptyString(registered_tier)
    ? corpus.entries.filter((entry) => agentFaqEntryVisibleForTier(entry, registered_tier))
    : corpus.entries;
  let matches = tierFiltered;
  if (isNonEmptyString(id)) {
    matches = matches.filter((entry) => entry.id === id);
  }
  if (isNonEmptyString(related_code)) {
    matches = matches.filter(
      (entry) =>
        Array.isArray(entry.related_codes) && entry.related_codes.includes(related_code)
    );
  }

  const mode = isNonEmptyString(id)
    ? "id"
    : isNonEmptyString(related_code)
      ? "related_code"
      : "index";
  const maxResults = mode === "index"
    ? AGENT_FAQ_INDEX_MAX_RESULTS
    : mode === "id"
      ? 1
      : AGENT_FAQ_RELATED_CODE_MAX_RESULTS;
  const maxResponseBytes = mode === "index"
    ? AGENT_FAQ_INDEX_MAX_RESPONSE_BYTES
    : AGENT_FAQ_SELECTED_MAX_RESPONSE_BYTES;
  const query = {
    id: isNonEmptyString(id) ? clipString(id, INDEX_STRING_MAX_JSON_BYTES).value : null,
    related_code: isNonEmptyString(related_code)
      ? clipString(related_code, INDEX_STRING_MAX_JSON_BYTES).value
      : null,
    registered_tier: isNonEmptyString(registered_tier)
      ? clipString(registered_tier, INDEX_STRING_MAX_JSON_BYTES).value
      : null
  };
  const projected = matches.slice(0, maxResults).map((entry) =>
    mode === "index" ? compactIndexEntry(entry) : boundedDetailEntry(entry)
  );
  const returnedItems = [];
  const envelope = (items) => {
    const entries = items.map((item) => item.entry);
    const omitted = matches.length - entries.length;
    const clippedEntryCount = items.filter((item) => item.clipped).length;
    return {
      schema_version: corpus.schema_version,
      mode,
      query,
      total: matches.length,
      returned: entries.length,
      omitted,
      truncated: omitted > 0,
      entries_truncated: omitted > 0,
      entry_fields_clipped: clippedEntryCount > 0,
      clipped_entry_count: clippedEntryCount,
      max_results: maxResults,
      max_response_bytes: maxResponseBytes,
      entry_count: entries.length,
      total_entry_count: tierFiltered.length,
      entries
    };
  };
  for (const item of projected) {
    const candidate = [...returnedItems, item];
    if (jsonBytes(envelope(candidate), true) > maxResponseBytes) {
      break;
    }
    returnedItems.push(item);
  }
  return envelope(returnedItems);
}
