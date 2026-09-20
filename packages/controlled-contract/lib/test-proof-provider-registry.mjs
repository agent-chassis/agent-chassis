import { createHash } from "node:crypto";

import { TEST_PROOF_PROVIDER_FAMILIES } from "./test-proof-providers/index.mjs";
import { deepFreeze } from "./test-proof-providers/shared.mjs";

const TEST_PROOF_PROVIDER_REGISTRY_ID = "launcher.test-proof-provider-registry";
const TEST_PROOF_PROVIDER_REGISTRY_VERSION = "1.3.0";
const NODE_TEST_SELECTOR_KIND = "node_test_name";
const CAPABILITIES = Object.freeze(["candidate_execution", "falsifier_execution",
  "boundary_traversal"]);
const NATIVE_SELECTOR_FIELDS = Object.freeze(["node_id", "provider_id", "provider_version"]);

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sortedUnique = (values) => [...new Set(values)].sort(compare);

class TestProofProviderCatalogError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "TestProofProviderCatalogError";
    this.code = "test_proof_provider_catalog_invalid";
    this.detail = detail;
  }
}

function catalogFailure(message, detail) {
  throw new TestProofProviderCatalogError(message, detail);
}

function composeFamilies(families) {
  const providers = [];
  const providerIds = new Set();
  const familiesByKind = new Map();
  const runtimeNames = new Set();
  const validators = { falsifier_result: new Map(), boundary_trace: new Map() };
  const targetConstraints = new Map();
  for (const family of families) {
    const kind = family.selector?.kind;
    if (typeof kind !== "string" || familiesByKind.has(kind)) {
      catalogFailure("provider families must own distinct selector kinds",
        { family_id: family.family_id, selector_kind: kind ?? null });
    }
    if (family.selector.qualified !== (family.selector.grammar !== null)) {
      catalogFailure("a qualified selector kind must own exactly one native grammar",
        { family_id: family.family_id });
    }
    if (runtimeNames.has(family.runtime?.name)) {
      catalogFailure("provider families must name distinct runtime runners",
        { family_id: family.family_id });
    }
    runtimeNames.add(family.runtime.name);
    familiesByKind.set(kind, family);
    for (const capability of CAPABILITIES) {
      const owners = family.providers.filter(({ capabilities }) =>
        capabilities.includes(capability));
      if (owners.length !== 1) {
        catalogFailure("a provider family must own exactly one provider per capability", {
          family_id: family.family_id, capability,
          provider_ids: owners.map(({ provider_id: id }) => id)
        });
      }
    }
    for (const [artifactKind, mechanisms] of Object.entries(family.witness_validators)) {
      for (const [mechanism, validator] of Object.entries(mechanisms)) {
        const existing = validators[artifactKind].get(mechanism);
        if (existing !== undefined && existing !== validator) {
          catalogFailure("one credit-bearing mechanism must have exactly one witness validator",
            { artifact_kind: artifactKind, mechanism });
        }
        validators[artifactKind].set(mechanism, validator);
      }
    }
    for (const [mechanism, constraint] of Object.entries(family.falsifier_target_constraints ?? {})) {
      const existing = targetConstraints.get(mechanism);
      if (existing !== undefined && existing !== constraint) {
        catalogFailure("one falsifier mechanism must have exactly one target constraint",
          { mechanism });
      }
      targetConstraints.set(mechanism, constraint);
    }
    for (const descriptor of family.providers) {
      if (descriptor.selector_kind !== kind || providerIds.has(descriptor.provider_id)) {
        catalogFailure("provider descriptors must be unique and use their family selector kind",
          { family_id: family.family_id, provider_id: descriptor.provider_id });
      }
      providerIds.add(descriptor.provider_id);
      providers.push(descriptor);
    }
  }

  for (const descriptor of providers) {
    if (descriptor.capabilities.includes("falsifier_execution")) {
      const credited = descriptor.observation_mechanisms.filter((mechanism) =>
        validators.falsifier_result.has(mechanism));
      if (credited.length !== 1) {
        catalogFailure("a falsifier provider must name one witnessed mutation mechanism",
          { provider_id: descriptor.provider_id });
      }
      if (!targetConstraints.has(credited[0])) {
        catalogFailure("a witnessed mutation mechanism must state its target constraint",
          { provider_id: descriptor.provider_id, mechanism: credited[0] });
      }
    }
    if (descriptor.capabilities.includes("boundary_traversal") &&
        !descriptor.observation_mechanisms.every((mechanism) =>
          validators.boundary_trace.has(mechanism))) {
      catalogFailure("every traversal mechanism must have a witness validator",
        { provider_id: descriptor.provider_id });
    }
  }
  return { providers, familiesByKind, validators, targetConstraints };
}

