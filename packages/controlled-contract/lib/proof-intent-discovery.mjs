import { readFileSync } from "node:fs";

import { discoveryLimitation, discoverySourceIdentity } from "./proof-discovery-scope.mjs";

import { compiledValidatorCacheAvailability, packagedCompiledValidators }
  from "./compiled-validator-cache.mjs";
import {
  PROOF_INTENT_DISCOVERY_RESULT_VALIDATOR,
  ProofIntentDiscoveryError,
  assertPackagedProofIntentMetadata,
  deriveProofIntentDiscovery,
  packagedDiscovery,
  normalizeProofIntentDiscoveryCatalog,
  normalizeSearchText,
  readPackagedProofIntentMetadata,
  validateProofIntentCatalog
} from "./proof-intent-metadata.mjs";
import { TEST_PROOF_PROVIDER_AUTHORING_FACTS } from "./test-proof-provider-registry.mjs";
import {
  canonicalDigest,
  canonicalJsonBytes,
  canonicalValue,
  compareCodeUnits,
  deepFreeze
} from "./deterministic-projection-primitives.mjs";

const MAX_DISCOVERY_QUERY_BYTES = 1_024;

const MAX_DISCOVERY_RESULT_BYTES = null;
const MAX_DISCOVERY_RETURNED_INTENTS = 256;

const PROOF_INTENT_DISCOVERY_QUERY_POLICY = deepFreeze({
  measurement: "utf8_bytes",
  maximum_bytes: MAX_DISCOVERY_QUERY_BYTES,
  accepted_form: `nonempty query text of at most ${MAX_DISCOVERY_QUERY_BYTES} UTF-8 bytes`
});

function sortedUnique(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}

function truncateUtf8(value, maximumBytes) {
  let result = "";
  let byteLength = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (byteLength + characterBytes > maximumBytes) break;
    result += character;
    byteLength += characterBytes;
  }
  return result;
}

function smallerDiscoveryQuery(query) {
  const normalized = normalizeSearchText(query);
  const candidate = normalized.length === 0 ? "proof" : normalized;
  return truncateUtf8(candidate, MAX_DISCOVERY_QUERY_BYTES);
}

function proofIntentDiscoveryQueryCause(query, { limit = null } = {}) {
  const byteLength = typeof query === "string"
    ? Buffer.byteLength(query, "utf8")
    : null;
  return deepFreeze({
    field: "query",
    cause: "proof_intent_discovery_query_too_large",
    measurement: PROOF_INTENT_DISCOVERY_QUERY_POLICY.measurement,
    byte_length: byteLength,
    maximum_bytes: MAX_DISCOVERY_QUERY_BYTES,
    rejected_query: "[bounded-oversized-query]",
    replacement_call: {
      tool: "workspace_controlled_proof_intents_discover",
      arguments: {
        query: smallerDiscoveryQuery(String(query ?? "")),
        ...(Number.isSafeInteger(limit) ? { limit } : {})
      }
    }
  });
}

function isProofIntentDiscoveryQueryWithinLimit(query) {
  return typeof query === "string" &&
    Buffer.byteLength(query, "utf8") <= MAX_DISCOVERY_QUERY_BYTES;
}

const packagedMetadata = readPackagedProofIntentMetadata();
const PROOF_INTENT_DISCOVERY_CATALOG = deepFreeze(structuredClone(packagedMetadata.discovery.catalog));
const PROOF_INTENT_DISCOVERY_CATALOG_DIGEST = packagedMetadata.discovery.catalog_digest;

const PROOF_VERIFICATION_CAPABILITIES = deepFreeze(structuredClone(
  packagedMetadata.discovery.verification_capabilities));
if (compiledValidatorCacheAvailability().available) {
  assertPackagedProofIntentMetadata("discovery", packagedMetadata.discovery,
    packagedDiscovery(await deriveProofIntentDiscovery()));
}
const { validateProofIntentDiscoveryResult } = await packagedCompiledValidators(
  PROOF_INTENT_DISCOVERY_RESULT_VALIDATOR.groupId,
  PROOF_INTENT_DISCOVERY_RESULT_VALIDATOR.declaration,
  PROOF_INTENT_DISCOVERY_RESULT_VALIDATOR.directory,
  { rebuildCommand: PROOF_INTENT_DISCOVERY_RESULT_VALIDATOR.rebuildCommand });
const discoveryPopulation = Object.freeze({
  population: deepFreeze(structuredClone(packagedMetadata.discovery.population)),
  sourceIdentity: deepFreeze(structuredClone(packagedMetadata.discovery.source_identity)),

  currentSourceIdentity: discoverySourceIdentity(PROOF_INTENT_DISCOVERY_CATALOG,
    JSON.parse(readFileSync(new URL("../profiles/catalog.json", import.meta.url), "utf8")))
});

