import { canonicalJsonBytes } from "./deterministic-projection-primitives.mjs";

class StableSemanticError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StableSemanticError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const compareCodeUnits = (left, right) => {
  const leftString = String(left);
  const rightString = String(right);
  return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
};

function canonicalizeStableValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeStableValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map(
      (key) => [key, canonicalizeStableValue(value[key])]
    )
  );
  if (typeof value === "number" && !Number.isFinite(value)) throw new StableSemanticError(
    "stable_equality_value_invalid", "semantic values must be finite canonical JSON values"
  );
  return typeof value === "string" ? value.normalize("NFC") : value;
}

function stableSemanticKey(value) {
  return canonicalJsonBytes(canonicalizeStableValue(value)).toString("utf8");
}

function defaultIdentity(value) {
  if (typeof value === "string") return value.normalize("NFC");
  for (const key of [
    "occurrence_id", "source_occurrence_id", "reference_id", "association_id",
    "edge_id", "part_id"
  ]) if (typeof value?.[key] === "string") return value[key].normalize("NFC");
  return canonicalizeStableValue(value);
}

function normalizeStableSet(values, {
  identity = defaultIdentity,
  duplicate = "ignore"
} = {}) {
  if (!Array.isArray(values)) throw new StableSemanticError(
    "stable_population_invalid", "a semantic set must be represented by an array"
  );
  const selected = new Map();
  for (const [index, value] of values.entries()) {
    const key = stableSemanticKey(identity(value));
    if (selected.has(key) && duplicate === "refuse") throw new StableSemanticError(
      "stable_population_member_duplicate",
      "a complete semantic population cannot repeat an equality-normalized member",
      { index, identity: canonicalizeStableValue(identity(value)) }
    );
    if (!selected.has(key)) selected.set(key, canonicalizeStableValue(value));
  }
  return Object.freeze([...selected.entries()].sort(
    ([left], [right]) => compareCodeUnits(left, right)
  ).map(([, value]) => Object.freeze(value)));
}

function buildReferenceEqualityNormalizer(equalities = []) {
  const parent = new Map();
  const find = (value) => {
    const normalized = value.normalize("NFC");
    if (!parent.has(normalized)) parent.set(normalized, normalized);
    const current = parent.get(normalized);
    if (current !== normalized) parent.set(normalized, find(current));
    return parent.get(normalized);
  };
  for (const [index, edge] of equalities.entries()) {
    if (!Array.isArray(edge) || edge.length !== 2 || edge.some(
      (value) => typeof value !== "string" || value.length === 0
    )) throw new StableSemanticError(
      "stable_equality_edge_invalid", "equality edges must contain two reference identities",
      { index }
    );
    const left = find(edge[0]);
    const right = find(edge[1]);
    if (left !== right) {
      const [canonical, alias] = [left, right].sort(compareCodeUnits);
      parent.set(alias, canonical);
    }
  }
  return Object.freeze({
    normalize(referenceId) { return find(referenceId); },
    equivalent(left, right) { return find(left) === find(right); },
    normalizeSet(values, options = {}) {
      return normalizeStableSet(values, {
        ...options,
        identity: (value) => find(options.identity?.(value) ?? defaultIdentity(value))
      });
    }
  });
}

function rawApplicabilityV1(context) {
  return {
    mode: context.mode,
    operand_reference_ids: [...new Set(context.operand_reference_ids)]
      .sort(compareCodeUnits)
  };
}

class ScopedEqualityClassV1 {
  #parent = new Map();

