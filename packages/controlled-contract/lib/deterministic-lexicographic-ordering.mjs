import {
  ExactBindingError,
  canonicalDigest,
  canonicalJsonBytes,
  compareCodeUnits,
  parseCanonicalDocument,
  sha256,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";

const TRANSFORMER_ID = "deterministic-lexicographic-conformance.v1";
const INPUT_VERSION = "controlled-contract.lexicographic-input.v1";
const RESULT_VERSION = "controlled-contract.lexicographic-result.v1";
const POLICY_VERSION = "controlled-contract.lexicographic-policy.v1";
const EVIDENCE_VERSION = "controlled-contract.lexicographic-evidence.v1";
const REPORT_VERSION = "controlled-contract.lexicographic-conformance.v1";
const RESOLVER_KIND = "deterministic-lexicographic-ordering";
const FACT_KEYS = Object.freeze([
  "declaration-order-invariant",
  "distinguishable-items-non-equal",
  "full-result-correct",
  "input-permutation-invariant",
  "item-key-matrix-complete",
  "policy-well-formed",
  "serialization-order-invariant"
]);
const FACT_ARGUMENTS = Object.freeze({
  "declaration-order-invariant": ["input_snapshot", "ordering_policy", "result_snapshot"],
  "distinguishable-items-non-equal": ["input_snapshot", "item_key_evidence", "ordering_policy"],
  "full-result-correct": ["input_snapshot", "item_key_evidence", "ordering_policy", "result_snapshot"],
  "input-permutation-invariant": ["input_snapshot", "ordering_policy", "result_snapshot"],
  "item-key-matrix-complete": ["input_snapshot", "item_key_evidence", "ordering_policy"],
  "policy-well-formed": ["ordering_policy"],
  "serialization-order-invariant": ["input_snapshot", "ordering_policy", "result_snapshot"]
});
const SOURCE_NAMES = Object.freeze([
  "comparator_evidence",
  "input_snapshot",
  "ordering_policy",
  "result_snapshot"
]);
const KEY_TYPES = new Set([
  "boolean", "integer", "numeric", "timestamp", "unicode_scalar"
]);

function fail(code, message, details = {}) {
  throw new ExactBindingError(code, message, details);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) =>
      Object.hasOwn(value, key));
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      value !== value.normalize("NFC")) fail(
    "lexicographic_identifier_invalid",
    "identifiers must be nonempty canonical NFC strings without NUL",
    { field }
  );
}

function assertItemIdentity(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      !value.isWellFormed()) fail(
    "lexicographic_item_identity_invalid",
    "item identities must be nonempty well-formed Unicode strings without NUL", { field }
  );
}

function scalarCompare(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] < rightPoints[index] ? -1 : 1;
    }
  }
  return leftPoints.length < rightPoints.length
    ? -1 : leftPoints.length > rightPoints.length ? 1 : 0;
}

function normalizeUnicode(value, normalization) {
  return normalization === "none" ? value : value.normalize(normalization);
}

function assertNoDuplicateJsonMembers(source, field) {
  let index = 0;
  const whitespace = () => {
    while (/\s/u.test(source[index] ?? "")) index += 1;
  };
  const string = () => {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      if (source[index] === "\"") {
        index += 1;
        return JSON.parse(source.slice(start, index));
      }
      index += 1;
    }
    fail("lexicographic_serialization_permutation_invalid",
      "serialization observation contains an unterminated string", { field });
  };
  const value = () => {
    whitespace();
    if (source[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (source[index] === "}") { index += 1; return; }
      while (index < source.length) {
        const key = string();
        if (keys.has(key)) fail(
          "lexicographic_serialization_duplicate_member",
          "equivalent serialization observations may not contain duplicate object members",
          { field, member: key }
        );
        keys.add(key);
        whitespace();
        index += 1;
        value();
        whitespace();
        if (source[index] === "}") { index += 1; return; }
        index += 1;
        whitespace();
      }
      return;
    }
    if (source[index] === "[") {
      index += 1;
      whitespace();
      if (source[index] === "]") { index += 1; return; }
      while (index < source.length) {
        value();
        whitespace();
        if (source[index] === "]") { index += 1; return; }
        index += 1;
      }
      return;
    }
    if (source[index] === "\"") { string(); return; }
    while (index < source.length && !/[\s,\]}]/u.test(source[index])) index += 1;
  };
  value();
}

