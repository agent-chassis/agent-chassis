import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const GUARDED_OWNER_REGISTRY_SCHEMA_VERSION = "guarded-owner-registry.v1";
export const GUARDED_OWNER_REGISTRY_DIAGNOSTICS = Object.freeze({
  BROAD_SELECTOR: "guarded_owner_registry_broad_selector",
  CONTRADICTORY_OWNERSHIP: "guarded_owner_registry_contradictory_ownership",
  COPIED_MECHANICAL_ENTRY: "guarded_owner_registry_copied_mechanical_entry",
  DUPLICATE_BINDING: "guarded_owner_registry_duplicate_binding",
  FORBIDDEN_CONTENT: "guarded_owner_registry_forbidden_content",
  MALFORMED_REFERENCE: "guarded_owner_registry_malformed_reference_identity",
  MISSING_ADAPTER: "guarded_owner_registry_category_adapter_missing",
  MISSING_OWNER_REFERENCE: "guarded_owner_registry_owner_reference_missing",
  OWNER_REFERENCE_DIGEST_MISMATCH: "guarded_owner_registry_owner_reference_digest_mismatch",
  SCHEMA_INVALID: "guarded_owner_registry_schema_invalid",
  SOURCE_LOCATION_STALE: "guarded_owner_registry_source_location_stale",
  UNBOUNDED_FACT: "guarded_owner_registry_unresolved_fact_unbounded",
  UNSUPPORTED_CATEGORY: "guarded_owner_registry_unsupported_category"
});

const ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const REFERENCE_ID = /^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const OWNER = /^(?:WK-[0-9]{4}(?:#SLICE-[0-9]{3})?|CCE|decision:[a-z][a-z0-9]*(?:_[a-z0-9]+)*)$/u;
const SELECTOR = /^node --test ([a-zA-Z0-9._/-]+\.test\.mjs)$/u;
const FORBIDDEN_KEYS = new Set([
  "allowlist", "authentication_predicate", "carrier_validator", "common_proof_selection_rule",
  "copied_owner_authority", "recovery_predicate", "semantic_disposition", "witness_body"
]);
const TOP_LEVEL_KEYS = [
  "bindings", "closed", "owner_references", "repository", "schema_version",
  "supported_categories", "unresolved_fact_limit", "unresolved_facts"
];
const BINDING_KEYS = [
  "binding_id", "category_id", "code_or_translation_owner", "diagnostic_id", "discovery_rule",
  "guarded_class_id", "owner_reference_ids", "posture_or_boundary_id", "semantic_owner"
];
const RULE_KEYS = ["adapter_id", "extensions", "kind", "roots"];
const REFERENCE_KEYS = ["content_digest", "path", "reference_id", "reference_kind", "selector"];

export class GuardedOwnerRegistryError extends Error {
  constructor(code, details) {
    super(`${code}: ${JSON.stringify(details)}`);
    this.name = "GuardedOwnerRegistryError";
    this.code = code;
    this.details = Object.freeze(details);
  }
}

function fail(code, details) {
  throw new GuardedOwnerRegistryError(code, details);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, location) {
  if (!plainObject(value)) fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location });
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location, actual, expected: wanted });
  }
}

function rejectForbiddenContent(value, location = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbiddenContent(entry, `${location}[${index}]`));
    return;
  }
  if (!plainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.FORBIDDEN_CONTENT, { location: `${location}.${key}` });
    }
    rejectForbiddenContent(entry, `${location}.${key}`);
  }
}

function assertId(value, location) {
  if (typeof value !== "string" || !ID.test(value)) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location, value });
  }
}

function assertRelativePath(value, location) {
  if (
    typeof value !== "string" || value.length === 0 || path.isAbsolute(value) ||
    value.includes("\\") || /[*?{}[\]]/u.test(value) ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.MALFORMED_REFERENCE, { location, value });
  }
}

function narrowRoot(root) {
  return /^packages\/[^/]+\/(?:src|lib)(?:\/[^/]+)*$/u.test(root) ||
    /^tools\/[^/]+(?:\/[^/]+)*$/u.test(root);
}

