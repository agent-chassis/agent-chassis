import {
  EVIDENCE_VERSION,
  INPUT_VERSION,
  POLICY_VERSION,
  RESULT_VERSION
} from "../../lib/deterministic-lexicographic-ordering.mjs";
import { canonicalJsonBytes } from "../../lib/deterministic-projection-primitives.mjs";

function compareScalars(left, right) {
  const a = [...left].map((character) => character.codePointAt(0));
  const b = [...right].map((character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

function normalized(value, mode) {
  return mode === "none" ? value : value.normalize(mode);
}

function independentValueComparison(left, right, key) {
  if (key.type === "unicode_scalar") {
    return compareScalars(normalized(left, key.normalization),
      normalized(right, key.normalization));
  }
  if (key.type === "timestamp") {
    const a = Date.parse(left);
    const b = Date.parse(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function independentComparator(policy, valuesByItem) {
  const keys = [...policy.keys].sort((left, right) => left.precedence - right.precedence);
  return (leftId, rightId) => {
    for (const key of keys) {
      const order = independentValueComparison(
        valuesByItem[leftId][key.key_id], valuesByItem[rightId][key.key_id], key
      );
      if (order !== 0) return key.direction === "ascending" ? order : -order;
    }
    const tieOrder = compareScalars(
      normalized(leftId, policy.tie_breaker.normalization),
      normalized(rightId, policy.tie_breaker.normalization)
    );
    return policy.tie_breaker.direction === "ascending" ? tieOrder : -tieOrder;
  };
}

function key(keyId, type, precedence, direction, extractor = keyId, normalization = "none") {
  return {
    key_id: keyId,
    extractor,
    type,
    precedence,
    direction,
    equality: "exact_after_normalization",
    collation: type === "unicode_scalar" ? "unicode_scalar" : "exact_typed",
    normalization,
    punctuation: "significant"
  };
}

function caseDefinition(caseId) {
  if (caseId === "unicode-locale") return {
    items: ["z-item", "a-item"],
    keys: [key("rank", "integer", 0, "ascending"),
      key("label", "unicode_scalar", 1, "ascending")],
    values: {
      "z-item": { rank: 1, label: "Z" },
      "a-item": { rank: 1, label: "ä" }
    }
  };
  if (caseId === "unicode-punctuation") return {
    items: ["z-punct", "a-plain"],
    keys: [key("rank", "integer", 0, "ascending"),
      key("label", "unicode_scalar", 1, "ascending")],
    values: {
      "z-punct": { rank: 1, label: "a-b" },
      "a-plain": { rank: 1, label: "ab" }
    }
  };
  if (caseId === "timestamp-integer") return {
    items: ["build-a", "build-b", "build-c", "build-d"],
    keys: [key("attempt", "integer", 1, "ascending"),
      key("created_at", "timestamp", 0, "descending")],
    values: {
      "build-a": { created_at: "2026-08-10T12:00:00.000Z", attempt: 2 },
      "build-b": { created_at: "2026-08-11T12:00:00.000Z", attempt: 3 },
      "build-c": { created_at: "2026-08-11T12:00:00.000Z", attempt: 1 },
      "build-d": { created_at: "2026-08-09T12:00:00.000Z", attempt: 1 }
    }
  };
  if (caseId === "boolean-numeric-unicode") return {
    items: ["a-b", "ab", "z-e\u0301", "a-é"],
    keys: [key("label", "unicode_scalar", 2, "ascending", "record.label", "NFC"),
      key("enabled", "boolean", 0, "descending", "record.enabled"),
      key("weight", "numeric", 1, "descending", "record.weight")],
    values: {
      "a-b": { enabled: true, weight: 2.5, label: "same" },
      ab: { enabled: true, weight: 2.5, label: "same" },
      "z-e\u0301": { enabled: false, weight: 7.25, label: "e\u0301" },
      "a-é": { enabled: false, weight: 7.25, label: "é" }
    }
  };
  if (caseId === "tie-normalized-unicode") return {
    items: ["éx", "e\u0301y", "middle", "emoji-😀"],
    keys: [key("rank", "integer", 0, "ascending"),
      key("label", "unicode_scalar", 1, "ascending")],
    tieNormalization: "NFC",
    values: {
      éx: { rank: 1, label: "equal" },
      "e\u0301y": { rank: 1, label: "equal" },
      middle: { rank: 0, label: "first" },
      "emoji-😀": { rank: 2, label: "😀" }
    }
  };
  if (caseId === "numeric-unicode") return {
    items: ["item-a", "item-b", "item-c", "item-d"],
    keys: [key("label", "unicode_scalar", 1, "ascending", "record.label"),
      key("score", "numeric", 0, "descending", "record.score")],
    values: {
      "item-a": { score: 4.25, label: "equal" },
      "item-b": { score: 4.25, label: "equal" },
      "item-c": { score: 10.5, label: "Zulu" },
      "item-d": { score: 10.5, label: "Ångström" }
    }
  };
  throw new Error(`unknown lexicographic fixture ${caseId}`);
}

function reverseObjectOrder(value) {
  if (Array.isArray(value)) return value.map(reverseObjectOrder);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).reverse().map((name) => [name, reverseObjectOrder(value[name])])
  );
  return value;
}

function buildLexicographicDocuments(caseId = "numeric-unicode") {
  const definition = caseDefinition(caseId);
  const input = {
    schema_version: INPUT_VERSION,
    items: definition.items.map((itemId) => ({ item_id: itemId }))
  };
  const policy = {
    schema_version: POLICY_VERSION,
    comparator_id: `comparator-${caseId}`,
    keys: definition.keys,
    tie_breaker: {
      extractor: "item_id",
      type: "unicode_scalar",
      direction: "ascending",
      equality: "exact_after_normalization",
      collation: "unicode_scalar",
      normalization: definition.tieNormalization ?? "none",
      punctuation: "significant"
    }
  };
  const compare = independentComparator(policy, definition.values);
  const ordered = [...definition.items].sort(compare);
  const result = { schema_version: RESULT_VERSION, item_ids: ordered };
  const comparatorObservations = [];
  for (let left = 0; left < definition.items.length; left += 1) {
    for (let right = left + 1; right < definition.items.length; right += 1) {
      comparatorObservations.push({
        left_item_id: definition.items[left],
        right_item_id: definition.items[right],
        outcome: compare(definition.items[left], definition.items[right])
      });
    }
  }
  const evidence = {
    schema_version: EVIDENCE_VERSION,
    comparator_id: policy.comparator_id,
    item_key_values: [...definition.items].reverse().map((itemId) => ({
      item_id: itemId,
      key_values: [...policy.keys].reverse().map((descriptor) => ({
        key_id: descriptor.key_id,
        extractor: descriptor.extractor,
        value: definition.values[itemId][descriptor.key_id]
      }))
    })),
    comparator_observations: comparatorObservations,
    input_permutations: [{
      input_item_ids: [...definition.items].reverse(),
      result_item_ids: [...ordered]
    }],
    declaration_permutations: [{
      policy_key_ids: [...policy.keys].reverse().map(({ key_id: id }) => id),
      result_item_ids: [...ordered]
    }],
    serialization_permutations: [{
      input_json: JSON.stringify(reverseObjectOrder(input)),
      policy_json: JSON.stringify(reverseObjectOrder(policy)),
      result_item_ids: [...ordered]
    }]
  };
  return {
    caseId,
    definition: structuredClone(definition),
    evidence,
    input,
    policy,
    result,
    expected: ordered,
    sourceValues: [evidence, input, policy, result],
    sourceBytes: [evidence, input, policy, result].map(
      (value) => canonicalJsonBytes(value, { file: true })
    )
  };
}

export {
  buildLexicographicDocuments,
  compareScalars,
  independentComparator,
  independentValueComparison
};