function assertKeyDescriptor(key, index) {
  const fields = [
    "collation", "direction", "equality", "extractor", "key_id",
    "normalization", "precedence", "punctuation", "type"
  ];
  if (!exactKeys(key, fields)) fail(
    "lexicographic_policy_key_invalid",
    "each policy key must contain the complete closed descriptor",
    { index }
  );
  assertIdentifier(key.key_id, `keys[${index}].key_id`);
  assertIdentifier(key.extractor, `keys[${index}].extractor`);
  if (!KEY_TYPES.has(key.type) || !Number.isSafeInteger(key.precedence) ||
      key.precedence < 0 || !["ascending", "descending"].includes(key.direction) ||
      key.equality !== "exact_after_normalization" ||
      key.punctuation !== "significant" ||
      !["none", "NFC", "NFD"].includes(key.normalization)) fail(
    "lexicographic_policy_key_invalid",
    "policy key type, precedence, direction, equality, normalization, or punctuation is invalid",
    { key_id: key.key_id }
  );
  const unicode = key.type === "unicode_scalar";
  if (key.collation !== (unicode ? "unicode_scalar" : "exact_typed") ||
      (!unicode && key.normalization !== "none")) fail(
    "lexicographic_policy_key_invalid",
    "collation and normalization must agree with the declared key type",
    { key_id: key.key_id }
  );
  return key;
}

function assertPolicy(value) {
  if (!exactKeys(value, ["comparator_id", "keys", "schema_version", "tie_breaker"]) ||
      value.schema_version !== POLICY_VERSION || !Array.isArray(value.keys) ||
      value.keys.length < 2) fail(
    "lexicographic_policy_invalid",
    "ordering policy must contain a comparator and at least two key descriptors"
  );
  assertIdentifier(value.comparator_id, "comparator_id");
  const keys = value.keys.map(assertKeyDescriptor);
  const keyIds = keys.map(({ key_id: id }) => id);
  const precedences = keys.map(({ precedence }) => precedence).sort((a, b) => a - b);
  if (new Set(keyIds).size !== keyIds.length ||
      precedences.some((precedence, index) => precedence !== index)) fail(
    "lexicographic_policy_precedence_invalid",
    "policy key identities must be unique and precedence must be contiguous from zero"
  );
  const tie = value.tie_breaker;
  if (!exactKeys(tie, [
    "collation", "direction", "equality", "extractor", "normalization",
    "punctuation", "type"
  ]) || tie.type !== "unicode_scalar" || tie.extractor !== "item_id" ||
      !["ascending", "descending"].includes(tie.direction) ||
      tie.equality !== "exact_after_normalization" ||
      tie.collation !== "unicode_scalar" ||
      !["none", "NFC", "NFD"].includes(tie.normalization) ||
      tie.punctuation !== "significant") fail(
    "lexicographic_tie_breaker_invalid",
    "the stable tie-breaker must explicitly compare item_id as Unicode scalars"
  );
  return {
    ...value,
    orderedKeys: [...keys].sort((left, right) => left.precedence - right.precedence)
  };
}

function assertInput(value) {
  if (!exactKeys(value, ["items", "schema_version"]) ||
      value.schema_version !== INPUT_VERSION || !Array.isArray(value.items) ||
      value.items.length < 2 || value.items.some((item) =>
        !exactKeys(item, ["item_id"]))) fail(
    "lexicographic_input_invalid",
    "input snapshot must contain at least two closed item identities"
  );
  const ids = value.items.map(({ item_id: id }, index) => {
    assertItemIdentity(id, `items[${index}].item_id`);
    return id;
  });
  if (new Set(ids).size !== ids.length) fail(
    "lexicographic_input_item_duplicate",
    "declared item identities must be unique"
  );
  return ids;
}

