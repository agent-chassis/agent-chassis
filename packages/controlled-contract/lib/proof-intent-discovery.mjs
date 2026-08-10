import { readFile } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";

import {
  canonicalDigest,
  canonicalJsonBytes,
  canonicalValue,
  compareCodeUnits,
  deepFreeze
} from "./deterministic-projection-primitives.mjs";

const packageRoot = new URL("../", import.meta.url);
const [rawCatalog, catalogSchema, discoverySchema] = await Promise.all([
  readJson(new URL("proof-intents/catalog.json", packageRoot)),
  readJson(new URL(
    "schema/controlled-contract-proof-intent-catalog.v1.schema.json",
    packageRoot
  )),
  readJson(new URL(
    "schema/controlled-contract-proof-intent-discovery.v1.schema.json",
    packageRoot
  ))
]);

const MAX_DISCOVERY_QUERY_BYTES = 1_024;
const MAX_DISCOVERY_RESULT_BYTES = 65_536;
const MAX_DISCOVERY_RETURNED_INTENTS = 256;
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateProofIntentCatalog = ajv.compile(catalogSchema);
const validateProofIntentDiscoveryResult = ajv.compile(discoverySchema);

class ProofIntentDiscoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofIntentDiscoveryError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function packKey({ profile_id: profileId, profile_version: profileVersion }) {
  return `${profileId}@${profileVersion}`;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}

function normalizeSearchText(value) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeProofIntentDiscoveryCatalog(value) {
  const normalized = structuredClone(value);
  normalized.intents = normalized.intents.map((intent) => ({
    ...intent,
    discovery_terms: sortedUnique(intent.discovery_terms),
    capable_packs: [...intent.capable_packs].sort((left, right) =>
      compareCodeUnits(packKey(left), packKey(right))
    ),
    compatibility: canonicalValue(Object.fromEntries(
      Object.entries(intent.compatibility).map(([key, values]) => [
        key, sortedUnique(values)
      ])
    )),
    required_evaluation_inputs: sortedUnique(intent.required_evaluation_inputs),
    distinctions: [...intent.distinctions].sort((left, right) =>
      compareCodeUnits(left.from_intent_id, right.from_intent_id)
    )
  })).sort((left, right) => compareCodeUnits(left.intent_id, right.intent_id));
  return canonicalValue(normalized);
}

function assertCatalogSemantics(catalog) {
  const ids = catalog.intents.map(({ intent_id: intentId }) => intentId);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) throw new ProofIntentDiscoveryError(
    "proof_intent_discovery_catalog_identity_ambiguous",
    "the shipped proof-intent catalog contains duplicate controlled intent ids"
  );
  for (const intent of catalog.intents) {
    const normalizedTerms = intent.discovery_terms.map(normalizeSearchText);
    if (normalizedTerms.some((term) => term.length === 0) ||
        new Set(normalizedTerms).size !== normalizedTerms.length) {
      throw new ProofIntentDiscoveryError(
        "proof_intent_discovery_terms_invalid",
        "controlled discovery terms must remain unique and nonempty after normalization",
        { intent_id: intent.intent_id }
      );
    }
    const capableKeys = intent.capable_packs.map(packKey);
    if (new Set(capableKeys).size !== capableKeys.length) {
      throw new ProofIntentDiscoveryError(
        "proof_intent_discovery_pack_identity_ambiguous",
        "one controlled intent maps the same pack identity more than once",
        { intent_id: intent.intent_id }
      );
    }
    const distinctionIds = intent.distinctions.map(
      ({ from_intent_id: intentId }) => intentId
    );
    if (new Set(distinctionIds).size !== distinctionIds.length ||
        distinctionIds.some((intentId) => intentId === intent.intent_id ||
          !idSet.has(intentId))) {
      throw new ProofIntentDiscoveryError(
        "proof_intent_discovery_distinction_invalid",
        "controlled intent distinctions must uniquely reference other catalog intents",
        { intent_id: intent.intent_id }
      );
    }
  }
}

if (!validateProofIntentCatalog(rawCatalog)) throw new ProofIntentDiscoveryError(
  "proof_intent_discovery_catalog_invalid",
  "the shipped controlled proof-intent catalog is schema-invalid",
  { diagnostics: structuredClone(validateProofIntentCatalog.errors) }
);
assertCatalogSemantics(rawCatalog);

const PROOF_INTENT_DISCOVERY_CATALOG = deepFreeze(
  normalizeProofIntentDiscoveryCatalog(rawCatalog)
);
const PROOF_INTENT_DISCOVERY_CATALOG_DIGEST = canonicalDigest(
  PROOF_INTENT_DISCOVERY_CATALOG
);