function proofVerificationCapability(proofName) {
  return PROOF_VERIFICATION_CAPABILITIES[proofName] ?? null;
}

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
    !["query", "limit", "proof_name"].includes(key));
  if (unsupported.length > 0) throw new ProofIntentDiscoveryError(
    "proof_intent_discovery_option_unsupported",
    "proof-intent discovery accepts only query and search-result limit options",
    { unsupported_options: unsupported.map(String).sort(compareCodeUnits) }
  );
  return options;
}

function prepareRequest(options) {
  if (Object.hasOwn(options, "proof_name")) {
    if (Object.keys(options).length !== 1 || typeof options.proof_name !== "string" || !options.proof_name.length)
      throw new ProofIntentDiscoveryError("proof_discovery_identity_invalid", "exact name lookup accepts only proof_name");
    return { mode: "detail", proofName: options.proof_name, query: null, queryTerms: null, limit: null };
  }
  const hasQuery = Object.hasOwn(options, "query");
  const hasLimit = Object.hasOwn(options, "limit");
  const limit = hasLimit ? options.limit : null;
  if (hasLimit && (!Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_DISCOVERY_RETURNED_INTENTS)) {
    throw new ProofIntentDiscoveryError(
      "proof_intent_discovery_limit_invalid",
      `result limit must be an integer from 1 through ${MAX_DISCOVERY_RETURNED_INTENTS}`
    );
  }
  if (!hasQuery) {
    return { mode: "list", query: null, queryTerms: null, limit };
  }
  if (typeof options.query !== "string" || options.query.length === 0) {
    throw new ProofIntentDiscoveryError(
      "proof_intent_discovery_query_invalid",
      "search mode requires nonempty query text"
    );
  }
  if (!isProofIntentDiscoveryQueryWithinLimit(options.query)) throw new ProofIntentDiscoveryError(
    "proof_intent_discovery_query_too_large",
    "proof-intent discovery query exceeds the declared UTF-8 byte limit",
    proofIntentDiscoveryQueryCause(options.query, { limit })
  );
  const normalizedText = normalizeSearchText(options.query);
  if (normalizedText.length === 0) throw new ProofIntentDiscoveryError(
    "proof_intent_discovery_query_invalid",
    "search query must contain at least one letter or number after normalization"
  );
  const queryTerms = sortedUnique(normalizedText.split(" "));
  const searchLimit = limit ?? MAX_DISCOVERY_RETURNED_INTENTS;
  return {
    mode: "search",
    query: { normalized_text: queryTerms.join(" "), terms: queryTerms },
    queryTerms,
    limit: searchLimit
  };
}

function searchableSources(candidate) {
  return [
    { source: "assertion", source_value: candidate.assertion },
    ...candidate.constraints.map(clause => ({ source: "constraint", source_value:
      JSON.stringify(clause) })),
    ...candidate.refinements.map(value => ({ source: "constraint", source_value: JSON.stringify(value) })),
    ...candidate.exclusions.map(source_value => ({ source: "exclusion", source_value })),
    { source: "name", source_value: candidate.proof_name.slice("proof.".length) },
    ...candidate.intents.flatMap(intent => [
      { source: "intent_id", source_value: intent.intent_id.replace(/^controlled-proof-intent\./u, "") },
      { source: "definition", source_value: intent.definition },
      ...intent.discovery_terms.map(source_value => ({ source: "discovery_term", source_value }))
    ])
  ];
}

const SOURCE_WEIGHTS = Object.freeze({ assertion: 2, definition: 2, constraint: 2,
  name: 1, intent_id: 1, discovery_term: 1, exclusion: 0 });
const SEMANTIC_SOURCES = Object.freeze(["assertion", "constraint", "definition"]);
const RELEVANCE_SCORE_SCALE = 1_000;

function createProofIntentSearchIndex(population) {
  const indexedSourceTokens = population.map(candidate => {
    const tokens = new Map();
    for (const { source, source_value: value } of searchableSources(candidate)) {
      if (!tokens.has(source)) tokens.set(source, new Set());
      for (const token of normalizeSearchText(value).split(" ")) tokens.get(source).add(token);
    }
    return tokens;
  });
  const indexedDocumentFrequency = new Map();
  for (const tokens of indexedSourceTokens) for (const [source, values] of tokens) {
    for (const token of values) {
      const key = `${source}\u0000${token}`;
      indexedDocumentFrequency.set(key, (indexedDocumentFrequency.get(key) ?? 0) + 1);
    }
  }
  return { populationSize: population.length, sourceTokens: indexedSourceTokens,
    documentFrequency: indexedDocumentFrequency };
}
const productionSearchIndex = createProofIntentSearchIndex(discoveryPopulation.population);
const inverseDocumentFrequency = (searchIndex, source, term) => Math.log(
  searchIndex.populationSize / searchIndex.documentFrequency.get(`${source}\u0000${term}`));