function assertResult(value) {
  if (!exactKeys(value, ["item_ids", "schema_version"]) ||
      value.schema_version !== RESULT_VERSION || !Array.isArray(value.item_ids) ||
      value.item_ids.length < 2) fail(
    "lexicographic_result_invalid",
    "result snapshot must contain the complete ordered item identity sequence"
  );
  for (const [index, id] of value.item_ids.entries()) {
    assertItemIdentity(id, `item_ids[${index}]`);
  }
  if (new Set(value.item_ids).size !== value.item_ids.length) fail(
    "lexicographic_result_item_duplicate",
    "result item identities must be unique"
  );
  return value.item_ids;
}

function assertTypedValue(value, descriptor, field) {
  if (descriptor.type === "numeric") {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(
      "lexicographic_key_value_type_mismatch", "numeric key value is not finite", { field }
    );
    return value;
  }
  if (descriptor.type === "integer") {
    if (!Number.isSafeInteger(value)) fail(
      "lexicographic_key_value_type_mismatch", "integer key value is not a safe integer",
      { field }
    );
    return value;
  }
  if (descriptor.type === "boolean") {
    if (typeof value !== "boolean") fail(
      "lexicographic_key_value_type_mismatch", "Boolean key value is not Boolean", { field }
    );
    return value;
  }
  if (descriptor.type === "timestamp") {
    if (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) fail(
      "lexicographic_key_value_type_mismatch",
      "timestamp key value must use fixed UTC millisecond form", { field }
    );
    const instant = Date.parse(value);
    if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) fail(
      "lexicographic_key_value_type_mismatch", "timestamp key value is invalid", { field }
    );
    return instant;
  }
  if (typeof value !== "string" || value.includes("\0") || !value.isWellFormed()) fail(
    "lexicographic_key_value_type_mismatch",
    "Unicode-scalar key value must be a well-formed Unicode string",
    { field }
  );
  return normalizeUnicode(value, descriptor.normalization);
}