const COMPOSED = composeFamilies(TEST_PROOF_PROVIDER_FAMILIES);

const TEST_PROOF_PROVIDER_CATALOG = deepFreeze({
  registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
  registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  providers: COMPOSED.providers.map((descriptor) => structuredClone({ ...descriptor }))
});

const TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST = `sha256:${createHash("sha256")
  .update(JSON.stringify(TEST_PROOF_PROVIDER_CATALOG), "utf8").digest("hex")}`;

const descriptorById = (providerId) => TEST_PROOF_PROVIDER_CATALOG.providers
  .find(({ provider_id: id }) => id === providerId) ?? null;
const familyForKind = (selectorKind) => COMPOSED.familiesByKind.get(selectorKind) ?? null;

const TEST_RUNTIME_RUNNER_CATALOG = deepFreeze({
  registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
  registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  runners: TEST_PROOF_PROVIDER_FAMILIES.map((family) => ({
    name: family.runtime.name,
    runner_id: family.runtime.runner_id,
    runner: family.runtime.runner,
    languages: [...family.runtime.languages],
    toolchains: [...family.runtime.toolchains],
    dependency_ecosystem: family.runtime.dependency_ecosystem,
    selector_kind: family.selector.kind,
    proof_providers: Object.fromEntries(CAPABILITIES.map((capability) => [capability,
      family.providers.find(({ capabilities }) => capabilities.includes(capability)).provider_id]))
  }))
});

function testRuntimeRunner({ name = undefined, runnerId = undefined,
  selectorKind = undefined } = {}) {
  return TEST_RUNTIME_RUNNER_CATALOG.runners.find((runner) =>
    (name === undefined || runner.name === name) &&
    (runnerId === undefined || runner.runner_id === runnerId) &&
    (selectorKind === undefined || runner.selector_kind === selectorKind)) ?? null;
}

function testProofProviderFamily(selectorKind) {
  const family = familyForKind(selectorKind);
  if (family === null) return null;
  return Object.freeze({
    family_id: family.family_id,
    selector_kind: family.selector.kind,
    qualified: family.selector.qualified,
    selector_statement: family.selector.grammar?.statement ?? null,
    source_suffixes: family.source_suffixes,
    runtime_runner: testRuntimeRunner({ selectorKind }),
    providers: Object.freeze(Object.fromEntries(CAPABILITIES.map((capability) => [capability,
      descriptorById(family.providers.find(({ capabilities }) =>
        capabilities.includes(capability)).provider_id)])))
  });
}

function testProofFalsifierProvider(selectorKind, strategy) {
  const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find((candidate) =>
    candidate.selector_kind === selectorKind &&
    candidate.capabilities.includes("falsifier_execution") &&
    candidate.falsifier_strategies.includes(strategy));
  if (descriptor === undefined) return null;
  return Object.freeze({
    descriptor,
    mechanism: descriptor.observation_mechanisms.find((mechanism) =>
      COMPOSED.validators.falsifier_result.has(mechanism)),
    target_kind: descriptor.boundary_kinds[0]
  });
}

function testProofStrategySelectorKinds(strategy) {
  return sortedUnique(TEST_PROOF_PROVIDER_CATALOG.providers.filter((descriptor) =>
    descriptor.capabilities.includes("falsifier_execution") &&
    descriptor.falsifier_strategies.includes(strategy)).map(({ selector_kind: kind }) => kind));
}

function isTestProofSourcePath(selectorKind, sourcePath) {
  const family = familyForKind(selectorKind);
  return family !== null && typeof sourcePath === "string" &&
    family.source_suffixes.some((suffix) => sourcePath.endsWith(suffix));
}

const providerIdentity = (descriptor) => Object.freeze({
  provider_id: descriptor.provider_id, provider_version: descriptor.provider_version });

