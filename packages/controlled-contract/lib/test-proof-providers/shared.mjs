

const NATIVE_NODE_ID_MAX_SCALARS = 4096;
const NATIVE_PATH_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/u;
const TITLE_MAX_SCALARS = 1024;
const TITLE_PATH_MAX_ELEMENTS = 32;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const isPositiveCount = (value) => Number.isSafeInteger(value) && value > 0;

const canonicalJson = (value) => JSON.stringify(value, (_key, entry) =>
  entry !== null && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
    : entry);

function hasLoneSurrogate(text) {
  return /[\ud800-\udfff]/u.test(text.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ""));
}

function isLiteralText(value, maxScalars) {
  return typeof value === "string" && value.length > 0 && [...value].length <= maxScalars &&
    !/[\u0000-\u001f\u007f]/u.test(value) && !hasLoneSurrogate(value);
}

function isNormalizedSourcePath(value, suffixes) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") &&
    suffixes.some((suffix) => value.endsWith(suffix)) &&
    value.split("/").every((segment) =>
      segment !== "." && segment !== ".." && NATIVE_PATH_SEGMENT_RE.test(segment));
}

function sourceQualifiedGrammar({ sourceSuffixes, restStatement, parseRest,
  excludedSuffixes = [] }) {
  const statement = `<normalized repository-relative ${sourceSuffixes.map((suffix) =>
    `*${suffix}`).join("|")} path>::${restStatement}`;
  return deepFreeze({
    source_suffixes: [...sourceSuffixes],
    statement,
    resolve(nodeId) {
      if (!isLiteralText(nodeId, NATIVE_NODE_ID_MAX_SCALARS)) {
        return { valid: false, expected: `nonempty literal node identity of at most ${
          NATIVE_NODE_ID_MAX_SCALARS} Unicode scalars` };
      }
      const separator = nodeId.indexOf("::");
      const sourcePath = separator < 0 ? null : nodeId.slice(0, separator);
      const rest = separator < 0 ? "" : nodeId.slice(separator + 2);
      if (sourcePath === null || rest.length === 0 ||
          !isNormalizedSourcePath(sourcePath, sourceSuffixes) ||
          excludedSuffixes.some((suffix) => sourcePath.endsWith(suffix))) {
        return { valid: false, expected: statement };
      }
      const selection = parseRest(rest);
      if (selection === null) return { valid: false, expected: statement };
      return { valid: true, path: sourcePath, selection };
    }
  });
}

function literalRestGrammar(sourceSuffixes) {
  return sourceQualifiedGrammar({ sourceSuffixes, restStatement: "<test>",
    parseRest: (rest) => deepFreeze({ literal: rest }) });
}

function titlePathGrammar(sourceSuffixes, { minLength = 1,
  maxLength = TITLE_PATH_MAX_ELEMENTS, element = null, statement = null } = {}) {
  return sourceQualifiedGrammar({
    sourceSuffixes,
    restStatement: statement ??
      `<canonical JSON array of ${minLength}..${maxLength} literal titles>`,
    parseRest(rest) {
      let titles;
      try { titles = JSON.parse(rest); } catch { return null; }
      if (!Array.isArray(titles) || JSON.stringify(titles) !== rest ||
          titles.length < minLength || titles.length > maxLength ||
          titles.some((title) => !isLiteralText(title, TITLE_MAX_SCALARS)) ||
          (element !== null && !titles.every((title, index) => element(title, index)))) {
        return null;
      }
      return deepFreeze({ title_path: titles });
    }
  });
}

function identifierPathGrammar(sourceSuffixes, { separator, minLength = 1,
  last = IDENTIFIER_RE, statement, excludedSuffixes = [] }) {
  return sourceQualifiedGrammar({
    sourceSuffixes,
    excludedSuffixes,
    restStatement: statement,
    parseRest(rest) {
      const parts = rest.split(separator);
      if (parts.length < minLength || parts.length > TITLE_PATH_MAX_ELEMENTS ||
          !parts.every((part, index) => (index === parts.length - 1 ? last : IDENTIFIER_RE)
            .test(part))) return null;
      return deepFreeze({ identifier_path: parts });
    }
  });
}

function scalarReturnSubstitutionWitness(payload, testId, mutation) {
  return payload?.mechanism === "scalar_return_substitution" &&
    payload.strategy === "result_inversion" && payload.target_test_id === testId &&
    payload.target_module_path === mutation.module_path && payload.observed === true &&
    payload.selected_outcome === "failed" && payload.assertion_failure === true &&
    isPositiveCount(payload.mutated_entries_in_window) &&
    payload.mutation_id === mutation.mutation_id && typeof payload.function_name === "string" &&
    typeof payload.source_digest === "string" &&
    typeof payload.original_kind === "string" && typeof payload.replacement_kind === "string" &&
    (payload.original_kind !== payload.replacement_kind ||
      canonicalJson(payload.original) !== canonicalJson(payload.replacement));
}