const PROVIDER_TERM_FAMILIES = new Map();
for (const family of TEST_PROOF_PROVIDER_AUTHORING_FACTS) {
  for (const term of family.identity_terms.map(normalizeSearchText)) {
    if (term.length === 0 || term.includes(" ")) continue;
    PROVIDER_TERM_FAMILIES.set(term, sortedUnique([...(PROVIDER_TERM_FAMILIES.get(term) ?? []),
      family.family_id]));
  }
}

function providerContext(queryTerms) {
  const providerTerms = (queryTerms ?? []).filter(term => PROVIDER_TERM_FAMILIES.has(term));
  const families = providerTerms.length === 0 ? [] : providerTerms
    .map(term => PROVIDER_TERM_FAMILIES.get(term))
    .reduce((left, right) => left.filter(family => right.includes(family)));
  return {
    status: providerTerms.length === 0 ? "unspecified" : families.length === 1 ? "identified" :
      families.length === 0 ? "conflicting" : "ambiguous",
    provider_terms: providerTerms,
    families
  };
}

function searchCandidate(candidate, index, queryTerms, providerTerms, searchIndex) {
  const propertyTerms = queryTerms.filter(term => !providerTerms.includes(term));
  const reasons = searchableSources(candidate).map(source => ({ ...source,
    matched_terms: propertyTerms.filter(term => normalizeSearchText(source.source_value).split(" ").includes(term))
  })).filter(source => source.matched_terms.length);
  const semantic = sortedUnique(reasons.filter(x => SEMANTIC_SOURCES.includes(x.source))
    .flatMap(x => x.matched_terms));
  const matched = sortedUnique(reasons.flatMap(x => x.matched_terms));
  if (!matched.length) return null;
  let score = 0;
  for (const term of matched) for (const [source, tokens] of searchIndex.sourceTokens[index]) {
    if (tokens.has(term)) score += SOURCE_WEIGHTS[source] *
      inverseDocumentFrequency(searchIndex, source, term);
  }
  return { match_kind: semantic.length === propertyTerms.length ? "assertion_match" :
    semantic.length ? "partial_assertion_match" : "navigation_or_exclusion_match",
    relevance_score: Math.round(score * RELEVANCE_SCORE_SCALE),
    matched_terms: matched, unmatched_terms: propertyTerms.filter(term => !matched.includes(term)),
    provider_terms: providerTerms, semantic_terms: semantic, match_reasons: reasons };
}

function rankProofIntentCandidates(population, { queryTerms, providerTerms = [], limit = null,
  searchIndex = createProofIntentSearchIndex(population) }) {
  const matches = population.map((candidate, index) => {
    const ranking = searchCandidate(candidate, index, queryTerms, providerTerms, searchIndex);
    if (ranking === null) return null;
    const { intents, ...scope } = candidate;
    return { ...scope, matching_assertion: scope.assertion,
      essential_limitation: discoveryLimitation(scope, queryTerms, normalizeSearchText),
      ranking, associations: intents.map(intent => intent.intent_id) };
  }).filter(Boolean);
  const tiers = { assertion_match: 0, partial_assertion_match: 1,
    navigation_or_exclusion_match: 2 };
  matches.sort((left, right) => tiers[left.ranking.match_kind] - tiers[right.ranking.match_kind] ||
    right.ranking.relevance_score - left.ranking.relevance_score || compareCodeUnits(left.id, right.id));
  return limit === null ? matches : matches.slice(0, limit);
}