const TEST_PROOF_PROVIDER_AUTHORING_FACTS = deepFreeze(TEST_PROOF_PROVIDER_FAMILIES.map((family) => {
  const kind = family.selector.kind;
  const { candidate_execution: candidate, falsifier_execution: falsifier,
    boundary_traversal: traversal } = testProofProviderFamily(kind).providers;
  const mechanism = testProofFalsifierProvider(kind, falsifier.falsifier_strategies[0]).mechanism;
  return {
    family_id: family.family_id,
    identity_terms: sortedUnique([family.family_id, family.runtime.name, family.runtime.runner,
      family.runtime.dependency_ecosystem, ...family.runtime.languages,
      ...family.runtime.toolchains]),
    languages: [...family.runtime.languages],
    runner: family.runtime.runner,
    runner_id: family.runtime.runner_id,
    selector: { kind, provider_qualified: family.selector.qualified,
      node_id_form: family.selector.grammar?.statement ?? null,
      source_suffixes: [...family.source_suffixes] },
    candidate_execution: providerIdentity(candidate),
    falsifier_execution: { ...providerIdentity(falsifier),
      strategies: [...falsifier.falsifier_strategies], mechanism,
      target_kind: falsifier.boundary_kinds[0],
      target_constraint: COMPOSED.targetConstraints.get(mechanism) },
    boundary_traversal: { ...providerIdentity(traversal),
      boundary_kinds: [...traversal.boundary_kinds] }
  };
}));

const PROVIDER_REFUSAL_PRECEDENCE = Object.freeze([
  "stable_test_proof_provider_missing",
  "stable_test_proof_provider_partial",
  "stable_test_proof_provider_unknown",
  "stable_test_proof_provider_version_mismatch",
  "stable_test_proof_provider_capability_mismatch",
  "stable_test_proof_provider_snapshot_mismatch",
  "stable_test_proof_provider_observation_mismatch",
  "stable_test_proof_provider_observation_seam_mismatch",
  "stable_test_proof_provider_artifact_type_mismatch",
  "stable_test_proof_provider_strategy_mismatch",
  "stable_test_proof_provider_boundary_mismatch"
]);

function nativeSelectorRefusal(pointer, expected, actual) {
  return Object.freeze({ valid: false, code: "stable_test_proof_selector_invalid",
    pointer, expected_identity: expected ?? null, actual_identity: actual ?? null });
}

function resolveNativeTestSelector(selector, { path = undefined,
  pointer = "/test_selector" } = {}) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector) ||
      Object.keys(selector).length !== NATIVE_SELECTOR_FIELDS.length ||
      NATIVE_SELECTOR_FIELDS.some((field) => !Object.hasOwn(selector, field))) {
    return nativeSelectorRefusal(pointer, NATIVE_SELECTOR_FIELDS, selector ?? null);
  }
  const descriptor = descriptorById(selector.provider_id);
  const grammar = familyForKind(descriptor?.selector_kind)?.selector.grammar ?? null;
  if (descriptor === null || grammar === null ||
      !descriptor.capabilities.includes("candidate_execution")) {
    return nativeSelectorRefusal(`${pointer}/provider_id`,
      "installed native candidate provider", selector.provider_id);
  }
  if (selector.provider_version !== descriptor.provider_version) {
    return nativeSelectorRefusal(`${pointer}/provider_version`,
      descriptor.provider_version, selector.provider_version);
  }
  const resolved = grammar.resolve(selector.node_id);
  if (!resolved.valid) {
    return nativeSelectorRefusal(`${pointer}/node_id`, resolved.expected, selector.node_id ?? null);
  }
  if (path !== undefined && path !== resolved.path) {
    return nativeSelectorRefusal(`${pointer}/node_id`, path, resolved.path);
  }
  return Object.freeze({ valid: true, code: null, selector_kind: descriptor.selector_kind,
    provider_id: descriptor.provider_id, provider_version: descriptor.provider_version,
    node_id: selector.node_id, path: resolved.path, selection: resolved.selection });
}

function testProofSelectorKind(selector) {
  const qualified = selector && typeof selector === "object" && !Array.isArray(selector) &&
    (Object.hasOwn(selector, "provider_id") || Object.hasOwn(selector, "node_id"));
  if (!qualified) return NODE_TEST_SELECTOR_KIND;
  const descriptor = descriptorById(selector.provider_id);
  return familyForKind(descriptor?.selector_kind)?.selector.qualified === true
    ? descriptor.selector_kind : null;
}

function diagnostic(code, pointer, expected, actual) {
  return Object.freeze({
    code,
    pointer,
    keyword: "providerCompatibility",
    reason_code: "stable_test_proof_provider_refused",
    expected_identity: expected ?? null,
    actual_identity: actual ?? null,
    message: code
  });
}