function functionEntryProbeWitness(payload, testId, row) {
  return payload?.mechanism === "function_entry_probe" && payload.target_test_id === testId &&
    payload.observed === true && payload.target_pass_observed === true &&
    payload.observable_seam === row.observation_seam &&
    typeof payload.module_path === "string" && typeof payload.source_digest === "string" &&
    Array.isArray(payload.reaches) && payload.reaches.some((reach) =>
      reach?.window === "selected" && reach.module_path === payload.module_path &&
      reach.source_digest === payload.source_digest && typeof reach.function_name === "string" &&
      isPositiveCount(reach.entries));
}

const SHARED_WITNESS_VALIDATORS = deepFreeze({
  falsifier_result: { scalar_return_substitution: scalarReturnSubstitutionWitness },
  boundary_trace: { function_entry_probe: functionEntryProbeWitness }
});

const NATIVE_INSTRUMENTATION_REFUSAL_CODE = "test_proof_native_instrumentation_unsupported";
const SCALAR_RETURN_REFUSAL_REASONS = Object.freeze(["source_unparsable", "function_absent",
  "function_not_unique", "function_not_synchronous", "body_not_single_scalar_return",
  "return_literal_unsupported", "replacement_not_scalar", "replacement_not_distinct"]);

function falsifierTargetConstraint({ target, shape, replacement = undefined, refusalCodes,
  refusalReasons = [] }) {
  return deepFreeze({ target, shape, ...(replacement === undefined ? {} : { replacement }),
    checked: "by the launcher when workspace_verify_proof runs the attempt, not at save or validation",
    refusal_codes: [...refusalCodes], refusal_reasons: [...refusalReasons] });
}

const SHARED_FALSIFIER_TARGET_CONSTRAINTS = deepFreeze({
  scalar_return_substitution: falsifierTargetConstraint({
    target: "the one top-level function named function_name in module_path",
    shape: "a synchronous, non-generic function declaration (exported where the language " +
      "exports declarations) whose body, apart from a leading docstring where the language has " +
      "one, is exactly one " +
      "return of one scalar literal; composite, computed, escaped or multi-statement returns " +
      "are refused",
    replacement: "one JSON scalar of a kind the language adapter accepts for the returned " +
      "literal, different from it",
    refusalCodes: [NATIVE_INSTRUMENTATION_REFUSAL_CODE],
    refusalReasons: [...SCALAR_RETURN_REFUSAL_REASONS, "function_generic",
      "replacement_kind_incompatible"]
  })
});

function standardNativeDescriptors({ name, selectorKind, candidateMechanism, seam }) {
  return [{
    provider_id: `launcher.${name}`,
    provider_version: "1.0.0",
    selector_kind: selectorKind,
    capabilities: ["candidate_execution"],
    observation_mechanisms: [candidateMechanism],
    observation_seams: [seam],
    evidence_artifact_types: ["structured_test_result", "native_test_observation"],
    falsifier_strategies: [],
    boundary_kinds: []
  }, {
    provider_id: `launcher.${name}-scalar-return`,
    provider_version: "1.0.0",
    selector_kind: selectorKind,
    capabilities: ["falsifier_execution"],
    observation_mechanisms: [candidateMechanism, "scalar_return_substitution"],
    observation_seams: [`${seam}_failure`],
    evidence_artifact_types: ["falsifier_result", "structured_test_result"],
    falsifier_strategies: ["result_inversion"],
    boundary_kinds: ["function"]
  }, {
    provider_id: `launcher.${name}-entry-probe`,
    provider_version: "1.0.0",
    selector_kind: selectorKind,
    capabilities: ["boundary_traversal"],
    observation_mechanisms: ["function_entry_probe"],
    observation_seams: [seam],
    evidence_artifact_types: ["boundary_trace", "structured_test_result"],
    falsifier_strategies: [],
    boundary_kinds: ["module"]
  }];
}

const JAVASCRIPT_SOURCE_SUFFIXES = Object.freeze([".js", ".cjs", ".mjs", ".jsx", ".ts", ".cts",
  ".mts", ".tsx"]);

export {
  IDENTIFIER_RE,
  JAVASCRIPT_SOURCE_SUFFIXES,
  NATIVE_INSTRUMENTATION_REFUSAL_CODE,
  NATIVE_NODE_ID_MAX_SCALARS,
  SCALAR_RETURN_REFUSAL_REASONS,
  SHARED_FALSIFIER_TARGET_CONSTRAINTS,
  SHARED_WITNESS_VALIDATORS,
  canonicalJson,
  deepFreeze,
  falsifierTargetConstraint,
  identifierPathGrammar,
  isNormalizedSourcePath,
  isPositiveCount,
  literalRestGrammar,
  standardNativeDescriptors,
  titlePathGrammar
};