function compareTyped(left, right, descriptor) {
  const normalizedLeft = assertTypedValue(left, descriptor, "left");
  const normalizedRight = assertTypedValue(right, descriptor, "right");
  if (descriptor.type === "unicode_scalar") {
    return scalarCompare(normalizedLeft, normalizedRight);
  }
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function assertEvidence(value, inputIds, policy) {
  if (!exactKeys(value, [
    "comparator_id", "comparator_observations", "declaration_permutations",
    "input_permutations", "item_key_values", "schema_version",
    "serialization_permutations"
  ]) || value.schema_version !== EVIDENCE_VERSION ||
      value.comparator_id !== policy.comparator_id ||
      !Array.isArray(value.item_key_values) ||
      !Array.isArray(value.comparator_observations) ||
      !Array.isArray(value.input_permutations) || value.input_permutations.length === 0 ||
      !Array.isArray(value.declaration_permutations) ||
      value.declaration_permutations.length === 0 ||
      !Array.isArray(value.serialization_permutations) ||
      value.serialization_permutations.length === 0) fail(
    "lexicographic_evidence_invalid",
    "comparator evidence must contain complete matrices and all permutation categories"
  );
  const inputSet = new Set(inputIds);
  const keysById = new Map(policy.keys.map((key) => [key.key_id, key]));
  const matrix = new Map();
  for (const [rowIndex, row] of value.item_key_values.entries()) {
    if (!exactKeys(row, ["item_id", "key_values"]) ||
        !inputSet.has(row.item_id) || matrix.has(row.item_id) ||
        !Array.isArray(row.key_values)) fail(
      "lexicographic_item_key_matrix_invalid",
      "item-key evidence must contain one row per declared item", { row_index: rowIndex }
    );
    const values = new Map();
    for (const [columnIndex, entry] of row.key_values.entries()) {
      if (!exactKeys(entry, ["extractor", "key_id", "value"]) ||
          !keysById.has(entry.key_id) || values.has(entry.key_id) ||
          entry.extractor !== keysById.get(entry.key_id).extractor) fail(
        "lexicographic_item_key_matrix_invalid",
        "item-key evidence must bind every value to its declared key and extractor",
        { row_index: rowIndex, column_index: columnIndex }
      );
      assertTypedValue(entry.value, keysById.get(entry.key_id),
        `item_key_values[${rowIndex}].key_values[${columnIndex}].value`);
      values.set(entry.key_id, entry.value);
    }
    if (values.size !== keysById.size) fail(
      "lexicographic_item_key_matrix_incomplete",
      "every declared item/key combination must be present", { item_id: row.item_id }
    );
    matrix.set(row.item_id, values);
  }
  if (matrix.size !== inputIds.length) fail(
    "lexicographic_item_key_matrix_incomplete",
    "item-key evidence does not cover the complete declared population"
  );
  return { matrix, observations: value.comparator_observations };
}

function comparatorFor(policy, matrix) {
  return (leftId, rightId) => {
    for (const descriptor of policy.orderedKeys) {
      const comparison = compareTyped(
        matrix.get(leftId).get(descriptor.key_id),
        matrix.get(rightId).get(descriptor.key_id), descriptor
      );
      if (comparison !== 0) {
        return descriptor.direction === "ascending" ? comparison : -comparison;
      }
    }
    const left = normalizeUnicode(leftId, policy.tie_breaker.normalization);
    const right = normalizeUnicode(rightId, policy.tie_breaker.normalization);
    const comparison = scalarCompare(left, right);
    return policy.tie_breaker.direction === "ascending" ? comparison : -comparison;
  };
}

function pairKey(left, right) {
  return compareCodeUnits(left, right) < 0 ? `${left}\0${right}` : `${right}\0${left}`;
}

function assertComparatorObservations(observations, inputIds, compare) {
  const expectedCount = inputIds.length * (inputIds.length - 1) / 2;
  if (observations.length !== expectedCount) fail(
    "lexicographic_comparator_matrix_incomplete",
    "comparator observations must contain every distinguishable item pair",
    { expected_count: expectedCount, actual_count: observations.length }
  );
  const seen = new Set();
  for (const [index, observation] of observations.entries()) {
    if (!exactKeys(observation, ["left_item_id", "outcome", "right_item_id"]) ||
        !inputIds.includes(observation.left_item_id) ||
        !inputIds.includes(observation.right_item_id) ||
        observation.left_item_id === observation.right_item_id ||
        ![-1, 0, 1].includes(observation.outcome)) fail(
      "lexicographic_comparator_observation_invalid",
      "each comparator observation must describe one distinct declared pair",
      { index }
    );
    const key = pairKey(observation.left_item_id, observation.right_item_id);
    if (seen.has(key)) fail(
      "lexicographic_comparator_pair_duplicate",
      "each distinguishable pair must be observed exactly once", { index }
    );
    seen.add(key);
    const expected = compare(observation.left_item_id, observation.right_item_id);
    if (expected === 0) fail(
      "lexicographic_tie_breaker_not_total",
      "the declared tie-breaker compares distinguishable items as equal",
      { left_item_id: observation.left_item_id, right_item_id: observation.right_item_id }
    );
    if (observation.outcome !== expected) fail(
      observation.outcome === 0
        ? "lexicographic_comparator_false_equality"
        : "lexicographic_comparator_observation_mismatch",
      "observed comparator behavior differs from the declared lexicographic policy",
      { index, expected, actual: observation.outcome }
    );
  }
}

function sameMembers(left, right) {
  return left.length === right.length &&
    [...left].sort(compareCodeUnits).every(
      (value, index) => value === [...right].sort(compareCodeUnits)[index]
    );
}

function assertOrder(actual, expected, code, message) {
  if (actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])) fail(code, message);
}