function providerResult(code = null, pointer = "/provider", expected = null,
  actual = null, descriptor = null) {
  return Object.freeze(code === null
    ? { valid: true, code: null, diagnostic: null, descriptor }
    : { valid: false, code, diagnostic: diagnostic(code, pointer, expected, actual),
      descriptor: null });
}

function resolveTestProofProviderCompatibility({
  provider,
  capability,
  pointer = "/provider",
  expected_provider_id: expectedProviderId = undefined,
  require_snapshot: requireSnapshot = false,
  observation_mechanism: observationMechanism = undefined,
  observation_seam: observationSeam = undefined,
  evidence_artifact_types: evidenceArtifactTypes = undefined,
  strategy = undefined,
  boundary_kind: boundaryKind = undefined,
  selector_kind: selectorKind = undefined
} = {}) {
  if (provider === null || provider === undefined || typeof provider !== "object" ||
      Array.isArray(provider) || Object.keys(provider).length === 0) return providerResult(
    PROVIDER_REFUSAL_PRECEDENCE[0], pointer, "complete provider binding", provider ?? null
  );
  if (capability === "traversal_unsupported") {
    const required = ["registry_id", "registry_version", "capability",
      "capability_snapshot_digest"];
    if (required.some((field) => !Object.hasOwn(provider, field))) return providerResult(
      PROVIDER_REFUSAL_PRECEDENCE[1], pointer, required,
      required.filter((field) => Object.hasOwn(provider, field))
    );
    if (provider.registry_id !== TEST_PROOF_PROVIDER_REGISTRY_ID) return providerResult(
      PROVIDER_REFUSAL_PRECEDENCE[2], `${pointer}/registry_id`,
      TEST_PROOF_PROVIDER_REGISTRY_ID, provider.registry_id
    );
    if (provider.registry_version !== TEST_PROOF_PROVIDER_REGISTRY_VERSION) {
      return providerResult(PROVIDER_REFUSAL_PRECEDENCE[3], `${pointer}/registry_version`,
        TEST_PROOF_PROVIDER_REGISTRY_VERSION, provider.registry_version);
    }
    if (provider.capability !== capability) return providerResult(
      PROVIDER_REFUSAL_PRECEDENCE[4], `${pointer}/capability`, capability,
      provider.capability
    );
    if (provider.capability_snapshot_digest !==
        TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST) return providerResult(
      PROVIDER_REFUSAL_PRECEDENCE[5], `${pointer}/capability_snapshot_digest`,
      TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
      provider.capability_snapshot_digest
    );
    return providerResult(null, pointer, null, null, null);
  }
  const required = ["provider_id", "provider_version", "capability"];
  if (required.some((field) => !Object.hasOwn(provider, field))) return providerResult(
    PROVIDER_REFUSAL_PRECEDENCE[1], pointer, required,
    required.filter((field) => Object.hasOwn(provider, field))
  );
  const descriptor = descriptorById(provider.provider_id);
  if (!descriptor) return providerResult(PROVIDER_REFUSAL_PRECEDENCE[2],
    `${pointer}/provider_id`, TEST_PROOF_PROVIDER_CATALOG.providers.map(
      ({ provider_id: providerId }) => providerId
    ), provider.provider_id);
  if (expectedProviderId !== undefined && provider.provider_id !== expectedProviderId) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[2], `${pointer}/provider_id`,
      expectedProviderId, provider.provider_id);
  }
  if (provider.provider_version !== descriptor.provider_version) return providerResult(
    PROVIDER_REFUSAL_PRECEDENCE[3], `${pointer}/provider_version`,
    descriptor.provider_version, provider.provider_version
  );
  if (provider.capability !== capability || !descriptor.capabilities.includes(capability)) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[4], `${pointer}/capability`,
      capability, provider.capability);
  }
  if (requireSnapshot && provider.capability_snapshot_digest !==
      TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST) return providerResult(
    PROVIDER_REFUSAL_PRECEDENCE[5], `${pointer}/capability_snapshot_digest`,
    TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    provider.capability_snapshot_digest ?? null
  );
  const actualObservation = observationMechanism ?? provider.observation_mechanism;
  if (actualObservation !== undefined && !descriptor.observation_mechanisms.includes(
    actualObservation
  )) return providerResult(PROVIDER_REFUSAL_PRECEDENCE[6],
    `${pointer}/observation_mechanism`, descriptor.observation_mechanisms,
    actualObservation);
  if (observationSeam !== undefined && !descriptor.observation_seams.includes(
    observationSeam
  )) return providerResult(PROVIDER_REFUSAL_PRECEDENCE[7],
    `${pointer}/observation_seam`, descriptor.observation_seams, observationSeam);
  const artifactTypes = evidenceArtifactTypes ?? provider.evidence_artifact_types;
  if (artifactTypes !== undefined && (!Array.isArray(artifactTypes) ||
      artifactTypes.some((kind) => !descriptor.evidence_artifact_types.includes(kind)))) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[8],
      `${pointer}/evidence_artifact_types`, descriptor.evidence_artifact_types,
      artifactTypes);
  }
  if (strategy !== undefined && !descriptor.falsifier_strategies.includes(strategy)) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[9], `${pointer}/strategy`,
      descriptor.falsifier_strategies, strategy);
  }
  if (boundaryKind !== undefined && !descriptor.boundary_kinds.includes(boundaryKind)) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[10], `${pointer}/boundary_kind`,
      descriptor.boundary_kinds, boundaryKind);
  }

  if (selectorKind !== undefined && descriptor.selector_kind !== selectorKind) {
    return providerResult(PROVIDER_REFUSAL_PRECEDENCE[4], `${pointer}/provider_id`,
      selectorKind, descriptor.selector_kind);
  }
  return providerResult(null, pointer, null, null, descriptor);
}

