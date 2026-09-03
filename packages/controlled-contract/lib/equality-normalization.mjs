const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function rawApplicability(context) {
  return {
    mode: context.mode,
    operand_reference_ids: [...new Set(context.operand_reference_ids)].sort(compareCodeUnits)
  };
}

class EqualityClass {
  #parent = new Map();

  find(value) {
    if (!this.#parent.has(value)) this.#parent.set(value, value);
    const current = this.#parent.get(value);
    if (current !== value) this.#parent.set(value, this.find(current));
    return this.#parent.get(value);
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [canonical, other] = [leftRoot, rightRoot].sort(compareCodeUnits);
    this.#parent.set(other, canonical);
  }
}

function mandatoryEqualityClaims(contract) {
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

function normalizeWith(equality, context) {
  const raw = rawApplicability(context);
  return {
    mode: raw.mode,
    operand_reference_ids: [...new Set(raw.operand_reference_ids.map(
      (referenceId) => equality.find(referenceId)
    ))].sort(compareCodeUnits)
  };
}

const contextKey = (context) => JSON.stringify(context);

function buildGroup(claims, globalEquality) {
  const equality = new EqualityClass();
  const global = (value) => globalEquality.find(value);
  for (const claim of claims) for (const operand of claim.operands) {
    equality.union(global(claim.subject_reference_id), global(operand.reference_id));
  }
  const contexts = claims.map((claim) => normalizeWith({
    find: (value) => equality.find(global(value))
  }, claim.applicability_context));
  return { claims, equality, contexts };
}

function contextsOverlap(left, right, globalEquality) {
  if (left.contexts[0].mode !== right.contexts[0].mode) return false;
  const normalize = (group, context) => contextKey(normalizeWith({
    find: (value) => group.equality.find(globalEquality.find(value))
  }, context));
  return left.claims.some((leftClaim) => right.claims.some((rightClaim) =>
    normalize(left, leftClaim.applicability_context) ===
      normalize(left, rightClaim.applicability_context) ||
    normalize(right, leftClaim.applicability_context) ===
      normalize(right, rightClaim.applicability_context)
  ));
}

function buildEqualityNormalization(contract) {
  const equalityClaims = mandatoryEqualityClaims(contract);
  const globalEquality = new EqualityClass();
  for (const proposition of equalityClaims.filter(
    ({ applicability_context: context }) => context.mode === "unconditional"
  )) for (const operand of proposition.operands) {
    globalEquality.union(proposition.subject_reference_id, operand.reference_id);
  }

  let groups = equalityClaims
    .filter(({ applicability_context: context }) => context.mode !== "unconditional")
    .map((claim) => buildGroup([claim], globalEquality));
  for (;;) {
    let merged = false;
    const next = [];
    while (groups.length > 0) {
      let current = groups.shift();
      for (let index = 0; index < groups.length;) {
        if (!contextsOverlap(current, groups[index], globalEquality)) {
          index += 1;
          continue;
        }
        current = buildGroup(
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
    rawApplicability(context));
  const ambiguousContexts = [];

  function matchingGroups(context) {
    if (context.mode === "unconditional") return [];
    return groups.filter((group) => {
      if (group.contexts[0].mode !== context.mode) return false;
      const normalizedCandidate = normalizeWith({
        find: (value) => group.equality.find(globalEquality.find(value))
      }, context);
      return group.claims.some((claim) => contextKey(normalizedCandidate) === contextKey(
        normalizeWith({
          find: (value) => group.equality.find(globalEquality.find(value))
        }, claim.applicability_context)
      ));
    });
  }

  for (const context of allContexts) {
    const matches = matchingGroups(context);
    const normalized = new Set(matches.map((group) => contextKey(normalizeWith({
      find: (value) => group.equality.find(globalEquality.find(value))
    }, context))));
    if (normalized.size > 1) ambiguousContexts.push(rawApplicability(context));
  }

  function groupFor(context) {
    const matches = matchingGroups(rawApplicability(context));
    return matches.sort((left, right) => compareCodeUnits(
      contextKey(left.contexts[0]), contextKey(right.contexts[0])
    ))[0] ?? null;
  }

  function canonicalize(referenceId, context) {
    const global = globalEquality.find(referenceId);
    const group = groupFor(context);
    return group ? group.equality.find(global) : global;
  }

  function normalizeApplicability(context) {
    const raw = rawApplicability(context);
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

export { buildEqualityNormalization, rawApplicability };
