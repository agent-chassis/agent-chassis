

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
  let entries = tierFiltered;
  if (isNonEmptyString(id)) {
    entries = entries.filter((entry) => entry.id === id);
  }
  if (isNonEmptyString(related_code)) {
    entries = entries.filter(
      (entry) =>
        Array.isArray(entry.related_codes) && entry.related_codes.includes(related_code)
    );
  }

  return {
    schema_version: corpus.schema_version,
    owner: corpus.owner ?? null,
    description: corpus.description ?? null,
    query: {
      id: isNonEmptyString(id) ? id : null,
      related_code: isNonEmptyString(related_code) ? related_code : null,
      registered_tier: isNonEmptyString(registered_tier) ? registered_tier : null
    },
    entry_count: entries.length,
    total_entry_count: tierFiltered.length,
    entries
  };
}
