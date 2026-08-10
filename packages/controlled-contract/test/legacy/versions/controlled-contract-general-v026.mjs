
import fs from "node:fs";
import path from "node:path";

import Ajv from "ajv";

const BASE_SCHEMA = JSON.parse(fs.readFileSync(new URL(
  "./controlled-contract-general.experimental.v0.26.schema.json",
  import.meta.url
), "utf8"));
const validateBase = new Ajv({ strict: true, allErrors: true }).compile(BASE_SCHEMA);

const CARRIER_PREDICATES = new Set([
  "depends_on", "visible_in_scope", "within_scope", "writable_in_scope"
]);
const PREDICATE_GROUPS = {
  reference: new Set([
    "accepts", "adds", "allows", "approves", "authorizes", "behaviorally_equivalent", "blocks",
    "calls", "classifies_as",
    "complete_against", "completes", "conflicts_with", "conforms_to", "contains",
    "covers", "creates", "deletes", "depends_on", "emits", "equals", "exports",
    "follows", "forwards_to", "generates", "has_identity",
    "has_property", "has_state", "has_status", "has_type", "has_value", "imports",
    "includes", "invalidates", "isolated_from", "matches", "member_of", "modifies",
    "mutates", "not_equals", "not_member_of", "omits", "performs", "precedes", "preserves", "replaces",
    "reads", "records", "rejects", "resolves_to", "retains", "returns",
    "authoritative_for", "contained_in", "ordered_as",
    "requests_authorization", "routes_to", "same_container_as", "semantically_equivalent",
    "escalates_to", "starts",
    "supports", "targets", "traces_to", "unchanged_from_frozen_base", "uses",
    "visible_in_scope", "within_scope", "writable_in_scope", "writes"
  ]),
  boolean: new Set(["authoritative", "deterministic", "exists", "fails_when", "immutable"]),
  number: new Set(["emits", "equals", "has_cardinality", "has_value", "matches", "not_equals", "returns"]),
  range: new Set(["has_cardinality", "has_range"])
};
const FUNCTIONAL_PREDICATES = new Set([
  "authoritative", "deterministic", "equals", "exists", "fails_when", "has_cardinality", "has_range", "immutable",
  "has_state", "has_status", "has_value", "ordered_as", "resolves_to", "returns"
]);
const IRREFLEXIVE_PREDICATES = new Set([
  "calls", "conflicts_with", "depends_on", "follows", "forwards_to",
  "isolated_from", "precedes", "replaces", "routes_to", "classifies_as",
  "contained_in", "has_property", "has_type", "member_of", "within_scope"
]);
const PREDICATE_SIGNATURES = {
  accepts: {
    subjects: new Set(["cc:solution", "cc:process", "cc:runtime_component", "cc:command"])
  },
  approves: {
    subjects: new Set(["cc:actor", "cc:authority"]),
    values: new Set(["cc:evidence", "cc:artifact", "cc:criterion", "cc:requirement"])
  },
  authorizes: {
    subjects: new Set([
      "cc:authority", "cc:actor", "cc:solution", "cc:requirement",
      "cc:criterion", "cc:invariant"
    ])
  },
  authoritative_for: {},
  contained_in: {
    values: new Set(["cc:scope", "cc:artifact", "cc:runtime_component", "cc:configuration"])
  },
  covers: {
    subjects: new Set(["cc:test", "cc:evidence", "cc:artifact", "cc:scope"])
  },
  escalates_to: {
    subjects: new Set(["cc:conflict", "cc:event", "cc:process", "cc:escalation"]),
    values: new Set(["cc:authority", "cc:actor", "cc:escalation"])
  },
  fails_when: {
    subjects: new Set(["cc:solution", "cc:process", "cc:test", "cc:command", "cc:runtime_component"])
  },
  follows: {
    subjects: new Set(["cc:event", "cc:process", "cc:lifecycle_entity"]),
    values: new Set(["cc:event", "cc:process", "cc:lifecycle_entity"])
  },
  precedes: {
    subjects: new Set(["cc:event", "cc:process", "cc:lifecycle_entity"]),
    values: new Set(["cc:event", "cc:process", "cc:lifecycle_entity"])
  },
  performs: {
    subjects: new Set(["cc:actor", "cc:process", "cc:solution", "cc:runtime_component", "cc:command"])
  },
  rejects: {
    subjects: new Set(["cc:solution", "cc:process", "cc:runtime_component", "cc:command"])
  },
  replaces: {},
  requests_authorization: {
    subjects: new Set(["cc:event", "cc:process", "cc:actor"]),
    values: new Set(["cc:authority", "cc:actor"])
  },
  supports: {
    subjects: new Set(["cc:evidence", "cc:artifact", "cc:test"]),
    values: new Set(["cc:criterion", "cc:requirement", "cc:invariant"])
  },
  within_scope: {
    values: new Set(["cc:scope", "cc:artifact", "cc:runtime_component", "cc:configuration"])
  },
  writes: {
    subjects: new Set(["cc:solution", "cc:process", "cc:runtime_component", "cc:command"])
  }
};
const RELATION_SIGNATURES = {
  satisfies: {
    targets: new Set(["cc:requirement", "cc:criterion", "cc:invariant", "requirement_set"])
  },
  verifies: {
    sources: new Set(["cc:test", "cc:evidence", "cc:artifact", "cc:command"]),
    targets: new Set(["cc:requirement", "cc:criterion", "cc:invariant", "requirement_set"])
  },
  generated_by: {
    sources: new Set(["cc:artifact", "cc:evidence"]),
    targets: new Set(["cc:process", "cc:event", "cc:command", "cc:actor"])
  }
};
const VARIABLE_IDS = Array.from({ length: 64 }, (_, index) =>
  `variable-${String(index + 1).padStart(3, "0")}`
);
const COLLECTION_IDS = Array.from({ length: 16 }, (_, index) =>
  `collection-${String(index + 1).padStart(3, "0")}`
);