function assertPermutations(evidence, input, result, policy, expected) {
  let nonIdentityInput = false;
  for (const [index, observation] of evidence.input_permutations.entries()) {
    if (!exactKeys(observation, ["input_item_ids", "result_item_ids"]) ||
        !Array.isArray(observation.input_item_ids) ||
        !Array.isArray(observation.result_item_ids) ||
        !sameMembers(observation.input_item_ids, input.items.map(({ item_id: id }) => id))) fail(
      "lexicographic_input_permutation_invalid",
      "input permutation observations must permute the complete declared population",
      { index }
    );
    if (observation.input_item_ids.some(
      (id, itemIndex) => id !== input.items[itemIndex].item_id)) nonIdentityInput = true;
    assertOrder(observation.result_item_ids, expected,
      "lexicographic_input_permutation_changed_result",
      "an input permutation changed the observed result");
  }
  if (!nonIdentityInput) fail(
    "lexicographic_input_permutation_missing",
    "input evidence must contain at least one non-identity permutation"
  );

  const keyIds = policy.keys.map(({ key_id: id }) => id);
  let nonIdentityDeclaration = false;
  for (const [index, observation] of evidence.declaration_permutations.entries()) {
    if (!exactKeys(observation, ["policy_key_ids", "result_item_ids"]) ||
        !Array.isArray(observation.policy_key_ids) ||
        !Array.isArray(observation.result_item_ids) ||
        !sameMembers(observation.policy_key_ids, keyIds)) fail(
      "lexicographic_declaration_permutation_invalid",
      "declaration permutation observations must permute every policy key", { index }
    );
    if (observation.policy_key_ids.some((id, keyIndex) => id !== keyIds[keyIndex])) {
      nonIdentityDeclaration = true;
    }
    assertOrder(observation.result_item_ids, expected,
      "lexicographic_declaration_permutation_changed_result",
      "an authored key-declaration permutation changed the observed result");
  }
  if (!nonIdentityDeclaration) fail(
    "lexicographic_declaration_permutation_missing",
    "declaration evidence must contain at least one non-identity permutation"
  );

  const canonicalInput = canonicalJsonBytes(input).toString("utf8");
  const canonicalPolicy = canonicalJsonBytes({
    comparator_id: policy.comparator_id,
    keys: policy.keys,
    schema_version: policy.schema_version,
    tie_breaker: policy.tie_breaker
  }).toString("utf8");
  let nonCanonicalSerialization = false;
  for (const [index, observation] of evidence.serialization_permutations.entries()) {
    if (!exactKeys(observation, ["input_json", "policy_json", "result_item_ids"]) ||
        typeof observation.input_json !== "string" ||
        typeof observation.policy_json !== "string" ||
        !Array.isArray(observation.result_item_ids)) fail(
      "lexicographic_serialization_permutation_invalid",
      "serialization observations must carry equivalent JSON bytes and one result", { index }
    );
    let parsedInput;
    let parsedPolicy;
    try {
      parsedInput = JSON.parse(observation.input_json);
      parsedPolicy = JSON.parse(observation.policy_json);
    } catch (error) {
      fail("lexicographic_serialization_permutation_invalid",
        "serialization permutation is not JSON", { index, cause: error.message });
    }
    assertNoDuplicateJsonMembers(observation.input_json,
      `serialization_permutations[${index}].input_json`);
    assertNoDuplicateJsonMembers(observation.policy_json,
      `serialization_permutations[${index}].policy_json`);
    if (canonicalDigest(parsedInput) !== canonicalDigest(input) ||
        canonicalDigest(parsedPolicy) !== canonicalDigest({
          comparator_id: policy.comparator_id,
          keys: policy.keys,
          schema_version: policy.schema_version,
          tie_breaker: policy.tie_breaker
        })) fail(
      "lexicographic_serialization_not_equivalent",
      "serialization permutation changes the input or policy value", { index }
    );
    if (observation.input_json !== canonicalInput ||
        observation.policy_json !== canonicalPolicy) nonCanonicalSerialization = true;
    assertOrder(observation.result_item_ids, expected,
      "lexicographic_serialization_permutation_changed_result",
      "an equivalent serialization permutation changed the observed result");
  }
  if (!nonCanonicalSerialization) fail(
    "lexicographic_serialization_permutation_missing",
    "serialization evidence must contain a noncanonical but equivalent ordering"
  );
  assertOrder(result.item_ids, expected, "lexicographic_result_order_incorrect",
    "the complete captured result does not match the declared lexicographic policy");
}

