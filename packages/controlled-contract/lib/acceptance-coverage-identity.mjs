import {
  canonicalDigest,
  unsupportedObjectKeys
} from "./deterministic-projection-primitives.mjs";

const BINDING_DIGESTS = Object.freeze([
  "contractDigest",
  "proofPlanDigest",
  "selectedPackDigest",
  "mappingDigest"
]);
const CRITERION_KEYS = Object.freeze(["text", "typed_identity"]);
const IDENTITY_ENTRY_KEYS = Object.freeze(["position", "text", "identity", "source"]);
const IDENTITY_SOURCES = new Set(["derived", "typed"]);

class AcceptanceCoverageIdentityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AcceptanceCoverageIdentityError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new AcceptanceCoverageIdentityError(
      "criterion_identity_input_invalid",
      `${label} must be a non-empty string`, { label }
    );
  }
  return value;
}

function invalidCriterion(message, details = {}) {
  throw new AcceptanceCoverageIdentityError(
    "criterion_identity_input_invalid", message, details
  );
}

function typedIdentityOf(criterion) {
  if (!Object.hasOwn(criterion, "typed_identity")) return null;
  return requireString(criterion.typed_identity, "typed_identity");
}

function criterionText(criterion, index) {
  if (typeof criterion === "string") return criterion;
  if (criterion && typeof criterion === "object") {
    const unsupported = unsupportedObjectKeys(criterion, CRITERION_KEYS);
    if (unsupported.length > 0) {
      invalidCriterion(`criteria[${index}] contains unsupported keys`, {
        index, unsupportedKeys: unsupported
      });
    }
    return requireString(criterion.text, `criteria[${index}].text`);
  }
  invalidCriterion(`criteria[${index}] must be a string or object`, { index });
}

function criterionIdentityDigest(position, text) {
  return canonicalDigest({ position, text });
}

function bindingFrom(input) {
  const source = input.bindings ?? input;
  const bindings = {};
  for (const name of BINDING_DIGESTS) {
    bindings[name] = requireString(source[name], `bindings.${name}`);
  }
  return Object.freeze(bindings);
}

function normalizeCriterionIdentityEntry(entry, label = "identity entry") {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new AcceptanceCoverageIdentityError(
      "criterion_identity_entry_invalid", `${label} must be an object`, { label }
    );
  }
  const unsupported = unsupportedObjectKeys(entry, IDENTITY_ENTRY_KEYS);
  if (unsupported.length > 0) {
    throw new AcceptanceCoverageIdentityError(
      "criterion_identity_entry_invalid", `${label} contains unsupported keys`,
      { label, unsupportedKeys: unsupported }
    );
  }
  if (!Number.isInteger(entry.position) || entry.position < 0) {
    throw new AcceptanceCoverageIdentityError(
      "criterion_identity_entry_invalid", `${label}.position must be a non-negative integer`, { label }
    );
  }
  const text = requireString(entry.text, `${label}.text`);
  const identity = requireString(entry.identity, `${label}.identity`);
  if (!IDENTITY_SOURCES.has(entry.source)) {
    throw new AcceptanceCoverageIdentityError(
      "criterion_identity_entry_invalid", `${label}.source is invalid`, { label }
    );
  }
  return Object.freeze({ position: entry.position, text, identity, source: entry.source });
}

function deriveCriterionIdentitySet({
  criteria,
  selectedUnitDigest,
  bindings,
  contractDigest,
  proofPlanDigest,
  selectedPackDigest,
  mappingDigest
}) {
  if (!Array.isArray(criteria)) {
    throw new AcceptanceCoverageIdentityError(
      "criterion_identity_input_invalid", "criteria must be an array"
    );
  }
  const resolvedBindings = bindingFrom(bindings ?? {
    contractDigest, proofPlanDigest, selectedPackDigest, mappingDigest
  });
  const unitDigest = requireString(selectedUnitDigest, "selectedUnitDigest");
  const identities = criteria.map((criterion, index) => {
    const text = criterionText(criterion, index);
    const typedIdentity = typeof criterion === "string" ? null : typedIdentityOf(criterion);
    const identity = typedIdentity ?? `derived:${criterionIdentityDigest(index, text)}`;
    return normalizeCriterionIdentityEntry({
      position: index,
      text,
      identity,
      source: typedIdentity === null ? "derived" : "typed"
    }, `criteria[${index}]`);
  });
  return Object.freeze({
    version: "acceptance-coverage-criterion-identity.v1",
    identities: Object.freeze(identities),
    bindings: resolvedBindings,
    provenance: Object.freeze({ selectedUnitDigest: unitDigest }),
    digest: canonicalDigest({ identities, bindings: resolvedBindings })
  });
}

function compareCriterionIdentitySets(prior, current) {
  if (!prior || !current || !Array.isArray(prior.identities) ||
      !Array.isArray(current.identities)) {
    throw new AcceptanceCoverageIdentityError(
      "criterion_identity_set_invalid", "both identity sets must be valid identity-set objects"
    );
  }
  const bindingChanges = BINDING_DIGESTS.filter((name) =>
    prior.bindings?.[name] !== current.bindings?.[name]
  );
  const duplicateIdentities = new Set();
  for (const identities of [prior.identities, current.identities]) {
    const seen = new Set();
    for (const entry of identities) {
      if (entry.source === "typed" && seen.has(entry.identity)) {
        duplicateIdentities.add(entry.identity);
      }
      seen.add(entry.identity);
    }
  }
  const priorByIdentity = new Map(prior.identities
    .filter((entry) => !duplicateIdentities.has(entry.identity))
    .map((entry) => [entry.identity, entry]));
  const currentByIdentity = new Map(current.identities
    .filter((entry) => !duplicateIdentities.has(entry.identity))
    .map((entry) => [entry.identity, entry]));
  const stale = [];
  for (const identity of duplicateIdentities) {
    stale.push(Object.freeze({ identity, reason: "duplicate" }));
  }
  for (const entry of prior.identities) {
    if (duplicateIdentities.has(entry.identity)) continue;
    const replacement = currentByIdentity.get(entry.identity);
    if (!replacement || replacement.position !== entry.position || replacement.text !== entry.text) {
      stale.push(Object.freeze({ identity: entry.identity, reason: replacement ? "changed" : "removed" }));
    }
  }
  for (const entry of current.identities) {
    if (duplicateIdentities.has(entry.identity)) continue;
    if (!priorByIdentity.has(entry.identity)) {
      stale.push(Object.freeze({ identity: entry.identity, reason: "added" }));
    }
  }
  return Object.freeze({
    current: bindingChanges.length === 0 && stale.length === 0,
    stale: bindingChanges.length > 0 || stale.length > 0,
    bindingChanges: Object.freeze(bindingChanges),
    staleCriteria: Object.freeze(stale)
  });
}

export {
  AcceptanceCoverageIdentityError,
  BINDING_DIGESTS,
  compareCriterionIdentitySets,
  deriveCriterionIdentitySet,
  criterionIdentityDigest,
  normalizeCriterionIdentityEntry
};
