import {
  ExactBindingError,
  canonicalDigest,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  parseCanonicalDocument,
  sha256,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";
import {
  POLICY_VERSION,
  UNIT_CLASSES,
  assertPolicy
} from "./declared-boundary-record-consistency.mjs";
import { GRAPH_VERSION } from "./projected-contract-graph.mjs";

const TRANSFORMER_ID = "declared-limit-guidance-propagation.v1";
const REPORT_VERSION = "controlled-contract.declared-limit-guidance-propagation-report.v1";
const FACT_KEYS = Object.freeze([
  "association-population-complete",
  "guidance-single-surface-exact",
  "policy-key-population-complete",
  "policy-well-formed",
  "report-source-set-bound"
]);
const POPULATION_REFERENCES = Object.freeze({
  "declared-limits": "ref-lgp-declared-limit-population",
  "guidance-associations": "ref-lgp-guidance-association-population",
  "guidance-surfaces": "ref-lgp-guidance-surface-population",
  "measurement-units": "ref-lgp-measurement-unit-population",
  "policy-keys": "ref-lgp-policy-key-population"
});

function fail(code, message, details = {}) {
  throw new ExactBindingError(code, message, details);
}
function exactKeys(value, required) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === required.length && required.every((key) =>
      Object.hasOwn(value, key));
}
function referenceId(prefix, value) {
  return `ref-${prefix}-${sha256(canonicalJsonBytes(value))}`;
}
function decodeUtf8(bytes) {
  const buffer = Buffer.from(bytes);
  const text = buffer.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buffer) || text.includes("\0")) fail(
    "guidance_artifact_encoding_invalid",
    "guidance artifact must be well-formed UTF-8 without NUL"
  );
  return text;
}

const ASCII_NUMBER = /(?<![\p{L}\p{N}_.-])[0-9]+(?![\p{L}\p{N}_.-])/gu;
const ASSOCIATION_LINE = /(?:^|\n)[\t ]*(.+?)[\t ]*[:=][\t ]*([0-9]+)[\t ]+([\p{L}\p{N}_.-]+)[\t ]*[;,.]?[\t ]*(?=\n|$)/gu;

function parseAssociations(text) {
  const associations = [];
  const coveredNumberSpans = [];
  for (const match of text.matchAll(ASSOCIATION_LINE)) {
    const key = match[1].trim().normalize("NFC");
    const numeral = match[2];
    const unit = match[3].normalize("NFC");
    const numberOffset = match.index + match[0].indexOf(numeral);
    coveredNumberSpans.push([numberOffset, numberOffset + numeral.length]);
    associations.push({ key, numeral, unit, offset: match.index });
  }
  for (const match of text.matchAll(ASCII_NUMBER)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!coveredNumberSpans.some(([left, right]) => left === start && right === end)) fail(
      "guidance_unrelated_number",
      "every plain decimal numeral must belong to one exact policy association",
      { numeral: match[0], offset: start }
    );
  }
  return associations;
}

function sourceSetDigest(sourceContentSha256) {
  return sha256(canonicalJsonBytes({
    source_content_sha256: sourceContentSha256,
    transformer_id: TRANSFORMER_ID
  }));
}