function validateOptions(options, unexpectedArguments) {
  if (unexpectedArguments.length > 0) throw new ProofIntentDiscoveryError(
    "proof_intent_discovery_arguments_invalid",
    "proof-intent discovery accepts exactly one options object"
  );
  if (options === undefined) return {};
  if (options === null || typeof options !== "object" || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) {
    throw new ProofIntentDiscoveryError(
      "proof_intent_discovery_options_invalid",
      "proof-intent discovery options must be a plain object"
    );
  }
  const keys = Reflect.ownKeys(options);
  const unsupported = keys.filter((key) => typeof key !== "string" ||
    !["query", "limit"].includes(key));
  if (unsupported.length > 0) throw new ProofIntentDiscoveryError(
    "proof_intent_discovery_option_unsupported",
    "proof-intent discovery accepts only query and search-result limit options",
    { unsupported_options: unsupported.map(String).sort(compareCodeUnits) }
  );
  return options;
}

function prepareRequest(options) {
  const hasQuery = Object.hasOwn(options, "query");
  if (!hasQuery) {
    if (Object.hasOwn(options, "limit")) throw new ProofIntentDiscoveryError(
      "proof_intent_discovery_list_limit_unsupported",
      "list mode always returns the complete controlled intent catalog"
    );
    return { mode: "list", query: null, queryTerms: null, limit: null };
  }
  if (typeof options.query !== "string" || options.query.length === 0) {
    throw new ProofIntentDiscoveryError(
      "proof_intent_discovery_query_invalid",
      "search mode requires nonempty query text"
    );
  }
  const queryBytes = Buffer.byteLength(options.query, "utf8");
  if (queryBytes > MAX_DISCOVERY_QUERY_BYTES) throw new ProofIntentDiscoveryError(
    "proof_intent_discovery_query_too_large",
    "proof-intent discovery query exceeds the declared UTF-8 byte limit",
    { byte_length: queryBytes, maximum_bytes: MAX_DISCOVERY_QUERY_BYTES }
  );
  const normalizedText = normalizeSearchText(options.query);
  if (normalizedText.length === 0) throw new ProofIntentDiscoveryError(
    "proof_intent_discovery_query_invalid",
    "search query must contain at least one letter or number after normalization"
  );
  const queryTerms = sortedUnique(normalizedText.split(" "));
  const limit = options.limit ?? MAX_DISCOVERY_RETURNED_INTENTS;
  if (!Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_DISCOVERY_RETURNED_INTENTS) {
    throw new ProofIntentDiscoveryError(
      "proof_intent_discovery_limit_invalid",
      `search-result limit must be an integer from 1 through ${MAX_DISCOVERY_RETURNED_INTENTS}`
    );
  }
  return {
    mode: "search",
    query: { normalized_text: queryTerms.join(" "), terms: queryTerms },
    queryTerms,
    limit
  };
}

function searchableSources(intent) {
  return [
    { source: "intent_id", source_value: intent.intent_id },
    { source: "definition", source_value: intent.definition },
    ...intent.discovery_terms.map((term) => ({
      source: "discovery_term", source_value: term
    }))
  ].map((source) => ({
    ...source,
    normalized_terms: new Set(normalizeSearchText(source.source_value).split(" "))
  }));
}

function searchIntent(intent, queryTerms) {
  const sources = searchableSources(intent);
  const searchableTerms = new Set(sources.flatMap(
    ({ normalized_terms: terms }) => [...terms]
  ));
  const matchedTerms = queryTerms.filter((term) => searchableTerms.has(term));
  if (matchedTerms.length === 0) return null;
  const unmatchedTerms = queryTerms.filter((term) => !searchableTerms.has(term));
  const reasons = sources.map(({
    source, source_value: sourceValue, normalized_terms: terms
  }) => ({
    source,
    source_value: sourceValue,
    matched_terms: matchedTerms.filter((term) => terms.has(term))
  })).filter(({ matched_terms: matchedTerms }) => matchedTerms.length > 0)
    .sort((left, right) => compareCodeUnits(
      `${left.source}\0${left.source_value}`,
      `${right.source}\0${right.source_value}`
    ));
  return {
    match_kind: unmatchedTerms.length === 0 ? "exact_match" : "partial_match",
    matched_terms: matchedTerms,
    unmatched_terms: unmatchedTerms,
    match_reasons: reasons
  };
}

function summarizeIntent(intent, match) {
  return {
    intent_id: intent.intent_id,
    definition: intent.definition,
    discovery_terms: [...intent.discovery_terms],
    capable_packs: structuredClone(intent.capable_packs),
    distinctions: structuredClone(intent.distinctions),
    match_kind: match?.match_kind ?? "catalog_entry",
    matched_terms: structuredClone(match?.matched_terms ?? []),
    unmatched_terms: structuredClone(match?.unmatched_terms ?? []),
    match_reasons: structuredClone(match?.match_reasons ?? [])
  };
}

function guidanceFor(status) {
  if (status === "match") return {
    code: "inspect_exact_candidates",
    message: "Every returned candidate matches all normalized query terms; inspect candidates and explicitly choose any applicable controlled intent."
  };
  if (status === "partial_match") return {
    code: "inspect_partial_candidates_and_refine_query",
    message: "No candidate matches every normalized query term; inspect matched and unmatched terms, then refine the query or list the bounded catalog."
  };
  if (status === "no_match") return {
    code: "refine_query_or_list_catalog",
    message: "No catalog candidate shares a normalized query term; remove or replace terms, or list the bounded catalog without a query."
  };
  return {
    code: "inspect_catalog",
    message: "Inspect the complete bounded catalog and explicitly choose any applicable controlled intent."
  };
}