function validateDiscoveryRule(rule, location) {
  exactKeys(rule, RULE_KEYS, location);
  assertId(rule.adapter_id, `${location}.adapter_id`);
  if (rule.kind !== "git_tracked_category_adapter") {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location: `${location}.kind` });
  }
  if (!Array.isArray(rule.roots) || rule.roots.length === 0 ||
      !Array.isArray(rule.extensions) || rule.extensions.length === 0) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.BROAD_SELECTOR, { location });
  }
  for (const root of rule.roots) {
    assertRelativePath(root, `${location}.roots`);
    if (!narrowRoot(root)) fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.BROAD_SELECTOR, { location, root });
  }
  if (new Set(rule.roots).size !== rule.roots.length ||
      new Set(rule.extensions).size !== rule.extensions.length ||
      rule.extensions.some((extension) => !/^\.[a-z0-9]+$/u.test(extension))) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.BROAD_SELECTOR, { location });
  }
}

function validateReference(reference, index) {
  const location = `$.owner_references[${index}]`;
  exactKeys(reference, REFERENCE_KEYS, location);
  if (!REFERENCE_ID.test(reference.reference_id) || !DIGEST.test(reference.content_digest)) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.MALFORMED_REFERENCE, { location });
  }
  if (!['owner_classification', 'owner_proof'].includes(reference.reference_kind)) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.MALFORMED_REFERENCE, { location });
  }
  assertRelativePath(reference.path, `${location}.path`);
  if (reference.reference_kind === "owner_proof") {
    const match = typeof reference.selector === "string" && reference.selector.match(SELECTOR);
    if (!match || match[1] !== reference.path) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.MALFORMED_REFERENCE, { location: `${location}.selector` });
    }
  } else if (reference.selector !== null) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.MALFORMED_REFERENCE, { location: `${location}.selector` });
  }
}