function deriveReport(limits, guidanceBytes, digests) {
  const guidance = decodeUtf8(guidanceBytes).normalize("NFC");
  const parsed = parseAssociations(guidance);
  const limitByKey = new Map(limits.map((limit) => [limit.limit_key, limit]));
  for (const occurrence of parsed) {
    if (!limitByKey.has(occurrence.key)) fail(
      "guidance_substituted_policy_key",
      "guidance association names a policy key absent from the exact declared policy",
      { key: occurrence.key }
    );
  }
  const associations = [];
  for (const limit of limits) {
    const occurrences = parsed.filter(({ key }) => key === limit.limit_key);
    if (occurrences.length === 0) fail(
      "guidance_policy_key_missing", "guidance omits a required declared policy key",
      { limit_key: limit.limit_key }
    );
    if (occurrences.length > 1) fail(
      occurrences.some(({ numeral, unit }) =>
        numeral !== String(limit.limit_value) || unit !== limit.unit)
        ? "guidance_policy_key_conflicting" : "guidance_policy_key_duplicate",
      "guidance must contain exactly one association per declared policy key",
      { limit_key: limit.limit_key }
    );
    const occurrence = occurrences[0];
    if (occurrence.numeral !== String(limit.limit_value)) fail(
      "guidance_policy_value_stale",
      "guidance decimal value differs from the exact declared policy value",
      { limit_key: limit.limit_key, expected: String(limit.limit_value), actual: occurrence.numeral }
    );
    if (occurrence.unit !== limit.unit || !Object.hasOwn(UNIT_CLASSES, occurrence.unit)) fail(
      "guidance_policy_unit_mismatch",
      "guidance unit token differs from the exact declared policy unit",
      { limit_key: limit.limit_key, expected: limit.unit, actual: occurrence.unit }
    );
    associations.push({
      association_reference_id: referenceId("lgp-association", limit.limit_key),
      decimal_value: occurrence.numeral,
      limit_key: limit.limit_key,
      limit_reference_id: referenceId("lgp-limit", limit.limit_key),
      policy_key_reference_id: referenceId("lgp-key", limit.limit_key),
      unit: limit.unit,
      unit_reference_id: referenceId("lgp-unit", {
        measurement_class: limit.measurement_class, unit: limit.unit
      })
    });
  }
  const source_content_sha256 = {
    declared_policy: digests.declaredPolicy,
    guidance_artifact: digests.guidanceArtifact
  };
  const source_set_sha256 = sourceSetDigest(source_content_sha256);
  const projectedLimits = limits.map((limit) => ({
    ...structuredClone(limit),
    limit_reference_id: referenceId("lgp-limit", limit.limit_key),
    policy_key_reference_id: referenceId("lgp-key", limit.limit_key),
    unit_reference_id: referenceId("lgp-unit", {
      measurement_class: limit.measurement_class, unit: limit.unit
    })
  }));
  const surface = "ref-lgp-guidance-surface";
  const populations = {
    "declared-limits": projectedLimits.map(({ limit_reference_id: id }) => id)
      .sort(compareCodeUnits),
    "guidance-associations": associations.map(({ association_reference_id: id }) => id)
      .sort(compareCodeUnits),
    "guidance-surfaces": [surface],
    "measurement-units": [...new Set(projectedLimits.map(({ unit_reference_id: id }) => id))]
      .sort(compareCodeUnits),
    "policy-keys": projectedLimits.map(({ policy_key_reference_id: id }) => id)
      .sort(compareCodeUnits)
  };
  return {
    schema_version: REPORT_VERSION,
    transformer_id: TRANSFORMER_ID,
    source_set_sha256,
    source_content_sha256,
    facts: FACT_KEYS.map((fact_key) => ({ fact_key, satisfied: true, source_set_sha256 })),
    limits: projectedLimits,
    associations,
    populations,
    counts: Object.fromEntries(Object.entries(populations).map(([key, members]) => [key, members.length]))
  };
}

function parseSources(sourceBytes) {
  if (sourceBytes.length !== 2) fail(
    "guidance_source_set_invalid", "guidance projection requires one policy and one raw artifact"
  );
  const policyBytes = Buffer.from(sourceBytes[0]);
  const guidanceBytes = Buffer.from(sourceBytes[1]);
  const policyValue = parseCanonicalDocument(policyBytes, "declared policy source");
  if (policyValue?.schema_version !== POLICY_VERSION) fail(
    "guidance_source_role_mismatch",
    "the first guidance projection source slot must contain the declared policy"
  );
  decodeUtf8(guidanceBytes);
  return [{
    kind: "policy", limits: assertPolicy(policyValue), digest: sha256(policyBytes)
  }, {
    kind: "guidance", bytes: guidanceBytes, digest: sha256(guidanceBytes)
  }];
}

function transform(sourceValues) {
  const policy = sourceValues.find(({ kind }) => kind === "policy");
  const guidance = sourceValues.find(({ kind }) => kind === "guidance");
  return deriveReport(policy.limits, guidance.bytes, {
    declaredPolicy: policy.digest, guidanceArtifact: guidance.digest
  });
}