function markdownBlocks(sourceText) {
  const blocks = [];
  let current = [];
  const flush = () => {
    const block = current.join("\n").trim();
    if (block !== "") blocks.push(block);
    current = [];
  };

  for (const line of sourceText.split(/\r?\n/)) {
    const trimmed = line.trim();
    const content = line.trimEnd();
    if (trimmed === "") {
      flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      flush();
      blocks.push(trimmed);
      continue;
    }
    if (/^(?:[-*+]\s+|[0-9]+[.)]\s+)/.test(trimmed)) {
      flush();
      current.push(content);
      continue;
    }
    current.push(content);
  }
  flush();
  return blocks;
}

function segmentProseBlock(sourceText) {
  const segments = [];
  let start = 0;
  for (let index = 0; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    const colonBoundary = character === ":" && /\s/.test(sourceText[index + 1] ?? "");
    const leftSegment = sourceText.slice(start, index);
    const coordinatedClauseBoundary = character === "," &&
      /\b(?:MUST(?:_NOT)?|SHOULD(?:_NOT)?|MAY|must|shall|should|may)\b/.test(leftSegment) &&
      /^\s+(?:and|or)\s+[^,;:.!?]*\b(?:MUST(?:_NOT)?|SHOULD(?:_NOT)?|MAY|must|shall|should|may)\b/.test(
        sourceText.slice(index + 1)
      );
    const sentenceBoundary = ".!?".includes(character) && (() => {
      let next = index + 1;
      while (next < sourceText.length && /\s/.test(sourceText[next])) next += 1;
      return next >= sourceText.length || /[A-Z]/.test(sourceText[next]);
    })();

    if (!colonBoundary && !coordinatedClauseBoundary && !sentenceBoundary) continue;
    const segment = sourceText.slice(start, index + 1).trim();
    if (segment !== "") segments.push(segment);
    start = index + 1;
  }
  const tail = sourceText.slice(start).trim();
  if (tail !== "") segments.push(tail);
  return segments;
}

function segmentCriterion(sourceText) {
  return markdownBlocks(sourceText).flatMap(segmentProseBlock);
}

function unitPaths(unit) {
  return [...new Set([
    ...(unit?.read_scope ?? []),
    ...(unit?.repo_paths ?? []),
    ...(unit?.write_scope ?? [])
  ])].filter((entry) => typeof entry === "string" && !entry.includes("*"));
}

function implementationSymbolPath(repoPath) {
  if (repoPath.startsWith("wiki/") || repoPath.startsWith("docs/") || repoPath.startsWith("internal/docs/")) {
    return false;
  }
  return /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|rb|php|cs)$/.test(repoPath);
}