export function validateGuardedOwnerRegistryDefinition(registry) {
  rejectForbiddenContent(registry);
  exactKeys(registry, TOP_LEVEL_KEYS, "$");
  if (registry.schema_version !== GUARDED_OWNER_REGISTRY_SCHEMA_VERSION || registry.closed !== true ||
      typeof registry.repository !== "string") {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location: "$" });
  }
  if (!Array.isArray(registry.supported_categories) || registry.supported_categories.length === 0 ||
      new Set(registry.supported_categories).size !== registry.supported_categories.length) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location: "$.supported_categories" });
  }
  registry.supported_categories.forEach((category, index) => assertId(category, `$.supported_categories[${index}]`));
  if (!Number.isInteger(registry.unresolved_fact_limit) || registry.unresolved_fact_limit < 0 ||
      !Array.isArray(registry.unresolved_facts) || registry.unresolved_facts.length > registry.unresolved_fact_limit) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.UNBOUNDED_FACT, { location: "$.unresolved_facts" });
  }
  for (const [index, fact] of registry.unresolved_facts.entries()) {
    exactKeys(fact, ["expires", "fact_id", "falsifying_test_reference_id", "remediation_wk", "semantic_owner", "source_identity"], `$.unresolved_facts[${index}]`);
    assertId(fact.fact_id, `$.unresolved_facts[${index}].fact_id`);
    if (!REFERENCE_ID.test(fact.falsifying_test_reference_id) || !OWNER.test(fact.remediation_wk) ||
        !OWNER.test(fact.semantic_owner) || typeof fact.source_identity !== "string" ||
        !/^(?:date:\d{4}-\d{2}-\d{2}|repository_milestone:[a-zA-Z0-9._#-]+)$/u.test(fact.expires)) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.UNBOUNDED_FACT, { location: `$.unresolved_facts[${index}]` });
    }
  }
  if (!Array.isArray(registry.owner_references) || !Array.isArray(registry.bindings)) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location: "$" });
  }
  const references = new Map();
  registry.owner_references.forEach((reference, index) => {
    validateReference(reference, index);
    if (references.has(reference.reference_id)) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.DUPLICATE_BINDING, { reference_id: reference.reference_id });
    }
    references.set(reference.reference_id, reference);
  });
  for (const fact of registry.unresolved_facts) {
    if (!references.has(fact.falsifying_test_reference_id)) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.MISSING_OWNER_REFERENCE, { fact_id: fact.fact_id, reference_id: fact.falsifying_test_reference_id });
    }
  }
  const bindingIds = new Set();
  const bindingCategoryCounts = new Map();
  const classes = new Map();
  const mechanicalEntries = new Map();
  const diagnostics = new Set();
  for (const [index, binding] of registry.bindings.entries()) {
    const location = `$.bindings[${index}]`;
    exactKeys(binding, BINDING_KEYS, location);
    for (const field of ["binding_id", "category_id", "diagnostic_id", "guarded_class_id", "posture_or_boundary_id"]) {
      assertId(binding[field], `${location}.${field}`);
    }
    if (!registry.supported_categories.includes(binding.category_id)) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.UNSUPPORTED_CATEGORY, { category_id: binding.category_id });
    }
    bindingCategoryCounts.set(binding.category_id, bindingCategoryCounts.has(binding.category_id) ? bindingCategoryCounts.get(binding.category_id) + 1 : 1);
    if (!OWNER.test(binding.semantic_owner) ||
        (binding.code_or_translation_owner !== null && !OWNER.test(binding.code_or_translation_owner))) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location, field: "owner" });
    }
    validateDiscoveryRule(binding.discovery_rule, `${location}.discovery_rule`);
    if (binding.discovery_rule.adapter_id !== binding.category_id) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.UNSUPPORTED_CATEGORY, { category_id: binding.category_id });
    }
    if (!Array.isArray(binding.owner_reference_ids) || binding.owner_reference_ids.length === 0 ||
        new Set(binding.owner_reference_ids).size !== binding.owner_reference_ids.length) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.MISSING_OWNER_REFERENCE, { binding_id: binding.binding_id });
    }
    for (const referenceId of binding.owner_reference_ids) {
      if (!references.has(referenceId)) {
        fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.MISSING_OWNER_REFERENCE, { binding_id: binding.binding_id, reference_id: referenceId });
      }
    }
    if (bindingIds.has(binding.binding_id) || diagnostics.has(binding.diagnostic_id)) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.DUPLICATE_BINDING, { binding_id: binding.binding_id });
    }
    bindingIds.add(binding.binding_id);
    diagnostics.add(binding.diagnostic_id);
    const prior = classes.get(binding.guarded_class_id);
    if (prior) {
      const contradictory = prior.semantic_owner !== binding.semantic_owner ||
        prior.code_or_translation_owner !== binding.code_or_translation_owner;
      fail(contradictory ? GUARDED_OWNER_REGISTRY_DIAGNOSTICS.CONTRADICTORY_OWNERSHIP :
        GUARDED_OWNER_REGISTRY_DIAGNOSTICS.DUPLICATE_BINDING, { guarded_class_id: binding.guarded_class_id });
    }
    classes.set(binding.guarded_class_id, binding);
    const fingerprint = JSON.stringify({
      category_id: binding.category_id,
      code_or_translation_owner: binding.code_or_translation_owner,
      discovery_rule: binding.discovery_rule,
      owner_reference_ids: binding.owner_reference_ids,
      posture_or_boundary_id: binding.posture_or_boundary_id,
      semantic_owner: binding.semantic_owner
    });
    if (mechanicalEntries.has(fingerprint)) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.COPIED_MECHANICAL_ENTRY, {
        binding_id: binding.binding_id,
        copied_from: mechanicalEntries.get(fingerprint)
      });
    }
    mechanicalEntries.set(fingerprint, binding.binding_id);
  }
  for (const categoryId of registry.supported_categories) {
    const count = bindingCategoryCounts.get(categoryId);
    if (count === undefined) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.UNSUPPORTED_CATEGORY,
        { category_id: categoryId, reason: "missing_binding" });
    }
    if (count !== 1) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.DUPLICATE_BINDING, { category_id: categoryId });
    }
  }
  return registry;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function validateGuardedOwnerReferences(registry, { repositoryRoot, trackedPaths, read = readFile }) {
  validateGuardedOwnerRegistryDefinition(registry);
  if (typeof repositoryRoot !== "string" || !Array.isArray(trackedPaths)) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location: "reference_validation_inputs" });
  }
  const tracked = new Set(trackedPaths);
  for (const reference of registry.owner_references) {
    if (!tracked.has(reference.path)) {
      let movedTo = null;
      for (const candidate of trackedPaths) {
        let candidateBytes;
        try {
          candidateBytes = await read(path.join(repositoryRoot, candidate));
        } catch (error) {
          fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SOURCE_LOCATION_STALE, {
            reference_id: reference.reference_id,
            path: reference.path,
            unreadable_candidate: candidate,
            cause: error instanceof Error ? error.code ?? error.name : typeof error
          });
        }
        if (sha256(candidateBytes) === reference.content_digest) {
          movedTo = candidate;
          break;
        }
      }
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SOURCE_LOCATION_STALE, {
        reference_id: reference.reference_id,
        path: reference.path,
        moved_to: movedTo
      });
    }
    let bytes;
    try {
      bytes = await read(path.join(repositoryRoot, reference.path));
    } catch (error) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.MISSING_OWNER_REFERENCE, {
        reference_id: reference.reference_id,
        path: reference.path,
        cause: error instanceof Error ? error.code ?? error.name : typeof error
      });
    }
    const actual = sha256(bytes);
    if (actual !== reference.content_digest) {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.OWNER_REFERENCE_DIGEST_MISMATCH, {
        reference_id: reference.reference_id,
        expected: reference.content_digest,
        actual
      });
    }
  }
  return registry;
}