function assertResult(value) {
  if (!exactKeys(value, [
    "associations", "counts", "facts", "limits", "populations", "schema_version",
    "source_content_sha256", "source_set_sha256", "transformer_id"
  ]) || value.schema_version !== REPORT_VERSION || value.transformer_id !== TRANSFORMER_ID ||
      !/^[0-9a-f]{64}$/u.test(value.source_set_sha256) ||
      !exactKeys(value.source_content_sha256, ["declared_policy", "guidance_artifact"]) ||
      sourceSetDigest(value.source_content_sha256) !== value.source_set_sha256 ||
      JSON.stringify(value.facts) !== JSON.stringify(FACT_KEYS.map((fact_key) => ({
        fact_key, satisfied: true, source_set_sha256: value.source_set_sha256
      }))) || !Array.isArray(value.limits) || !Array.isArray(value.associations) ||
      !exactKeys(value.populations, Object.keys(POPULATION_REFERENCES)) ||
      !exactKeys(value.counts, Object.keys(POPULATION_REFERENCES))) fail(
    "guidance_report_invalid", "guidance projection result has an invalid closed shape"
  );
  for (const [name, members] of Object.entries(value.populations)) {
    if (!Array.isArray(members) || !sortedUnique(members) || value.counts[name] !== members.length) {
      fail("guidance_report_population_invalid",
        "guidance report population and count must be complete and canonical", { population: name });
    }
  }
  return deepFreeze(value);
}

const ref = (reference_id) => ({ kind: "reference", reference_id });
const num = (value) => ({ kind: "number", value });
const context = { mode: "unconditional", operand_reference_ids: [] };
function durable(reference_id, type_term, domain, value) {
  return { reference_id, type_term, identity: { kind: "durable_id", domain, value } };
}
function addClaim(state, id, subject, operator, operands, kind = "evidence", extras = {}) {
  const proposition_id = `prop-${id}`;
  state.propositions.push({
    proposition_id, subject_reference_id: subject, operator,
    applicability_context: structuredClone(context), operands: structuredClone(operands)
  });
  const claim_id = `claim-${id}`;
  state.claims.push({ claim_id, kind, modality: "MUST", proposition_id, ...extras });
  return claim_id;
}
function addPopulation(state, name, members) {
  const population = POPULATION_REFERENCES[name];
  state.references.push(durable(population, "cc:population",
    "controlled-contract:guidance-population:v1", name));
  if (members.length > 0) addClaim(state, `${name}-members`, population,
    "reference:contains", members.map(ref));
  addClaim(state, `${name}-cardinality`, population, "number:has_cardinality", [num(members.length)]);
}