function buildReferenceCatalog({ sourceText, unitId, unit, repoRoot }) {
  const candidates = [{
    id: "current_solution",
    kind: "current_solution",
    surface: "current solution",
    identity: "invocation:current_solution",
    type: "cc:solution",
    grounded: true
  }];
  const seen = new Set(["current_solution::invocation:current_solution"]);
  const add = (candidate) => {
    const key = `${candidate.kind}::${candidate.identity}`;
    if (seen.has(key)) {
      return candidates.find((entry) => `${entry.kind}::${entry.identity}` === key);
    }
    seen.add(key);
    const entry = { ...candidate, id: `ref-${String(candidates.length).padStart(3, "0")}` };
    candidates.push(entry);
    return entry;
  };

  const parentId = /^WK-[0-9]+/.exec(unitId)?.[0] ?? null;
  for (const match of sourceText.matchAll(/\b(?:WK-[0-9]+(?:#SLICE-[0-9]+)?|SLICE-[0-9]+|DEC-[0-9]+|IN-[0-9]+)\b/g)) {
    const surface = match[0];
    const identity = surface.startsWith("SLICE-") && parentId !== null
      ? `${parentId}#${surface}`
      : surface;
    const type = identity.includes("#SLICE-") ? "pwt:slice" :
      identity.startsWith("WK-") ? "pwt:work_record" :
        identity.startsWith("DEC-") ? "pwt:decision" : "pwt:initiative";
    add({ kind: "durable_id", surface, identity, type, grounded: true });
  }

  const sourceSegments = segmentCriterion(sourceText);
  const sectionHeaderIndexes = sourceSegments.flatMap((segment, index) =>
    segment.endsWith(":") ? [index] : []
  );
  const checklistHeaderIndexes = sectionHeaderIndexes.filter((index) =>
    /\b(?:checklist|checks?|controls?|criteria|requirements?|tests?|validation|verification|verify)\b/i
      .test(sourceSegments[index])
  );
  for (const checklistHeaderIndex of checklistHeaderIndexes) {
    const nextHeaderIndex = sectionHeaderIndexes.find((index) => index > checklistHeaderIndex) ??
      sourceSegments.length;
    const checklistSegments = sourceSegments.slice(checklistHeaderIndex + 1, nextHeaderIndex)
      .flatMap((segment) => {
        const pieces = segment.split(";").map((piece) => piece.trim()).filter(Boolean);
        return pieces.map((piece, index) => index < pieces.length - 1 ? `${piece};` : piece);
      });
    if (checklistSegments.length < 2) continue;
    const members = checklistSegments.map((surface, index) => add({
      kind: "source_requirement",
      surface,
      identity: `source-requirement:${checklistHeaderIndex + 1}:${index + 1}:${surface}`,
      type: "cc:requirement",
      grounded: true
    }));
    add({
      kind: "requirement_set",
      surface: members.map((member) => member.surface).join(" "),
      identity: `requirement-set:${JSON.stringify(members.map((member) => member.identity))}`,
      type: "cc:set",
      member_reference_ids: members.map((member) => member.id),
      grounded: true
    });
  }

  const scopedFiles = [];
  for (const repoPath of unitPaths(unit)) {
    const absolute = path.join(repoRoot, repoPath);
    try {
      if (!fs.statSync(absolute).isFile()) continue;
      const text = fs.readFileSync(absolute, "utf8");
      if (implementationSymbolPath(repoPath)) scopedFiles.push({ repoPath, text });
      if (sourceText.includes(repoPath) || sourceText.includes(path.basename(repoPath))) {
        add({
          kind: "repository_path",
          surface: sourceText.includes(repoPath) ? repoPath : path.basename(repoPath),
          identity: `agent-chassis:${repoPath}`,
          repository: "agent-chassis",
          path: repoPath,
          type: "cc:artifact",
          grounded: true
        });
      }
    } catch {

    }
  }

  const identifierTokens = [...new Set(sourceText.match(
    /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\b/g
  ) ?? [])].filter((token) =>
    token.includes("_") || /[a-z][A-Z]/.test(token) ||
      (token.includes(".") && !/\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|rb|php|cs)$/i.test(token))
  );
  for (const token of identifierTokens) {
    const leaf = token.split(".").at(-1);
    const matches = scopedFiles.filter((file) =>
      new RegExp(`(^|[^A-Za-z0-9_$])${leaf.replace(/[$]/g, "\\$")}([^A-Za-z0-9_$]|$)`).test(file.text)
    );
    if (matches.length !== 1) continue;
    const match = matches[0];
    add({
      kind: "code_symbol",
      surface: token,
      identity: `agent-chassis:${match.repoPath}#${token}`,
      repository: "agent-chassis",
      path: match.repoPath,
      symbol: token,
      type: "cc:runtime_component",
      grounded: true
    });
  }

  for (const match of sourceText.matchAll(/(?:^|[\s("'`])((?:\/[A-Za-z0-9_.-]+)+(?:\/[A-Za-z0-9_.-]+)*|(?:\.\.?\/)[A-Za-z0-9_./*-]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./*-]*\.[A-Za-z0-9_.-]+)/g)) {
    const surface = match[1];
    add({
      kind: "path_literal",
      surface,
      identity: `path:${surface}`,
      type: surface.startsWith("/usr/bin/") ? "cc:command" : "cc:artifact",
      grounded: true
    });
  }
  for (const match of sourceText.matchAll(/(["`])([^\n"`]+)\1/g)) {
    add({
      kind: "literal_string",
      surface: match[0],
      identity: `string:${JSON.stringify(match[2])}`,
      value: match[2],
      type: "cc:literal",
      grounded: true
    });
  }
  for (const match of sourceText.matchAll(/(?<![A-Za-z0-9])'([^'\n]+)'(?![A-Za-z0-9])/g)) {
    add({
      kind: "literal_string",
      surface: match[0],
      identity: `string:${JSON.stringify(match[1])}`,
      value: match[1],
      type: "cc:literal",
      grounded: true
    });
  }
  return candidates;
}

function numbersInSource(sourceText) {
  const withoutDurableIds = sourceText.replace(
    /\b(?:WK|SLICE|DEC|IN)-[0-9]+(?:#SLICE-[0-9]+)?\b/g,
    (match) => " ".repeat(match.length)
  );
  return [...new Set([...withoutDurableIds.matchAll(
    /(?<![A-Za-z0-9_])-?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?(?![0-9]|[.,][0-9])/g
  )]
    .map((match) => Number(match[0].replaceAll(",", ""))))]
    .filter(Number.isFinite);
}

function normalizeSurfaceText(text) {
  return text.toLowerCase().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "").replace(/\s+/g, " ");
}

function canonicalVariableSurface(text) {
  return normalizeSurfaceText(text).replace(/^(?:a|an|the|that|this|those|these)\s+/, "");
}

function splitTopLevelCommas(text) {
  const parts = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (`\"'\``.includes(character)) {
      quote = character;
      continue;
    }
    if (character === "(") roundDepth += 1;
    else if (character === ")") roundDepth = Math.max(0, roundDepth - 1);
    else if (character === "[") squareDepth += 1;
    else if (character === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (character === "{") curlyDepth += 1;
    else if (character === "}") curlyDepth = Math.max(0, curlyDepth - 1);
    else if (character === "," && roundDepth === 0 && squareDepth === 0 && curlyDepth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function sourcePhraseTerminals(sourceText) {
  const forbiddenEdges = new Set([
    "a", "add", "all", "an", "and", "any", "as", "at", "before", "by", "change",
    "correct", "directly", "do", "for", "from", "in", "is", "keep", "may", "must",
    "no", "not", "of", "on", "only", "or", "preserve", "rebuild", "should", "test",
    "the", "then", "to", "use", "verify", "when", "with", "without"
  ]);
  const phrases = new Set();
  for (const segment of segmentCriterion(sourceText)) {
    const tokens = [...segment.matchAll(/[A-Za-z0-9_$][A-Za-z0-9_$./#-]*/g)].map((match) => {
      const text = match[0].replace(/[.;:!?]+$/, "");
      return { text, start: match.index, end: match.index + text.length };
    }).filter((token) => token.text !== "");
    for (let start = 0; start < tokens.length; start += 1) {
      for (let length = 1; length <= 8 && start + length <= tokens.length; length += 1) {
        const selected = tokens.slice(start, start + length);
        const first = selected[0].text.toLowerCase();
        const last = selected.at(-1).text.toLowerCase();
        if (forbiddenEdges.has(first) || forbiddenEdges.has(last)) continue;
        const phrase = segment.slice(selected[0].start, selected.at(-1).end).trim();
        if (normalizeSurfaceText(phrase) === normalizeSurfaceText(segment)) continue;
        if (splitTopLevelCommas(phrase).length > 1) continue;
        if (/\b(?:generated|derived|produced|created)\s+by\b/i.test(phrase)) continue;
        phrases.add(phrase);
      }
    }
  }
  return [...phrases].sort((left, right) => left.length - right.length || left.localeCompare(right));
}

function coordinatedFragments(segment) {
  const commaParts = splitTopLevelCommas(segment);
  if (commaParts.length < 3) return [];
  const last = commaParts.pop();
  const conjunctionParts = last.split(/\b(?:and|or)\b/i);
  return [...commaParts, ...conjunctionParts]
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function hasDiscriminatingFalsifierText(text) {
  const transformation = /\b(?:add(?:ed|ing)?|change(?:d|s|ing)?|differ(?:s|ed|ent)?|invalid|malformed|mutat(?:e|ed|ion)|omit(?:ted|ting)?|remove(?:d|s|ing)?|revert(?:ed|s|ing)?|weaken(?:ed|s|ing)?)\b/i;
  const discriminatingOutcome = /\b(?:catch(?:es)?|conclusion\s+(?:changes|differs)|detect(?:s|ed)?|fail(?:s|ed)?|must\s+not\s+pass|reject(?:s|ed)?)\b/i;
  return transformation.test(text) && discriminatingOutcome.test(text);
}

function bindGeneralSchema(baseSchema, { sourceText, catalog }) {
  const schema = structuredClone(baseSchema);
  const exposedCatalog = catalog.filter((entry) => entry.kind !== "source_requirement");
  const segments = segmentCriterion(sourceText);
  schema.$defs.source_span.properties.text = { type: "string", enum: segments };
  const phraseTerminals = sourcePhraseTerminals(sourceText);
  if (phraseTerminals.length === 0) {
    schema.properties.variables.maxItems = 0;
  } else {
    schema.$defs.variable.properties.surface_text = { type: "string", enum: phraseTerminals };
  }
  schema.$defs.reference_id = {
    type: "string",
    enum: [
      ...exposedCatalog.map((entry) => entry.id), ...VARIABLE_IDS,
      ...COLLECTION_IDS
    ],
    description: `${exposedCatalog.map((entry) =>
      `${entry.id} = ${entry.surface} -> ${entry.identity} [${entry.type}]`
    ).join("\n")}\nVariables must be declared with exact source text. Collections must contain declared references.`
  };
  schema.$defs.member_reference_id = {
    type: "string",
    enum: [
      ...exposedCatalog.filter((entry) => entry.kind !== "requirement_set")
        .map((entry) => entry.id),
      ...VARIABLE_IDS
    ]
  };

  const numbers = numbersInSource(sourceText);
  if (numbers.length === 0) {
    schema.properties.number_claims.maxItems = 0;
    schema.properties.range_claims.maxItems = 0;
    schema.properties.verification_number_claims.maxItems = 0;
    schema.properties.verification_range_claims.maxItems = 0;
    for (const definition of CLAIM_DEFINITIONS) {
      schema.$defs[definition].properties.numeric_quantifiers.maxItems = 0;
    }
  } else {
    for (const definition of ["number_claim", "verification_number_claim"]) {
      schema.$defs[definition].properties.number_values.items.enum = numbers;
    }
    for (const definition of ["range_claim", "verification_range_claim"]) {
      schema.$defs[definition].properties.minimum_values.items.enum = numbers;
      schema.$defs[definition].properties.maximum_values.items.enum = numbers;
    }
    schema.$defs.numeric_quantifier.properties.amount.enum = numbers;
  }

  const counterfactualDeclared =
    /\b(?:revert(?:ed|ing)?|counterfactual|mutant(?:-kill)?)\b/i.test(sourceText) ||
    /\b(?:test|suite|check|proof|inspection|audit|analysis|demonstration)\b[^.!?;]{0,120}\b(?:must fail|fails? when)\b/i.test(sourceText);
  if (!counterfactualDeclared) {
    schema.properties.verification_reference_claims.maxItems = 0;
    schema.properties.verification_boolean_claims.maxItems = 0;
    schema.properties.verification_number_claims.maxItems = 0;
    schema.properties.verification_range_claims.maxItems = 0;
  }
  return schema;
}

function unresolvedIdentityMentions(sourceText, catalog) {
  const boundSurfaces = new Set(catalog.map((entry) =>
    entry.surface.replace(/^["'`]|["'`]$/g, "")
  ));
  return [...new Set(sourceText.match(
    /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\b/g
  ) ?? [])].filter((token) => {

    const identityShaped = token.includes(".") || token.includes("_") ||
      /[a-z][A-Z]/.test(token);
    const coveredByBoundSurface = [...boundSurfaces].some((surface) =>
      surface === token || surface.startsWith(`${token}-`) || surface.startsWith(`${token}#`) ||
      surface.endsWith(token) || surface.includes(token)
    );
    return identityShaped && !coveredByBoundSurface;
  });
}

function claimValues(claim, references) {
  if (claim.value_kind === "reference") {
    return claim.value_reference_ids.map((id) => references.get(id)?.identity ?? id);
  }
  if (claim.value_kind === "boolean") return claim.boolean_values.map(String);
  if (claim.value_kind === "number") return claim.number_values.map(String);
  return [`${claim.minimum_values[0] ?? "-inf"}..${claim.maximum_values[0] ?? "+inf"}`];
}

const CLAIM_ARRAYS = [
  ["reference_claims", "reference", false],
  ["boolean_claims", "boolean", false],
  ["number_claims", "number", false],
  ["range_claims", "range", false],
  ["verification_reference_claims", "reference", true],
  ["verification_boolean_claims", "boolean", true],
  ["verification_number_claims", "number", true],
  ["verification_range_claims", "range", true]
];
const CLAIM_DEFINITIONS = [
  "reference_claim", "boolean_claim", "number_claim", "range_claim",
  "verification_reference_claim", "verification_boolean_claim",
  "verification_number_claim", "verification_range_claim"
];

function structuredClaim(entry, valueKind, verification) {
  const applicabilityContext = entry.applicability_conditions.length === 0
    ? { mode: "unconditional", operand_reference_ids: [] }
    : entry.applicability_conditions[0];
  const quantifiers = [
    ...entry.set_quantifiers.map((quantifier) => ({ ...quantifier, amounts: [] })),
    ...entry.numeric_quantifiers.map((quantifier) => ({
      kind: quantifier.kind,
      variable_reference_ids: quantifier.variable_reference_ids,
      amounts: [quantifier.amount]
    }))
  ];
  const claim = {
    ...entry,
    claim_kind: verification ? "verification" : entry.claim_kind,
    value_kind: valueKind,
    value_reference_ids: entry.value_reference_ids ?? [],
    boolean_values: entry.boolean_values ?? [],
    number_values: entry.number_values ?? [],
    minimum_values: entry.minimum_values ?? [],
    maximum_values: entry.maximum_values ?? [],
    verification_methods: verification ? [entry.verification_method] : [],
    falsifying_condition_spans: verification ? entry.falsifying_condition_spans : [],
    applicability_context: applicabilityContext,
    quantifiers
  };
  delete claim.verification_method;
  delete claim.applicability_conditions;
  delete claim.set_quantifiers;
  delete claim.numeric_quantifiers;
  return claim;
}

function claimArraysFromLegacy(claims) {
  const arrays = Object.fromEntries(CLAIM_ARRAYS.map(([name]) => [name, []]));
  for (const claim of claims) {
    const verification = claim.claim_kind === "verification";
    const name = `${verification ? "verification_" : ""}${claim.value_kind}_claims`;
    const common = {
      source_spans: claim.source_spans,
      claim_kind: claim.claim_kind,
      modality: claim.modality,
      subject_reference_id: claim.subject_reference_id,
      predicate: claim.predicate,
      applicability_conditions: claim.applicability_context.mode === "unconditional"
        ? []
        : [claim.applicability_context],
      set_quantifiers: claim.quantifiers.filter((quantifier) =>
        !new Set(["exactly", "at_least", "at_most"]).has(quantifier.kind)
      ).map(({ amounts: ignoredAmounts, ...quantifier }) => quantifier),
      numeric_quantifiers: claim.quantifiers.filter((quantifier) =>
        new Set(["exactly", "at_least", "at_most"]).has(quantifier.kind)
      ).map((quantifier) => ({
        kind: quantifier.kind,
        variable_reference_ids: quantifier.variable_reference_ids,
        amount: quantifier.amounts[0]
      }))
    };
    if (claim.value_kind === "reference") common.value_reference_ids = claim.value_reference_ids;
    if (claim.value_kind === "boolean") common.boolean_values = claim.boolean_values;
    if (claim.value_kind === "number") common.number_values = claim.number_values;
    if (claim.value_kind === "range") {
      common.minimum_values = claim.minimum_values;
      common.maximum_values = claim.maximum_values;
    }
    if (verification) {
      common.verification_method = claim.verification_methods?.[0];
      common.falsifying_condition_spans = claim.falsifying_condition_spans ?? [];
    }
    arrays[name].push(common);
  }
  return arrays;
}

function normalizeGeneralPayload(payload) {
  const legacyClaims = Array.isArray(payload.claims) ? payload.claims : null;
  const claimArrays = legacyClaims === null
    ? Object.fromEntries(CLAIM_ARRAYS.map(([name]) => [name, payload[name] ?? []]))
    : claimArraysFromLegacy(legacyClaims.map((claim) => ({
      ...claim,
      verification_methods: claim.verification_methods ?? [],
      falsifying_condition_spans: claim.falsifying_condition_spans ?? []
    })));
  const {
    claims: ignoredLegacyClaims,
    requirements: ignoredLegacyRequirements,
    requirement_sets: ignoredLegacyRequirementSets,
    ...payloadWithoutLegacyClaims
  } = payload;
  return {
    ...payloadWithoutLegacyClaims,
    collections: payload.collections ?? [],
    ...claimArrays
  };
}

function evaluateGeneralContract(payload, { sourceText, catalog }) {
  const normalizedPayload = normalizeGeneralPayload(payload);
  const validSchema = validateBase(normalizedPayload);
  if (!validSchema) {
    return {
      schema_valid: false,
      schema_errors: structuredClone(validateBase.errors),
      diagnostics: [],
      evaluation: null
    };
  }
  payload = normalizedPayload;
  const claims = CLAIM_ARRAYS.flatMap(([name, valueKind, verification]) =>
    payload[name].map((entry) => structuredClaim(entry, valueKind, verification))
  );
  const diagnostics = [];
  const segments = segmentCriterion(sourceText);
  const segmentSet = new Set(segments);
  const normalizedSegments = new Set(segments.map(normalizeSurfaceText));
  const references = new Map(catalog.map((entry) => [entry.id, entry]));
  const variableIds = new Set();
  for (const variable of payload.variables) {
    if (variableIds.has(variable.variable_id)) {
      diagnostics.push({ code: "duplicate_variable_id", variable_id: variable.variable_id });
      continue;
    }
    variableIds.add(variable.variable_id);
    if (!sourceText.includes(variable.surface_text)) {
      diagnostics.push({ code: "variable_surface_not_verbatim", variable_id: variable.variable_id });
      continue;
    }
    const normalizedSurface = normalizeSurfaceText(variable.surface_text);
    const clauseSized = normalizedSurface === normalizeSurfaceText(sourceText) ||
      normalizedSegments.has(normalizedSurface);
    if (clauseSized) {
      diagnostics.push({ code: "variable_surface_is_entire_clause", variable_id: variable.variable_id });
      continue;
    }
    if (variable.surface_text.split(",").length >= 3) {
      diagnostics.push({ code: "variable_surface_is_compound_list", variable_id: variable.variable_id });
      continue;
    }
    references.set(variable.variable_id, {
      id: variable.variable_id,
      kind: "variable",
      surface: variable.surface_text,
      identity: `contract-variable:${variable.type_term}:${canonicalVariableSurface(variable.surface_text)}`,
      type: variable.type_term,
      grounded: true
    });
  }
  const collectionIds = new Set();
  for (const collection of payload.collections) {
    if (collectionIds.has(collection.collection_id)) {
      diagnostics.push({ code: "duplicate_collection_id", collection_id: collection.collection_id });
      continue;
    }
    collectionIds.add(collection.collection_id);
    const uniqueMembers = new Set(collection.member_reference_ids);
    if (uniqueMembers.size !== collection.member_reference_ids.length) {
      diagnostics.push({ code: "duplicate_collection_member", collection_id: collection.collection_id });
      continue;
    }
    const members = collection.member_reference_ids.map((id) => references.get(id));
    if (members.some((member) => member === undefined)) {
      diagnostics.push({ code: "collection_member_not_bound", collection_id: collection.collection_id });
      continue;
    }
    if (members.some((member) => member.kind === "source_requirement")) {
      diagnostics.push({ code: "requirement_member_requires_requirement_set", collection_id: collection.collection_id });
      continue;
    }
    const identities = members.map((member) => member.identity);
    references.set(collection.collection_id, {
      id: collection.collection_id,
      kind: collection.collection_kind,
      surface: members.map((member) => member.surface).join(
        collection.collection_kind === "ordered_sequence" ? " then " : ", "
      ),
      identity: `${collection.collection_kind}:${JSON.stringify(identities)}`,
      type: collection.collection_kind === "ordered_sequence" ? "cc:sequence" : "cc:set",
      member_reference_ids: collection.member_reference_ids,
      grounded: true
    });
  }
  const admitted = [];
  const carrierOverlap = [];
  const representedSegments = new Set();

  const checkReference = (id, owner) => {
    if (!references.has(id)) diagnostics.push({ code: "reference_not_bound", reference_id: id, owner });
  };
  for (const [index, claim] of claims.entries()) {
    const owner = `claim-${index + 1}`;
    for (const span of claim.source_spans) {
      if (!segmentSet.has(span.text)) diagnostics.push({ code: "source_span_not_bound", owner, text: span.text });
      else representedSegments.add(span.text);
    }
    checkReference(claim.subject_reference_id, owner);
    for (const id of claim.value_reference_ids ?? []) {
      checkReference(id, owner);
    }
    for (const id of [claim.subject_reference_id, ...(claim.value_reference_ids ?? [])]) {
      if (references.get(id)?.kind === "source_requirement") {
        diagnostics.push({ code: "source_requirement_used_as_opaque_claim_operand", owner, reference_id: id });
      }
    }
    if (IRREFLEXIVE_PREDICATES.has(claim.predicate) &&
        claim.value_reference_ids.includes(claim.subject_reference_id)) {
      diagnostics.push({
        code: "irreflexive_predicate_self_reference",
        owner,
        predicate: claim.predicate,
        reference_id: claim.subject_reference_id
      });
    }
    for (const id of claim.applicability_context.operand_reference_ids) checkReference(id, owner);
    for (const quantifier of claim.quantifiers) {
      for (const id of quantifier.variable_reference_ids) checkReference(id, owner);
      const needsAmount = new Set(["exactly", "at_least", "at_most"]).has(quantifier.kind);
      if (needsAmount !== (quantifier.amounts.length === 1)) {
        diagnostics.push({ code: "quantifier_amount_shape", owner, quantifier: quantifier.kind });
      }
    }
    if (!PREDICATE_GROUPS[claim.value_kind].has(claim.predicate)) {
      diagnostics.push({
        code: "predicate_value_kind_mismatch",
        owner,
        predicate: claim.predicate,
        value_kind: claim.value_kind
      });
    }
    const populatedValueFields = {
      reference: claim.value_reference_ids.length > 0,
      boolean: claim.boolean_values.length > 0,
      number: claim.number_values.length > 0,
      range: claim.minimum_values.length > 0 || claim.maximum_values.length > 0
    };
    for (const [valueKind, populated] of Object.entries(populatedValueFields)) {
      if (populated !== (valueKind === claim.value_kind)) {
        diagnostics.push({ code: "value_field_shape", owner, value_kind: claim.value_kind });
        break;
      }
    }
    const verificationShape = claim.verification_methods.length === 1 && claim.falsifying_condition_spans.length > 0;
    const nonVerificationShape = claim.verification_methods.length === 0 && claim.falsifying_condition_spans.length === 0;
    if (claim.claim_kind === "verification" ? !verificationShape : !nonVerificationShape) {
      diagnostics.push({ code: "verification_shape", owner, claim_kind: claim.claim_kind });
    }
    if (claim.predicate === "has_property") {
      for (const id of claim.value_reference_ids) {
        if (references.get(id)?.kind !== "profile_term") {
          diagnostics.push({ code: "property_value_not_controlled_property", owner, reference_id: id });
        }
      }
    }
    for (const span of claim.falsifying_condition_spans) {
      if (!segmentSet.has(span.text)) diagnostics.push({ code: "falsifier_span_not_bound", owner, text: span.text });
      else {
        representedSegments.add(span.text);
        if (!hasDiscriminatingFalsifierText(span.text)) {
          diagnostics.push({ code: "falsifier_not_discriminating", owner, text: span.text });
        }
      }
    }
    const subject = references.get(claim.subject_reference_id);
    const values = (claim.value_reference_ids ?? []).map((id) => references.get(id));
    const verificationChecklistHeader = claim.source_spans.some((span) =>
      span.text.endsWith(":") &&
      /\b(?:test|verify|inspect|audit|prove|demonstrate|analy[sz]e)\b/i.test(span.text)
    );
    if (verificationChecklistHeader && values.some((value) => value?.kind === "requirement_set") &&
        !(claim.predicate === "covers" && new Set(["cc:test", "cc:evidence", "cc:artifact"]).has(subject?.type))) {
      diagnostics.push({
        code: "verification_checklist_header_not_expressed",
        owner,
        predicate: claim.predicate,
        subject_type: subject?.type ?? null
      });
    }
    for (const value of values) {
      if (claim.predicate === "covers" && value?.kind === "ordered_sequence") {
        diagnostics.push({
          code: "predicate_collection_kind_mismatch",
          owner,
          predicate: claim.predicate,
          collection_kind: value.kind
        });
      }
      if (claim.predicate === "ordered_as" && value?.kind !== "ordered_sequence") {
        diagnostics.push({
          code: "predicate_collection_kind_mismatch",
          owner,
          predicate: claim.predicate,
          collection_kind: value?.kind ?? null
        });
      }
    }
    const signature = PREDICATE_SIGNATURES[claim.predicate];
    if (signature?.subjects && subject && !signature.subjects.has(subject.type)) {
      diagnostics.push({
        code: "predicate_subject_type_mismatch",
        owner,
        predicate: claim.predicate,
        subject_type: subject.type
      });
    }
    if (signature?.values) {
      for (const value of values) {
        if (value && !signature.values.has(value.type)) {
          diagnostics.push({
            code: "predicate_value_type_mismatch",
            owner,
            predicate: claim.predicate,
            value_type: value.type
          });
        }
      }
    }
    const traceSerializedAsClaim = claim.predicate === "conforms_to" &&
      values.some((value) => value?.type === "pwt:work_unit" || value?.type === "pwt:slice" || value?.type === "pwt:work_record");
    if ((subject?.type?.startsWith("pwt:") && CARRIER_PREDICATES.has(claim.predicate)) || traceSerializedAsClaim) {
      carrierOverlap.push({ owner, predicate: claim.predicate, subject_reference_id: claim.subject_reference_id });
    } else {
      admitted.push({ ...claim, owner });
    }
  }

  for (const [index, relation] of payload.relations.entries()) {
    const owner = `relation-${index + 1}`;
    checkReference(relation.source_reference_id, owner);
    checkReference(relation.target_reference_id, owner);
    const source = references.get(relation.source_reference_id);
    const target = references.get(relation.target_reference_id);
    const signature = RELATION_SIGNATURES[relation.role];
    const targetSignature = target?.kind === "requirement_set" ? "requirement_set" : target?.type;
    if (signature?.sources && source && !signature.sources.has(source.type)) {
      diagnostics.push({
        code: "relation_source_type_mismatch",
        owner,
        role: relation.role,
        source_type: source.type
      });
    }
    if (signature?.targets && target && !signature.targets.has(targetSignature)) {
      diagnostics.push({
        code: "relation_target_type_mismatch",
        owner,
        role: relation.role,
        target_type: targetSignature
      });
    }
    for (const span of relation.source_spans) {
      if (!segmentSet.has(span.text)) diagnostics.push({ code: "source_span_not_bound", owner, text: span.text });

    }
  }
  const rejectedOwners = new Set(diagnostics.map((diagnostic) => diagnostic.owner).filter(Boolean));
  const acceptedClaims = admitted.filter((claim) => !rejectedOwners.has(claim.owner));
  const acceptedRelations = payload.relations.filter((_, index) =>
    !rejectedOwners.has(`relation-${index + 1}`)
  );
  representedSegments.clear();
  for (const claim of acceptedClaims) {
    for (const span of claim.source_spans) representedSegments.add(span.text);
    for (const span of claim.falsifying_condition_spans) representedSegments.add(span.text);
    for (const referenceId of claim.value_reference_ids) {
      const collection = references.get(referenceId);
      if (collection?.kind === "requirement_set") continue;
      for (const memberId of collection?.member_reference_ids ?? []) {
        const memberSurface = normalizeSurfaceText(references.get(memberId)?.surface ?? "");
        for (const segment of segments) {
          if (normalizeSurfaceText(segment) === memberSurface) representedSegments.add(segment);
        }
      }
    }
  }
  for (const relation of acceptedRelations) {
    const target = references.get(relation.target_reference_id);
    if (target?.kind === "requirement_set") continue;
    for (const memberId of target?.member_reference_ids ?? []) {
      const memberSurface = normalizeSurfaceText(references.get(memberId)?.surface ?? "");
      for (const segment of segments) {
        if (normalizeSurfaceText(segment) === memberSurface) representedSegments.add(segment);
      }
    }
  }

  const usedReferenceIds = new Set();
  const addUsedReference = (id) => {
    if (usedReferenceIds.has(id)) return;
    usedReferenceIds.add(id);
    for (const memberId of references.get(id)?.member_reference_ids ?? []) addUsedReference(memberId);
  };
  for (const claim of acceptedClaims) {
    addUsedReference(claim.subject_reference_id);
    for (const id of claim.value_reference_ids) addUsedReference(id);
    for (const id of claim.applicability_context.operand_reference_ids) addUsedReference(id);
    for (const quantifier of claim.quantifiers) {
      for (const id of quantifier.variable_reference_ids) addUsedReference(id);
    }
  }
  for (const relation of acceptedRelations) {
    addUsedReference(relation.source_reference_id);
    addUsedReference(relation.target_reference_id);
  }

  const unresolvedIdentities = unresolvedIdentityMentions(sourceText, [...references.values()]);
  const residueTexts = segments.filter((segment) =>
    !representedSegments.has(segment) || unresolvedIdentities.some((identity) => segment.includes(identity))
  ).map((text) => ({ text, reason: "unsupported_by_controlled_grammar" }));
  for (const claim of admitted.filter((entry) => rejectedOwners.has(entry.owner))) {
    if (!claim.source_spans.some((span) => representedSegments.has(span.text))) continue;
    const operandIds = [
      claim.subject_reference_id,
      ...claim.value_reference_ids,
      ...claim.applicability_context.operand_reference_ids,
      ...claim.quantifiers.flatMap((quantifier) => quantifier.variable_reference_ids)
    ];
    for (const id of operandIds) {
      if (usedReferenceIds.has(id)) continue;
      const reference = references.get(id);
      if (reference?.kind !== "variable") continue;
      if (!claim.source_spans.some((span) => span.text.includes(reference.surface))) continue;
      residueTexts.push({ text: reference.surface, reason: "rejected_claim_operand" });
    }
  }
  const usedSurfaces = [...usedReferenceIds]
    .map((id) => references.get(id)?.surface)
    .filter(Boolean)
    .map(normalizeSurfaceText);
  const usedPredicateTerms = new Set(acceptedClaims.flatMap((claim) =>
    claim.predicate.split("_").map((term) => term.replace(/s$/, ""))
  ));
  for (const variable of payload.variables) {
    if (usedReferenceIds.has(variable.variable_id)) continue;
    diagnostics.push({ code: "unused_variable", variable_id: variable.variable_id });
    const normalizedVariable = normalizeSurfaceText(variable.surface_text);
    if (usedSurfaces.some((surface) => surface === normalizedVariable)) continue;
    const variableTerms = normalizedVariable.split(/\s+/).map((term) => term.replace(/s$/, ""));
    if (variableTerms.length === 1 && usedPredicateTerms.has(variableTerms[0])) continue;
  }
  for (const collection of payload.collections) {
    if (!usedReferenceIds.has(collection.collection_id)) {
      diagnostics.push({ code: "unused_collection", collection_id: collection.collection_id });
    }
  }
  const attemptedSegments = new Set(claims.flatMap((claim) =>
    claim.source_spans.map((span) => span.text)
  ));
  for (const segment of segments) {
    if (!representedSegments.has(segment) && !attemptedSegments.has(segment)) continue;
    for (const fragment of coordinatedFragments(segment)) {
      const normalizedFragment = normalizeSurfaceText(fragment);
      const covered = usedSurfaces.some((surface) =>
        normalizedFragment.includes(surface) || surface.includes(normalizedFragment)
      );
      if (!covered) residueTexts.push({ text: fragment, reason: "unrepresented_enumerated_operand" });
    }
  }
  const residueByText = new Map();
  for (const entry of residueTexts) {
    const existing = residueByText.get(entry.text);
    if (existing === undefined) {
      residueByText.set(entry.text, { ...entry, diagnostic_reasons: [entry.reason] });
    } else if (!existing.diagnostic_reasons.includes(entry.reason)) {
      existing.diagnostic_reasons.push(entry.reason);
    }
  }
  const residue = [...residueByText.values()].map(({ text, reason, diagnostic_reasons: diagnosticReasons }, index) => ({
    residue_id: `derived-residue-${String(index + 1).padStart(4, "0")}`,
    text,
    reason,
    diagnostic_reasons: diagnosticReasons,
    origin: "compiler"
  }));

  const slots = new Map();
  for (const claim of acceptedClaims.filter((entry) => entry.modality === "MUST" || entry.modality === "MUST_NOT")) {
    const contextKey = JSON.stringify(claim.applicability_context);
    const slotKey = [claim.claim_kind, claim.subject_reference_id, claim.predicate, contextKey].join("::");
    const slot = slots.get(slotKey) ?? { must: [], must_not: [] };
    slot[claim.modality === "MUST" ? "must" : "must_not"].push(new Set(claimValues(claim, references)));
    slots.set(slotKey, slot);
  }
  const reviewCandidates = [];
  for (const [slotKey, slot] of slots) {
    if (slot.must.length === 0) continue;
    const predicate = slotKey.split("::")[2];
    let conflict = false;
    if (FUNCTIONAL_PREDICATES.has(predicate)) {
      let allowed = new Set(slot.must[0]);
      for (const values of slot.must.slice(1)) {
        allowed = new Set([...allowed].filter((value) => values.has(value)));
      }
      for (const excluded of slot.must_not) {
        allowed = new Set([...allowed].filter((value) => !excluded.has(value)));
      }
      conflict = allowed.size === 0;
    } else {
      const required = new Set(slot.must.flatMap((values) => [...values]));
      const excluded = new Set(slot.must_not.flatMap((values) => [...values]));
      conflict = [...required].some((value) => excluded.has(value));
    }
    if (conflict) {
      reviewCandidates.push({
        code: "closed_slot_empty_intersection",
        slot: slotKey,
        authority: "review_candidate_only"
      });
    }
  }

  return {
    schema_valid: true,
    schema_errors: [],
    diagnostics,
    evaluation: {
      grammar_version: "controlled-contract-general-evaluation.experimental.v0.26",
      structurally_valid: true,
      compiler_clean: diagnostics.length === 0,
      admitted_claims: acceptedClaims.length,
      rejected_claims: claims.length - acceptedClaims.length - carrierOverlap.length,
      admitted_relations: acceptedRelations.length,
      rejected_relations: payload.relations.length - acceptedRelations.length,
      carrier_overlap: carrierOverlap,
      residue,
      residue_entries: residue.length + carrierOverlap.length,
      status: acceptedClaims.length + acceptedRelations.length === 0 ? "residue_only" :
          residue.length + carrierOverlap.length + diagnostics.length === 0 ? "complete" : "partial",
      arithmetic: {
        evaluated_slots: slots.size,
        review_candidates: reviewCandidates
      }
    }
  };
}

export {
  BASE_SCHEMA,
  bindGeneralSchema,
  buildReferenceCatalog,
  coordinatedFragments,
  evaluateGeneralContract,
  hasDiscriminatingFalsifierText,
  normalizeGeneralPayload,
  numbersInSource,
  segmentCriterion,
  sourcePhraseTerminals,
  unresolvedIdentityMentions
};