  find(value) {
    const normalized = value.normalize("NFC");
    if (!this.#parent.has(normalized)) this.#parent.set(normalized, normalized);
    const current = this.#parent.get(normalized);
    if (current !== normalized) this.#parent.set(normalized, this.find(current));
    return this.#parent.get(normalized);
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [canonical, alias] = [leftRoot, rightRoot].sort(compareCodeUnits);
    this.#parent.set(alias, canonical);
  }
}

function mandatoryEqualityPropositionsV1(contract) {
  const propositionById = new Map(contract.propositions.map((proposition) => [
    proposition.proposition_id, proposition
  ]));
  return contract.claims
    .filter(({ kind, modality }) =>
      ["behavior", "evidence"].includes(kind) && modality === "MUST"
    )
    .map((claim) => propositionById.get(claim.proposition_id))
    .filter((proposition) => proposition?.operator === "reference:equals" &&
      proposition.operands.every(({ kind }) => kind === "reference"));
}

function normalizeApplicabilityWithV1(equality, context) {
  const raw = rawApplicabilityV1(context);
  return {
    mode: raw.mode,
    operand_reference_ids: [...new Set(raw.operand_reference_ids.map(
      (referenceId) => equality.find(referenceId)
    ))].sort(compareCodeUnits)
  };
}

const applicabilityKeyV1 = (context) => JSON.stringify(context);

function buildScopedEqualityGroupV1(claims, globalEquality) {
  const equality = new ScopedEqualityClassV1();
  const global = (value) => globalEquality.find(value);
  for (const claim of claims) for (const operand of claim.operands) {
    equality.union(global(claim.subject_reference_id), global(operand.reference_id));
  }
  const contexts = claims.map((claim) => normalizeApplicabilityWithV1({
    find: (value) => equality.find(global(value))
  }, claim.applicability_context));
  return { claims, equality, contexts };
}

function scopedEqualityContextsOverlapV1(left, right, globalEquality) {
  if (left.contexts[0].mode !== right.contexts[0].mode) return false;
  const normalize = (group, context) => applicabilityKeyV1(
    normalizeApplicabilityWithV1({
      find: (value) => group.equality.find(globalEquality.find(value))
    }, context)
  );
  return left.claims.some((leftClaim) => right.claims.some((rightClaim) =>
    normalize(left, leftClaim.applicability_context) ===
      normalize(left, rightClaim.applicability_context) ||
    normalize(right, leftClaim.applicability_context) ===
      normalize(right, rightClaim.applicability_context)
  ));
}

function buildEqualityNormalizationV1(contract) {
  const equalityClaims = mandatoryEqualityPropositionsV1(contract);
  const globalEquality = new ScopedEqualityClassV1();
  for (const proposition of equalityClaims.filter(
    ({ applicability_context: context }) => context.mode === "unconditional"
  )) for (const operand of proposition.operands) {
    globalEquality.union(proposition.subject_reference_id, operand.reference_id);
  }

  let groups = equalityClaims
    .filter(({ applicability_context: context }) => context.mode !== "unconditional")
    .map((claim) => buildScopedEqualityGroupV1([claim], globalEquality));
  for (;;) {
    let merged = false;
    const next = [];
    while (groups.length > 0) {
      let current = groups.shift();
      for (let index = 0; index < groups.length;) {
        if (!scopedEqualityContextsOverlapV1(current, groups[index], globalEquality)) {
          index += 1;
          continue;
        }
        current = buildScopedEqualityGroupV1(
          [...current.claims, ...groups[index].claims], globalEquality
        );
        groups.splice(index, 1);
        merged = true;
      }
      next.push(current);
    }
    groups = next;
    if (!merged) break;
  }

  const allContexts = contract.propositions.map(({ applicability_context: context }) =>
    rawApplicabilityV1(context));
  const ambiguousContexts = [];

  function matchingGroups(context) {
    if (context.mode === "unconditional") return [];
    return groups.filter((group) => {
      if (group.contexts[0].mode !== context.mode) return false;
      const normalizedCandidate = normalizeApplicabilityWithV1({
        find: (value) => group.equality.find(globalEquality.find(value))
      }, context);
      return group.claims.some((claim) =>
        applicabilityKeyV1(normalizedCandidate) === applicabilityKeyV1(
          normalizeApplicabilityWithV1({
            find: (value) => group.equality.find(globalEquality.find(value))
          }, claim.applicability_context)
        ));
    });
  }

  for (const context of allContexts) {
    const matches = matchingGroups(context);
    const normalized = new Set(matches.map((group) => applicabilityKeyV1(
      normalizeApplicabilityWithV1({
        find: (value) => group.equality.find(globalEquality.find(value))
      }, context)
    )));
    if (normalized.size > 1) ambiguousContexts.push(rawApplicabilityV1(context));
  }

  function groupFor(context) {
    const matches = matchingGroups(rawApplicabilityV1(context));
    return matches.sort((left, right) => compareCodeUnits(
      applicabilityKeyV1(left.contexts[0]), applicabilityKeyV1(right.contexts[0])
    ))[0] ?? null;
  }

  function canonicalize(referenceId, context) {
    const global = globalEquality.find(referenceId);
    const group = groupFor(context);
    return group ? group.equality.find(global) : global;
  }

  function normalizeApplicability(context) {
    const raw = rawApplicabilityV1(context);
    return {
      mode: raw.mode,
      operand_reference_ids: [...new Set(raw.operand_reference_ids.map(
        (referenceId) => canonicalize(referenceId, raw)
      ))].sort(compareCodeUnits)
    };
  }

  return Object.freeze({
    ambiguous_contexts: Object.freeze(ambiguousContexts),
    canonicalize,
    equivalent: (left, right, context) =>
      canonicalize(left, context) === canonicalize(right, context),
    normalizeApplicability
  });
}

export {
  StableSemanticError,
  buildEqualityNormalizationV1,
  buildReferenceEqualityNormalizer,
  canonicalizeStableValue,
  compareCodeUnits,
  normalizeStableSet,
  rawApplicabilityV1,
  stableSemanticKey
};