function references(prefix, ids) {
  return [...ids].map(
    (id) => `ref-${prefix}-${sha256(Buffer.from(id, "utf8"))}`
  ).sort(compareCodeUnits);
}

function deterministicLexicographicConformance(sourceValues, sourceDigests) {
  const [evidence, input, rawPolicy, result] = sourceValues;
  const inputIds = assertInput(input);
  const resultIds = assertResult(result);
  const policy = assertPolicy(rawPolicy);
  if (!sameMembers(inputIds, resultIds)) fail(
    "lexicographic_population_mismatch",
    "declared and returned populations must be mutually inclusive with equal cardinality"
  );
  const { matrix, observations } = assertEvidence(evidence, inputIds, policy);
  const compare = comparatorFor(policy, matrix);
  assertComparatorObservations(observations, inputIds, compare);
  const expected = [...inputIds].sort(compare);
  assertPermutations(evidence, input, result, policy, expected);
  const sourceContentSha256 = Object.fromEntries(
    SOURCE_NAMES.map((name, index) => [name, sourceDigests[index]])
  );
  const sourceSetSha256 = sha256(canonicalJsonBytes({
    transformer_id: TRANSFORMER_ID,
    source_content_sha256: sourceContentSha256
  }));
  return {
    schema_version: REPORT_VERSION,
    transformer_id: TRANSFORMER_ID,
    source_set_sha256: sourceSetSha256,
    source_content_sha256: sourceContentSha256,
    facts: FACT_KEYS.map((factKey) => ({
      resolver_kind: RESOLVER_KIND,
      fact_key: factKey,
      argument_roles: [...FACT_ARGUMENTS[factKey]],
      satisfied: true,
      source_set_sha256: sourceSetSha256
    })),
    populations: {
      declared_items: references("ordering-item", inputIds),
      policy_keys: references("ordering-key", policy.keys.map(({ key_id: id }) => id)),
      result_items: references("ordering-item", resultIds)
    },
    counts: { item_count: inputIds.length, policy_key_count: policy.keys.length },
    policy_sha256: sourceContentSha256.ordering_policy,
    result_order_sha256: sha256(canonicalJsonBytes(resultIds))
  };
}