function assertResultSemantics(result) {
  if (result.returned_count !== result.candidates.length ||
      result.omitted_count !== result.total_match_count - result.returned_count ||
      result.truncated !== (result.omitted_count > 0) ||
      new Set(result.candidates.map(x => x.id)).size !== result.candidates.length ||
      (result.status === "no_match") !== (result.total_match_count === 0)) {
    throw new ProofIntentDiscoveryError("proof_intent_discovery_result_inconsistent",
      "discovery population accounting is inconsistent");
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
  return bytes.toString("utf8");
}

function discoverProofIntentsInternal(options, unexpectedArguments, { completeSearch }) {
  const prepared = prepareRequest(validateOptions(options, unexpectedArguments));
  const request = completeSearch && prepared.mode === "search"
    ? { ...prepared, limit: null } : prepared;
  const population = discoveryPopulation;
  const current = population.currentSourceIdentity();
  if (canonicalDigest(current) !== canonicalDigest(population.sourceIdentity)) {
    throw new ProofIntentDiscoveryError("proof_discovery_source_changed",
      "The loaded discovery definitions changed; reload the package/server before fresh discovery.",
      { changed: false, source_identity: current });
  }
  const provider = providerContext(request.queryTerms);
  const propertySearch = request.mode === "search" &&
    provider.provider_terms.length < request.queryTerms.length;
  let matches = propertySearch ? rankProofIntentCandidates(population.population, {
    queryTerms: request.queryTerms,
    providerTerms: provider.provider_terms,
    limit: null,
    searchIndex: productionSearchIndex
  }) : population.population.map(candidate => {
    const ranking = request.mode === "search" ? null :
      { match_kind: "catalog_entry", relevance_score: 0, matched_terms: [], unmatched_terms: [],
        provider_terms: [], semantic_terms: [], match_reasons: [] };
    if (!ranking || request.mode === "detail" && candidate.proof_name !== request.proofName) return null;
    const { intents, ...scope } = candidate;
    return { ...scope, matching_assertion: scope.assertion,
      essential_limitation: discoveryLimitation(scope, request.queryTerms ?? [], normalizeSearchText),
      ranking, associations: intents.map(x => x.intent_id) };
  }).filter(Boolean);
  if (request.mode === "detail" && matches.length !== 1) throw new ProofIntentDiscoveryError(
    matches.length ? "proof_discovery_identity_ambiguous" : "proof_discovery_identity_unknown",
    "proof_name must resolve exactly one admitted candidate", { proof_name: request.proofName });
  const tiers = { catalog_entry: 0, assertion_match: 0, partial_assertion_match: 1, navigation_or_exclusion_match: 2 };
  matches.sort((a, b) => tiers[a.ranking.match_kind] - tiers[b.ranking.match_kind] ||
    b.ranking.relevance_score - a.ranking.relevance_score || compareCodeUnits(a.id, b.id));
  const candidates = request.limit === null ? matches : matches.slice(0, request.limit);
  const result = canonicalValue({
    schema_version: "controlled-contract-proof-intent-discovery.v1",
    mode: request.mode, query: request.query,
    status: matches.length ? "match" : "no_match",
    catalog_intent_count: PROOF_INTENT_DISCOVERY_CATALOG.intents.length,
    evaluated_intent_count: PROOF_INTENT_DISCOVERY_CATALOG.intents.length,
    candidate_count: population.population.length,
    total_match_count: matches.length, returned_count: candidates.length,
    omitted_count: matches.length - candidates.length,
    truncated: candidates.length < matches.length, result_limit: request.limit,
    provider_context: provider,
    candidates, source_identity: population.sourceIdentity,
    catalog_digest: PROOF_INTENT_DISCOVERY_CATALOG_DIGEST,
    selection_performed: false, pack_invocation_performed: false,
    pack_admission_performed: false, authority: "non_authoritative"
  });
  canonicalProofIntentDiscoveryJson(result);
  return deepFreeze(result);
}

function discoverProofIntents(options, ...unexpectedArguments) {
  return discoverProofIntentsInternal(options, unexpectedArguments, { completeSearch: false });
}

function discoverCompleteProofIntents(options, ...unexpectedArguments) {
  return discoverProofIntentsInternal(options, unexpectedArguments, { completeSearch: true });
}

export {
  MAX_DISCOVERY_QUERY_BYTES,
  MAX_DISCOVERY_RESULT_BYTES,
  MAX_DISCOVERY_RETURNED_INTENTS,
  PROOF_INTENT_DISCOVERY_CATALOG,
  PROOF_INTENT_DISCOVERY_CATALOG_DIGEST,
  PROOF_INTENT_DISCOVERY_QUERY_POLICY,
  PROOF_VERIFICATION_CAPABILITIES,
  ProofIntentDiscoveryError,
  canonicalProofIntentDiscoveryJson,
  discoverCompleteProofIntents,
  discoverProofIntents,
  isProofIntentDiscoveryQueryWithinLimit,
  normalizeProofIntentDiscoveryCatalog,
  normalizeSearchText,
  proofIntentDiscoveryQueryCause,
  proofVerificationCapability,
  rankProofIntentCandidates,
  validateProofIntentCatalog,
  validateProofIntentDiscoveryResult
};