function testProofWitnessValidator(artifactKind, mechanism) {
  return COMPOSED.validators[artifactKind]?.get(mechanism) ?? null;
}

const byCapability = (capability) => TEST_PROOF_PROVIDER_CATALOG.providers
  .filter(({ capabilities }) => capabilities.includes(capability));
const mutationMechanisms = sortedUnique(byCapability("falsifier_execution")
  .map(({ selector_kind: kind, falsifier_strategies: strategies }) =>
    testProofFalsifierProvider(kind, strategies[0]).mechanism));
const TEST_PROOF_PROVIDER_SCHEMA_VOCABULARY = deepFreeze({
  registry_id: TEST_PROOF_PROVIDER_REGISTRY_ID,
  registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  observation_mechanisms: sortedUnique(TEST_PROOF_PROVIDER_CATALOG.providers
    .flatMap(({ observation_mechanisms: values }) => values)),
  candidate_mechanisms: sortedUnique(byCapability("candidate_execution")
    .map(({ observation_mechanisms: values }) => values[0])),
  traversal_mechanisms: sortedUnique(byCapability("boundary_traversal")
    .flatMap(({ observation_mechanisms: values }) => values)),
  traversal_seams: sortedUnique(byCapability("boundary_traversal")
    .flatMap(({ observation_seams: values }) => values)),
  mutation_mechanisms: mutationMechanisms,
  function_mutation_mechanisms: sortedUnique(byCapability("falsifier_execution")
    .filter(({ boundary_kinds: kinds }) => kinds.includes("function"))
    .map(({ selector_kind: kind, falsifier_strategies: strategies }) =>
      testProofFalsifierProvider(kind, strategies[0]).mechanism)),
  falsifier_strategies: sortedUnique(byCapability("falsifier_execution")
    .flatMap(({ falsifier_strategies: values }) => values)),
  evidence_artifact_types: sortedUnique(TEST_PROOF_PROVIDER_CATALOG.providers
    .flatMap(({ evidence_artifact_types: values }) => values)),
  native_source_suffixes: sortedUnique(TEST_PROOF_PROVIDER_FAMILIES
    .filter(({ selector }) => selector.qualified).flatMap(({ source_suffixes: values }) => values))
});

const at = (schema, pointer) => pointer.split("/").slice(1).reduce((node, key) =>
  node?.[/^\d+$/u.test(key) ? Number(key) : key], schema);
const exactly = (expected) => (values) => Array.isArray(values) &&
  JSON.stringify(sortedUnique(values.map(String))) === JSON.stringify(expected);
const covers = (required, allowed = null) => (values) => Array.isArray(values) &&
  required.every((value) => values.includes(value)) &&
  (allowed === null || values.every((value) => allowed.includes(value)));
const constant = (expected) => (value) => value === expected;
const acceptsSuffixes = (suffixes) => (pattern) => typeof pattern === "string" &&
  suffixes.every((suffix) => new RegExp(pattern, "u").test(`module/source${suffix}`)) &&
  !new RegExp(pattern, "u").test("module/source.txt");