export function defineGuardedOwnerCategoryAdapter(categoryId, discover) {
  assertId(categoryId, "category_id");
  if (typeof discover !== "function") {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location: "category_adapter.discover" });
  }
  return Object.freeze({ category_id: categoryId, discover });
}

function selectedBy(rule, candidate) {
  return rule.roots.some((root) => candidate.startsWith(`${root}/`)) &&
    rule.extensions.some((extension) => candidate.endsWith(extension));
}

export async function deriveGuardedOwnerPopulation(registry, {
  repositoryRoot,
  trackedPaths,
  categoryAdapters,
  read = readFile
}) {
  validateGuardedOwnerRegistryDefinition(registry);
  if (!(categoryAdapters instanceof Map) || !Array.isArray(trackedPaths)) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location: "population_inputs" });
  }
  const population = [];
  for (const binding of registry.bindings) {
    const adapter = categoryAdapters.get(binding.category_id);
    if (!adapter || adapter.category_id !== binding.category_id || typeof adapter.discover !== "function") {
      fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.MISSING_ADAPTER, { category_id: binding.category_id });
    }
    const candidates = trackedPaths.filter((candidate) => selectedBy(binding.discovery_rule, candidate)).sort();
    for (const candidate of candidates) {
      let source;
      try {
        source = await read(path.join(repositoryRoot, candidate), "utf8");
      } catch (error) {
        fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SOURCE_LOCATION_STALE, {
          category_id: binding.category_id,
          path: candidate,
          cause: error instanceof Error ? error.code ?? error.name : typeof error
        });
      }
      const sites = await adapter.discover({ path: candidate, source });
      if (!Array.isArray(sites)) {
        fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location: `adapter:${binding.category_id}` });
      }
      for (const [ordinal, site] of sites.entries()) {
        if (!plainObject(site) || Object.keys(site).sort().join(",") !== "column,kind,line" ||
            !ID.test(site.kind) || !Number.isInteger(site.line) || site.line < 1 ||
            !Number.isInteger(site.column) || site.column < 1) {
          fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, { location: `adapter:${binding.category_id}[${ordinal}]` });
        }
        population.push(Object.freeze({
          binding_id: binding.binding_id,
          category_id: binding.category_id,
          diagnostic_id: binding.diagnostic_id,
          guarded_class_id: binding.guarded_class_id,
          source_identity: `${candidate}:${site.line}:${site.column}:${site.kind}:${ordinal + 1}`
        }));
      }
    }
  }
  return Object.freeze(population);
}

const DEFAULT_REGISTRY_PATH = fileURLToPath(
  new URL("../../data/guarded-owner-registry.v1.json", import.meta.url)
);

export async function loadGuardedOwnerRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const bytes = await readFile(registryPath, "utf8");
  let registry;
  try {
    registry = JSON.parse(bytes);
  } catch (error) {
    fail(GUARDED_OWNER_REGISTRY_DIAGNOSTICS.SCHEMA_INVALID, {
      location: registryPath,
      cause: error instanceof Error ? error.message : typeof error
    });
  }
  return validateGuardedOwnerRegistryDefinition(registry);
}