function assertLexicographicConformanceResult(value) {
  if (!exactKeys(value, [
    "counts", "facts", "policy_sha256", "populations", "result_order_sha256",
    "schema_version", "source_content_sha256", "source_set_sha256", "transformer_id"
  ]) || value.schema_version !== REPORT_VERSION || value.transformer_id !== TRANSFORMER_ID ||
      !exactKeys(value.source_content_sha256, SOURCE_NAMES) ||
      Object.values(value.source_content_sha256).some(
        (digest) => !/^[0-9a-f]{64}$/u.test(digest)
      ) || !/^[0-9a-f]{64}$/u.test(value.source_set_sha256) ||
      !/^[0-9a-f]{64}$/u.test(value.policy_sha256) ||
      !/^[0-9a-f]{64}$/u.test(value.result_order_sha256) ||
      !exactKeys(value.counts, ["item_count", "policy_key_count"]) ||
      !Number.isSafeInteger(value.counts.item_count) || value.counts.item_count < 2 ||
      !Number.isSafeInteger(value.counts.policy_key_count) ||
      value.counts.policy_key_count < 2 ||
      !exactKeys(value.populations, ["declared_items", "policy_keys", "result_items"]) ||
      !Array.isArray(value.facts) || value.facts.length !== FACT_KEYS.length) fail(
    "lexicographic_projection_result_invalid",
    "lexicographic conformance report has an invalid closed shape"
  );
  for (const population of Object.values(value.populations)) if (!sortedUnique(population)) {
    fail("lexicographic_projection_population_noncanonical",
      "derived populations must be sorted and unique");
  }
  const expectedSourceSetSha256 = sha256(canonicalJsonBytes({
    transformer_id: TRANSFORMER_ID,
    source_content_sha256: value.source_content_sha256
  }));
  if (value.source_set_sha256 !== expectedSourceSetSha256 ||
      value.policy_sha256 !== value.source_content_sha256.ordering_policy) fail(
    "lexicographic_projection_digest_binding_invalid",
    "the report digest bindings must be derived from its complete exact source set"
  );
  if (value.populations.declared_items.length !== value.counts.item_count ||
      value.populations.result_items.length !== value.counts.item_count ||
      value.populations.policy_keys.length !== value.counts.policy_key_count ||
      value.populations.declared_items.some(
        (id, index) => id !== value.populations.result_items[index]
      )) fail("lexicographic_projection_population_mismatch",
    "report populations and counts are inconsistent");
  const factKeys = value.facts.map(({ fact_key: key }) => key);
  if (JSON.stringify(factKeys) !== JSON.stringify(FACT_KEYS) ||
      value.facts.some((fact) => !exactKeys(fact, [
        "argument_roles", "fact_key", "resolver_kind", "satisfied", "source_set_sha256"
      ]) || fact.resolver_kind !== RESOLVER_KIND || fact.satisfied !== true ||
        fact.source_set_sha256 !== value.source_set_sha256 ||
        !Array.isArray(fact.argument_roles) || !sortedUnique(fact.argument_roles) ||
        JSON.stringify(fact.argument_roles) !==
          JSON.stringify(FACT_ARGUMENTS[fact.fact_key]))) fail(
    "lexicographic_projection_facts_invalid",
    "report facts must be the complete canonical digest-bound fact set"
  );
  return value;
}

function projectLexicographicPopulation(value, populationId) {
  assertLexicographicConformanceResult(value);
  const field = {
    "declared-items": "declared_items",
    "policy-keys": "policy_keys",
    "result-items": "result_items"
  }[populationId];
  if (!field) fail("projection_population_unknown",
    "the deterministic lexicographic population is not package-owned",
    { population_id: populationId });
  return value.populations[field];
}

function deriveDeterministicLexicographicConformance({
  comparatorEvidenceBytes,
  inputSnapshotBytes,
  orderingPolicyBytes,
  resultSnapshotBytes
}) {
  const sourceBytes = [
    comparatorEvidenceBytes,
    inputSnapshotBytes,
    orderingPolicyBytes,
    resultSnapshotBytes
  ];
  if (sourceBytes.some((bytes) => !Buffer.isBuffer(bytes))) fail(
    "projection_source_set_incomplete",
    "all four exact captured lexicographic source byte sequences are required"
  );
  const sourceValues = sourceBytes.map((bytes, index) =>
    parseCanonicalDocument(bytes, SOURCE_NAMES[index]));
  const sourceDigests = sourceBytes.map(sha256);
  const first = canonicalJsonBytes(deterministicLexicographicConformance(
    structuredClone(sourceValues), [...sourceDigests]
  ), { file: true });
  const second = canonicalJsonBytes(deterministicLexicographicConformance(
    structuredClone(sourceValues), [...sourceDigests]
  ), { file: true });
  if (!first.equals(second)) fail(
    "projection_transformer_nondeterministic",
    "repeated lexicographic projections produced unequal bytes"
  );
  assertLexicographicConformanceResult(
    parseCanonicalDocument(first, "lexicographic conformance report")
  );
  return first;
}

export {
  EVIDENCE_VERSION,
  FACT_ARGUMENTS,
  FACT_KEYS,
  INPUT_VERSION,
  POLICY_VERSION,
  REPORT_VERSION,
  RESULT_VERSION,
  TRANSFORMER_ID,
  assertLexicographicConformanceResult,
  deriveDeterministicLexicographicConformance,
  deterministicLexicographicConformance,
  projectLexicographicPopulation,
  scalarCompare
};