function schemaVocabularyChecks(kind) {
  const v = TEST_PROOF_PROVIDER_SCHEMA_VOCABULARY;
  const withNull = (values) => [...values, "null"];
  if (kind === "definitions") return {
    "/$defs/traversal_provider_binding/oneOf/0/properties/observation_mechanism/enum":
      covers(v.traversal_mechanisms, v.observation_mechanisms),
    "/$defs/traversal_provider_binding/oneOf/0/properties/observation_seam/enum":
      exactly(v.traversal_seams),
    "/$defs/traversal_provider_binding/oneOf/1/properties/registry_version/const":
      constant(v.registry_version),
    "/$defs/falsifier/properties/mutation/properties/mechanism/enum":
      exactly(v.mutation_mechanisms),
    "/$defs/falsifier/allOf/1/if/properties/mutation/properties/mechanism/enum":
      exactly(v.function_mutation_mechanisms),
    "/$defs/falsifier/allOf/1/then/properties/mutation/properties/mechanism/enum":
      exactly(v.function_mutation_mechanisms),
    "/$defs/falsifier/allOf/1/then/properties/mutation/properties/module_path/pattern":
      acceptsSuffixes(v.native_source_suffixes),
    "/$defs/falsifier/properties/strategy/enum": covers(v.falsifier_strategies),
    "/$defs/system_under_test_boundary/properties/runtime_module_path/anyOf/1/pattern":
      acceptsSuffixes(v.native_source_suffixes)
  };
  if (kind === "root") return {
    "/$defs/authored_falsifier/allOf/1/if/properties/mutation/properties/mechanism/enum":
      exactly(v.function_mutation_mechanisms)
  };
  if (kind === "obligation_coverage") return {
    "/properties/cases/items/properties/target/oneOf/1/properties/path/pattern":
      acceptsSuffixes(v.native_source_suffixes),
    "/properties/cases/items/properties/falsification/properties/module_path/anyOf/1/pattern":
      acceptsSuffixes(v.native_source_suffixes)
  };
  if (kind === "evidence") return {
    "/$defs/provider_evidence/properties/observation_mechanism/enum":
      exactly(v.observation_mechanisms),
    "/$defs/provider_evidence/properties/evidence_artifact_types/items/enum":
      exactly(v.evidence_artifact_types),
    "/$defs/traversal_provider_evidence/oneOf/1/properties/registry_version/const":
      constant(v.registry_version),
    "/$defs/structured_result/properties/mechanism/enum": exactly(v.candidate_mechanisms),
    "/$defs/boundary_traversal/properties/observation_mechanism/enum":
      exactly(sortedUnique([...v.traversal_mechanisms, "registry_unsupported"])),
    "/$defs/boundary_traversal/properties/observation_seam/enum":
      exactly(sortedUnique(withNull(v.traversal_seams))),
    "/$defs/boundary_traversal/allOf/3/then/properties/observation_seam/enum":
      exactly(v.traversal_seams),
    "/$defs/falsifier_execution/properties/mutation/properties/mechanism/enum":
      exactly(v.mutation_mechanisms),
    "/$defs/falsifier_execution/properties/mutation/properties/strategy/enum":
      exactly(v.falsifier_strategies),
    "/$defs/artifact/properties/kind/enum": covers(v.evidence_artifact_types)
  };
  throw new TypeError(`unknown test-proof schema kind: ${kind}`);
}

function testProofSchemaVocabularyMismatches(kind, schema) {
  return Object.entries(schemaVocabularyChecks(kind))
    .filter(([pointer, check]) => !check(at(schema, pointer)))
    .map(([pointer]) => pointer);
}

export {
  NODE_TEST_SELECTOR_KIND,
  PROVIDER_REFUSAL_PRECEDENCE,
  TEST_PROOF_PROVIDER_AUTHORING_FACTS,
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  TEST_PROOF_PROVIDER_SCHEMA_VOCABULARY,
  TEST_RUNTIME_RUNNER_CATALOG,
  TestProofProviderCatalogError,
  composeFamilies as composeTestProofProviderFamilies,
  isTestProofSourcePath,
  resolveNativeTestSelector,
  resolveTestProofProviderCompatibility,
  testProofFalsifierProvider,
  testProofProviderFamily,
  testProofSchemaVocabularyMismatches,
  testProofSelectorKind,
  testProofStrategySelectorKinds,
  testProofWitnessValidator,
  testRuntimeRunner
};