function guidanceGraph(report) {
  const state = { references: [], propositions: [], claims: [], relations: [], collections: [] };
  const fixed = {
    subject: "ref-lgp-guidance-subject", policy: "ref-lgp-policy-artifact",
    guidance: "ref-lgp-guidance-artifact", report: "ref-lgp-propagation-report",
    verification: "ref-lgp-verification",
    condition: "ref-lgp-mismatch-condition"
  };
  state.references.push(
    durable(fixed.subject, "cc:process", "controlled-contract:guidance-subject:v1", TRANSFORMER_ID),
    durable(fixed.policy, "cc:artifact", "controlled-contract:guidance-policy-source:v1",
      report.source_content_sha256.declared_policy),
    durable(fixed.guidance, "cc:artifact", "controlled-contract:guidance-source:v1",
      report.source_content_sha256.guidance_artifact),
    durable(fixed.report, "cc:evidence", "controlled-contract:guidance-report:v1",
      report.source_set_sha256),
    durable(fixed.verification, "cc:test", "controlled-contract:guidance-verifier:v1", TRANSFORMER_ID),
    durable(fixed.condition, "cc:state", "controlled-contract:guidance-condition:v1", "mismatch"),
    durable("ref-lgp-guidance-surface", "cc:artifact", "controlled-contract:guidance-surface:v1",
      report.source_content_sha256.guidance_artifact)
  );
  for (const limit of report.limits) {
    state.references.push(
      durable(limit.limit_reference_id, "cc:criterion", "controlled-contract:declared-limit:v1",
        limit.limit_key),
      durable(limit.policy_key_reference_id, "cc:configuration", "controlled-contract:policy-key:v1",
        limit.limit_key)
    );
    if (!state.references.some(({ reference_id: id }) => id === limit.unit_reference_id)) {
      state.references.push(durable(limit.unit_reference_id, "cc:configuration",
        "controlled-contract:measurement-unit:v1", `${limit.unit}:${limit.measurement_class}`));
    }
    addClaim(state, `limit-unit-${limit.limit_reference_id.slice(4)}`,
      limit.limit_reference_id, "reference:resolves_to", [ref(limit.unit_reference_id)]);
    addClaim(state, `key-limit-${limit.policy_key_reference_id.slice(4)}`,
      limit.policy_key_reference_id, "reference:resolves_to", [ref(limit.limit_reference_id)]);
  }
  for (const association of report.associations) {
    state.references.push(durable(association.association_reference_id, "cc:evidence_occurrence",
      "controlled-contract:guidance-association:v1", association.limit_key));
    addClaim(state, `association-limit-${association.association_reference_id.slice(4)}`,
      association.association_reference_id, "reference:targets",
      [ref(association.limit_reference_id)]);
  }
  for (const [name, members] of Object.entries(report.populations)) addPopulation(state, name, members);
  addClaim(state, "policy-contains-limits", fixed.policy, "reference:contains",
    [ref(POPULATION_REFERENCES["declared-limits"])]);
  addClaim(state, "policy-contains-units", fixed.policy, "reference:contains",
    [ref(POPULATION_REFERENCES["measurement-units"])]);
  addClaim(state, "guidance-contains-associations", fixed.guidance, "reference:contains",
    [ref(POPULATION_REFERENCES["guidance-associations"])]);
  addClaim(state, "guidance-contains-keys", fixed.guidance, "reference:contains",
    [ref(POPULATION_REFERENCES["policy-keys"])]);
  const target = addClaim(state, "report-is-propagated", fixed.report, "boolean:exists",
    [{ kind: "boolean", value: true }], "behavior");
  const verification = addClaim(state, "verify-report-is-propagated", fixed.verification,
    "reference:reads", [fixed.policy, fixed.guidance, fixed.report].map(ref),
    "verification", {
      verification_method: "audit", falsifying_proposition_id: "prop-report-not-propagated"
    });
  state.propositions.push({
    proposition_id: "prop-report-not-propagated", subject_reference_id: fixed.report,
    operator: "boolean:exists", applicability_context: structuredClone(context),
    operands: [{ kind: "boolean", value: false }]
  });
  state.relations.push({
    relation_id: "rel-verifies-report-propagation", role: "verifies",
    source_claim_id: verification, target_claim_id: target
  });
  for (const key of ["references", "propositions", "claims", "relations"]) state[key].sort(
    (a, b) => compareCodeUnits(a[`${key.slice(0, -1)}_id`], b[`${key.slice(0, -1)}_id`])
  );
  return { schema_version: GRAPH_VERSION, ...state };
}

function reportReference(report) {
  const reference = guidanceGraph(report).references.find(
    ({ reference_id: id }) => id === "ref-lgp-propagation-report"
  );
  return {
    grounded_identity_sha256: canonicalDigest(reference.identity),
    reference_id: reference.reference_id,
    type_term: reference.type_term
  };
}

const DECLARED_LIMIT_GUIDANCE_PROPAGATION_TRANSFORMER = Object.freeze({
  transformer_id: TRANSFORMER_ID,
  source_count: 2,
  parse_sources: parseSources,
  transform,
  validate_result: assertResult,
  projections: Object.freeze({
    ...Object.fromEntries(Object.keys(POPULATION_REFERENCES).map((name) => [name, Object.freeze({
      cardinality: "set", project: (report) => report.populations[name]
    })])),
    "report-reference": Object.freeze({ cardinality: "singleton_reference", project: reportReference })
  }),
  graph_projections: Object.freeze({
    "guidance-propagation-contract": Object.freeze({ project: guidanceGraph })
  })
});

function deriveDeclaredLimitGuidancePropagation({ policyBytes, guidanceBytes }) {
  const values = parseSources([policyBytes, guidanceBytes]);
  return canonicalJsonBytes(assertResult(transform(values)), { file: true });
}

export {
  DECLARED_LIMIT_GUIDANCE_PROPAGATION_TRANSFORMER,
  FACT_KEYS,
  POPULATION_REFERENCES,
  REPORT_VERSION,
  TRANSFORMER_ID,
  deriveDeclaredLimitGuidancePropagation,
  guidanceGraph
};