function assertResultSemantics(result) {
  const expectedNoMatch = result.total_match_count === 0;
  const expectedPartial = result.intents.length > 0 &&
    result.intents.every(({ match_kind: matchKind }) =>
      matchKind === "partial_match");
  if (result.evaluated_intent_count !== result.catalog_intent_count ||
      result.returned_count !== result.intents.length ||
      result.omitted_count !== result.total_match_count - result.returned_count ||
      result.truncated !== (result.omitted_count > 0) ||
      (result.status === "no_match") !== expectedNoMatch ||
      (result.status === "partial_match") !== expectedPartial ||
      (result.mode === "list" && (
        result.query !== null || result.result_limit !== null || result.truncated ||
        result.returned_count !== result.catalog_intent_count
      )) ||
      (result.mode === "search" && (
        result.query === null || result.result_limit === null
      ))) {
    throw new ProofIntentDiscoveryError(
      "proof_intent_discovery_result_inconsistent",
      "proof-intent discovery produced internally inconsistent scan or limit facts"
    );
  }
}

function canonicalProofIntentDiscoveryJson(result) {
  if (!validateProofIntentDiscoveryResult(result)) {
    throw new ProofIntentDiscoveryError(
      "proof_intent_discovery_result_invalid",
      "canonical serialization requires a schema-valid proof-intent discovery result",
      { diagnostics: structuredClone(validateProofIntentDiscoveryResult.errors) }
    );
  }
  assertResultSemantics(result);
  const bytes = canonicalJsonBytes(result, { file: true });
  if (bytes.byteLength > MAX_DISCOVERY_RESULT_BYTES) {
    throw new ProofIntentDiscoveryError(
      "proof_intent_discovery_result_too_large",
      "proof-intent discovery result exceeds the declared UTF-8 byte limit",
      { byte_length: bytes.byteLength, maximum_bytes: MAX_DISCOVERY_RESULT_BYTES }
    );
  }
  return bytes.toString("utf8");
}

function discoverProofIntents(options, ...unexpectedArguments) {
  const request = prepareRequest(validateOptions(options, unexpectedArguments));
  const evaluated = PROOF_INTENT_DISCOVERY_CATALOG.intents.map((intent) => {
    const match = request.mode === "list" ? null :
      searchIntent(intent, request.queryTerms);
    return request.mode === "list" ? summarizeIntent(intent, null) :
      match === null ? null : summarizeIntent(intent, match);
  });
  const overlaps = evaluated.filter((value) => value !== null);
  const exactMatches = overlaps.filter(({ match_kind: matchKind }) =>
    matchKind === "exact_match");
  const matches = request.mode === "list" ? overlaps :
    exactMatches.length > 0 ? exactMatches : overlaps;
  const returned = request.mode === "list" ? matches : matches.slice(0, request.limit);
  const status = request.mode === "list" || exactMatches.length > 0 ? "match" :
    matches.length > 0 ? "partial_match" : "no_match";
  const result = canonicalValue({
    schema_version: "controlled-contract-proof-intent-discovery.v1",
    mode: request.mode,
    query: request.query,
    status,
    guidance: guidanceFor(request.mode === "list" ? "list" : status),
    catalog_intent_count: PROOF_INTENT_DISCOVERY_CATALOG.intents.length,
    evaluated_intent_count: evaluated.length,
    total_match_count: matches.length,
    returned_count: returned.length,
    omitted_count: matches.length - returned.length,
    truncated: returned.length < matches.length,
    result_limit: request.limit,
    intents: returned,
    catalog_digest: PROOF_INTENT_DISCOVERY_CATALOG_DIGEST,
    selection_performed: false,
    pack_invocation_performed: false,
    pack_admission_performed: false,
    authority: "non_authoritative"
  });
  if (!validateProofIntentDiscoveryResult(result)) {
    throw new ProofIntentDiscoveryError(
      "proof_intent_discovery_result_invalid",
      "proof-intent discovery produced a schema-invalid typed result",
      { diagnostics: structuredClone(validateProofIntentDiscoveryResult.errors) }
    );
  }
  assertResultSemantics(result);
  canonicalProofIntentDiscoveryJson(result);
  return deepFreeze(structuredClone(result));
}

export {
  MAX_DISCOVERY_QUERY_BYTES,
  MAX_DISCOVERY_RESULT_BYTES,
  MAX_DISCOVERY_RETURNED_INTENTS,
  PROOF_INTENT_DISCOVERY_CATALOG,
  PROOF_INTENT_DISCOVERY_CATALOG_DIGEST,
  ProofIntentDiscoveryError,
  canonicalProofIntentDiscoveryJson,
  discoverProofIntents,
  normalizeProofIntentDiscoveryCatalog,
  normalizeSearchText,
  validateProofIntentCatalog,
  validateProofIntentDiscoveryResult
};
