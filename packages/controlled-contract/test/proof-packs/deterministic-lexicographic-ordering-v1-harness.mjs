import { deterministicLexicographicConformance } from
  "../../lib/deterministic-lexicographic-ordering.mjs";
import { canonicalJsonBytes, sha256 } from
  "../../lib/deterministic-projection-primitives.mjs";
import { buildLexicographicDocuments } from
  "./deterministic-lexicographic-ordering-v1-fixture.mjs";

function signs(value) {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

function alternativeComparator(fixture, mutantId) {
  const { policy, definition } = fixture;
  const declared = [...policy.keys].sort(
    (left, right) => left.precedence - right.precedence
  );
  const compareValue = (left, right, key) => {
    if (key.type === "timestamp") return signs(Date.parse(left) - Date.parse(right));
    if (key.type === "unicode_scalar") {
      if (mutantId === "ambient-locale-comparison") return signs(left.localeCompare(right));
      const a = mutantId === "punctuation-stripping-comparison"
        ? left.replaceAll(/\p{P}/gu, "") : left;
      const b = mutantId === "punctuation-stripping-comparison"
        ? right.replaceAll(/\p{P}/gu, "") : right;
      return signs(a < b ? -1 : a > b ? 1 : 0);
    }
    return signs(left - right);
  };
  return (leftId, rightId) => {
    if (mutantId === "premature-tie-breaking") {
      const tie = signs(leftId < rightId ? -1 : leftId > rightId ? 1 : 0);
      if (tie !== 0) return tie;
    }
    const keys = mutantId === "key-precedence-reversal" ? [...declared].reverse() : declared;
    for (const key of keys) {
      const raw = compareValue(
        definition.values[leftId][key.key_id], definition.values[rightId][key.key_id], key
      );
      if (raw === 0) continue;
      let descending = key.direction === "descending";
      if (mutantId === "direction-reversal") descending = !descending;
      if (mutantId === "oldest-first-substitution" && key.type === "timestamp") {
        descending = false;
      }
      return descending ? -raw : raw;
    }
    const leftTie = mutantId === "tie-breaker-normalization-ignored"
      ? leftId : policy.tie_breaker.normalization === "none"
        ? leftId : leftId.normalize(policy.tie_breaker.normalization);
    const rightTie = mutantId === "tie-breaker-normalization-ignored"
      ? rightId : policy.tie_breaker.normalization === "none"
        ? rightId : rightId.normalize(policy.tie_breaker.normalization);
    const rawTie = signs(leftTie < rightTie ? -1 : leftTie > rightTie ? 1 : 0);
    return mutantId === "tie-breaker-direction-reversal" ? -rawTie : rawTie;
  };
}

function rewriteForComparator(fixture, mutantId) {
  const compare = alternativeComparator(fixture, mutantId);
  const mutantOrder = [...fixture.definition.items].sort(compare);
  fixture.result.item_ids = mutantOrder;
  fixture.evidence.comparator_observations = fixture.evidence.comparator_observations.map(
    (observation) => ({ ...observation, outcome: compare(
      observation.left_item_id, observation.right_item_id
    ) })
  );
  for (const field of [
    "input_permutations", "declaration_permutations", "serialization_permutations"
  ]) for (const observation of fixture.evidence[field]) {
    observation.result_item_ids = [...mutantOrder];
  }
}

function mutatedDocuments(mutantId) {
  const caseId = mutantId === "oldest-first-substitution"
    ? "timestamp-integer"
    : mutantId === "key-normalization-ignored"
      ? "boolean-numeric-unicode"
    : mutantId === "tie-breaker-normalization-ignored"
      ? "tie-normalized-unicode"
    : mutantId === "ambient-locale-comparison"
      ? "unicode-locale"
      : mutantId === "punctuation-stripping-comparison"
        ? "unicode-punctuation" : "numeric-unicode";
  const fixture = buildLexicographicDocuments(caseId);
  if ([
    "key-precedence-reversal", "direction-reversal", "oldest-first-substitution",
    "premature-tie-breaking", "ambient-locale-comparison",
    "punctuation-stripping-comparison", "key-normalization-ignored",
    "tie-breaker-direction-reversal", "tie-breaker-normalization-ignored"
  ].includes(mutantId)) rewriteForComparator(fixture, mutantId);
  else if (mutantId === "unstable-equal-key-ordering") {
    const first = fixture.result.item_ids.indexOf("item-a");
    const second = fixture.result.item_ids.indexOf("item-b");
    [fixture.result.item_ids[first], fixture.result.item_ids[second]] =
      [fixture.result.item_ids[second], fixture.result.item_ids[first]];
  } else if (mutantId === "prefix-only-sorting") {
    const last = fixture.result.item_ids.length - 1;
    [fixture.result.item_ids[last - 1], fixture.result.item_ids[last]] =
      [fixture.result.item_ids[last], fixture.result.item_ids[last - 1]];
  } else if (mutantId === "input-permutation-sensitivity") {
    fixture.evidence.input_permutations[0].result_item_ids.reverse();
  } else if (mutantId === "declaration-permutation-sensitivity") {
    fixture.evidence.declaration_permutations[0].result_item_ids.reverse();
  } else if (mutantId === "serialization-permutation-sensitivity") {
    fixture.evidence.serialization_permutations[0].result_item_ids.reverse();
  } else if (mutantId === "serialization-duplicate-members") {
    const input = fixture.input;
    fixture.evidence.serialization_permutations[0].input_json =
      `{"schema_version":${JSON.stringify(input.schema_version)},` +
      `"schema_version":${JSON.stringify(input.schema_version)},` +
      `"items":${JSON.stringify(input.items)}}`;
  } else if (mutantId === "omitted-result-member") {
    fixture.result.item_ids.pop();
  } else if (mutantId === "duplicated-result-member") {
    fixture.result.item_ids.at(-1);
    fixture.result.item_ids[fixture.result.item_ids.length - 1] = fixture.result.item_ids[0];
  } else if (mutantId === "substituted-result-member") {
    fixture.result.item_ids[fixture.result.item_ids.length - 1] = "substituted-item";
  } else if (mutantId === "comparator-false-equality") {
    fixture.evidence.comparator_observations[0].outcome = 0;
  } else if (mutantId === "key-extractor-ignored") {
    fixture.evidence.item_key_values[0].key_values[0].extractor = "wrong.extractor";
  } else if (mutantId === "key-type-ignored") {
    const integerKey = fixture.policy.keys.find(({ type }) => type === "integer");
    if (!integerKey) {
      fixture.policy.keys[0].type = "integer";
      fixture.policy.keys[0].collation = "exact_typed";
      fixture.evidence.item_key_values[0].key_values.find(
        ({ key_id: id }) => id === fixture.policy.keys[0].key_id
      ).value = 1.5;
    }
  } else if (mutantId === "unicode-leading-lone-surrogate") {
    const unicodeKey = fixture.policy.keys.find(({ type }) => type === "unicode_scalar");
    fixture.evidence.item_key_values[0].key_values.find(
      ({ key_id: id }) => id === unicodeKey.key_id
    ).value = "\ud800invalid";
  } else if (mutantId === "unicode-trailing-lone-surrogate") {
    const unicodeKey = fixture.policy.keys.find(({ type }) => type === "unicode_scalar");
    fixture.evidence.item_key_values[0].key_values.find(
      ({ key_id: id }) => id === unicodeKey.key_id
    ).value = "invalid\udfff";
  } else throw new Error(`unknown mutant ${mutantId}`);
  fixture.sourceValues = [fixture.evidence, fixture.input, fixture.policy, fixture.result];
  fixture.sourceBytes = fixture.sourceValues.map(
    (value) => canonicalJsonBytes(value, { file: true })
  );
  return fixture;
}

function executeFixture(fixture) {
  const sourceDigests = fixture.sourceBytes.map(sha256);
  const first = canonicalJsonBytes(deterministicLexicographicConformance(
    structuredClone(fixture.sourceValues), sourceDigests
  ), { file: true });
  const second = canonicalJsonBytes(deterministicLexicographicConformance(
    structuredClone(fixture.sourceValues), sourceDigests
  ), { file: true });
  if (!first.equals(second)) throw new Error("lexicographic harness observed nondeterminism");
  return first;
}

function executeMutant(mutantId) {
  try {
    executeFixture(mutatedDocuments(mutantId));
    return { killed: false, code: null };
  } catch (error) {
    return { killed: true, code: error?.code ?? "unknown" };
  }
}

export { executeFixture, executeMutant, mutatedDocuments };
