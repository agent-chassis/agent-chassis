import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { compiledValidators } from "./compiled-validator-cache.mjs";
import { validateProfileSchemaV1 } from "./verification-profile-schema-v1.mjs";
import { canonicalDigest as parameterDigest } from "./deterministic-projection-primitives.mjs";
import { validatePackParameterContract } from "./pack-parameter-contract.mjs";
import { profileDigest } from "./profile-digest.mjs";

const exactProofEvaluator = async (request) => (
  await import("./proof-evaluator-registry.mjs")
).resolveExactProofEvaluator(request);

const packageRoot = new URL("../", import.meta.url);
const catalogUrl = new URL("profiles/catalog.json", packageRoot);
const [catalogSchema, admissionSchema,
  componentExclusionApplicabilitySchema] = await Promise.all([
  readJson(new URL(
    "schema/controlled-contract-proof-pack-catalog.v1.schema.json",
    packageRoot
  )),
  readJson(new URL(
    "schema/controlled-contract-admitted-proof-pack.v3.schema.json",
    packageRoot
  )),
  readJson(new URL(
    "schema/controlled-contract-component-exclusion-applicability.v2.schema.json",
    packageRoot
  ))
]);
const {
  validateCatalog,
  validateAdmission,
  validateComponentExclusionApplicability
} = await compiledValidators("controlled-contract.admitted-proof-packs", {
  validators: {
    validateCatalog: catalogSchema,
    validateAdmission: admissionSchema,
    validateComponentExclusionApplicability: componentExclusionApplicabilitySchema
  }
});
const ADMITTED_PACK_SNAPSHOTS = new WeakSet();

class AdmittedProofPackError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AdmittedProofPackError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function assertCurrentDefinition(profile) {
  if (!validateProfileSchemaV1(profile)) throw new AdmittedProofPackError(
    "proof_pack_profile_invalid", "the exact definition does not use the current profile schema",
    { diagnostics: structuredClone(validateProfileSchemaV1.errors) }
  );
}

async function readJson(url) {
  const source = await readFile(url, "utf8");
  return JSON.parse(source);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map(
      (key) => [key, canonicalValue(value[key])]
    )
  );
  return value;
}

function canonicalDigest(value) {
  return createHash("sha256").update(
    `${JSON.stringify(canonicalValue(value), null, 2)}\n`
  ).digest("hex");
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function textDigest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readProofPackCatalog() {
  const catalog = await readJson(catalogUrl);
  if (!validateCatalog(catalog)) throw new AdmittedProofPackError(
    "proof_pack_catalog_invalid",
    "the shipped proof-pack catalog is schema-invalid",
    { diagnostics: structuredClone(validateCatalog.errors) }
  );
  const ids = catalog.packs.map(({ profile_id: profileId }) => profileId);
  if (new Set(ids).size !== ids.length) throw new AdmittedProofPackError(
    "proof_pack_catalog_identity_ambiguous",
    "the shipped catalog must contain one current version per profile id"
  );
  return structuredClone(catalog);
}

async function readAdmittedProofPack(profileId, { evaluator }) {
  const catalog = await readProofPackCatalog();
  const entry = catalog.packs.find(({ profile_id: candidate }) => candidate === profileId);
  if (!entry) throw new AdmittedProofPackError(
    "proof_pack_not_found",
    `no admitted proof pack is published for ${profileId}`,
    { profile_id: profileId }
  );
  const directory = new URL(`${entry.path}/`, packageRoot);
  const names = [
    "profile.json", "admission.json", "component-exclusion-applicability.json"
  ];
  const reads = await Promise.allSettled(names.map(
    (name) => readFile(new URL(name, directory))
  ));
  if (reads[0].status !== "fulfilled" || reads[1].status !== "fulfilled") {
    throw new AdmittedProofPackError(
      "proof_pack_admission_missing",
      "the shipped profile or admission carrier is missing",
      { profile_id: profileId }
    );
  }
  let profile;
  let admission;
  try {
    profile = JSON.parse(reads[0].value.toString("utf8"));
    admission = JSON.parse(reads[1].value.toString("utf8"));
  } catch (error) {
    throw new AdmittedProofPackError(
      "proof_pack_admission_invalid",
      "the shipped profile or admission carrier is not JSON",
      { profile_id: profileId, cause: error.message }
    );
  }
  const companion = await readComponentExclusionApplicability(
    reads[2], profileId
  );
  const admissionVersion = 3;
  const validateAdmissionCarrier = validateAdmission;
  if (!validateAdmissionCarrier(admission)) throw new AdmittedProofPackError(
    "proof_pack_admission_invalid",
    "the shipped proof-pack admission is schema-invalid",
    { profile_id: profileId, diagnostics: structuredClone(validateAdmissionCarrier.errors) }
  );
  assertCurrentDefinition(profile);
  const actualProfileDigest = profileDigest(profile);
  const mismatches = [];
  const expect = (field, expected, actual) => {
    if (expected !== actual) mismatches.push({ field, expected, actual });
  };
  expect("catalog.profile_id", entry.profile_id, profile.profile_id);
  expect("catalog.profile_version", entry.profile_version, profile.profile_version);
  expect("admission.profile_id", profile.profile_id, admission.profile_id);
  expect("admission.profile_version", profile.profile_version, admission.profile_version);
  expect("admission.profile_digest", actualProfileDigest, admission.profile_digest);
  expect("admission.guarantee_digest", textDigest(admission.guarantee),
    admission.guarantee_digest);
  if (mismatches.length > 0) throw new AdmittedProofPackError(
    "proof_pack_admission_binding_mismatch",
    "the shipped profile, catalog, and admission do not identify one artifact",
    { profile_id: profileId, mismatches }
  );
  const resultValue = {
    profile: structuredClone(profile),
    admission: structuredClone(admission),
    profile_digest: actualProfileDigest,
    admission_digest: canonicalDigest(admission),
    catalog_entry: structuredClone(entry),
    admission_version: admissionVersion,
    certification_identity: {
      method: admission.certification.method,
      adequacy_declaration_digest: `sha256:${admission.certification.adequacy_declaration_digest}`,
      adequacy_result_digest: `sha256:${admission.certification.adequacy_result_digest}`
    },
    ...await readParameterCompanion(directory, profile, admission),
    ...assertComponentExclusionApplicability(companion, profile, admission)
  };
  if (evaluator && profile.profile_id === "proof.verification.test-validity") {
    const resolved = await exactProofEvaluator({ proofPack: resultValue });
    if (resolved.status !== "resolved") throw new AdmittedProofPackError(
      "proof_pack_exact_evaluator_unavailable",
      "the admitted test-validity pack has no exact evaluator",
      { profile_id: profile.profile_id, profile_version: profile.profile_version }
    );
    resultValue.test_validity_evaluator = resolved;
  }
  const result = deepFreeze(resultValue);
  ADMITTED_PACK_SNAPSHOTS.add(result);
  return result;
}

async function readExactAdmittedProofPack(identity, { evaluator }) {
  if (identity === null || typeof identity !== "object" || Array.isArray(identity) ||
      Object.keys(identity).some((key) => !["profileId", "profileVersion"].includes(key))) {
    throw new AdmittedProofPackError("proof_pack_exact_identity_invalid",
      "exact proof-pack selection accepts only profileId and profileVersion");
  }
  const { profileId, profileVersion } = identity;
  for (const [field, value] of Object.entries({ profileId, profileVersion })) {
    if (typeof value !== "string" || value.length === 0) throw new AdmittedProofPackError(
      "proof_pack_exact_identity_invalid",
      `${field} must be a non-empty exact identity`, { field }
    );
  }
  if (!/^proof\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(profileId) ||
      !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(profileVersion)) {
    throw new AdmittedProofPackError(
      "proof_pack_exact_identity_invalid",
      "exact proof-pack identities must use the closed profile and version grammar"
    );
  }
  const catalog = await readProofPackCatalog();
  const current = catalog.packs.find(entry => entry.profile_id === profileId);
  if (!current) throw new AdmittedProofPackError("proof_pack_not_found",
    "No current proof pack has this identity", { profile_id: profileId });
  if (current.profile_version !== profileVersion) throw new AdmittedProofPackError(
    "proof_pack_exact_version_not_current", "The requested saved proof pin is not current", {
      authority_limb: "mechanical_failure",
      requested: { profile_id: profileId, profile_version: profileVersion },
      current: { profile_id: current.profile_id, profile_version: current.profile_version }
    });
  const directory = new URL(`${current.path}/`, packageRoot);
  let profileBytes;
  let admissionBytes;
  try {
    [profileBytes, admissionBytes] = await Promise.all([
      readFile(new URL("profile.json", directory)),
      readFile(new URL("admission.json", directory))
    ]);
  } catch (error) {
    if (error?.code === "ENOENT") throw new AdmittedProofPackError(
      "proof_pack_exact_version_unavailable",
      "the exact proof-pack version is unavailable",
      { profile_id: profileId, profile_version: profileVersion }
    );
    throw error;
  }
  let profile;
  let admission;
  try {
    profile = JSON.parse(profileBytes);
    admission = JSON.parse(admissionBytes);
  } catch (error) {
    throw new AdmittedProofPackError(
      "proof_pack_admission_invalid", "the exact proof pack is not JSON",
      { cause: error.message }
    );
  }
  const admissionVersion = 3;
  const validateAdmissionCarrier = validateAdmission;
  if (!validateAdmissionCarrier(admission)) throw new AdmittedProofPackError(
    "proof_pack_admission_invalid", "the exact proof-pack admission is schema-invalid",
    { diagnostics: structuredClone(validateAdmissionCarrier.errors) }
  );
  assertCurrentDefinition(profile);
  const profileDigestValue = profileDigest(profile);
  const mismatches = [];
  const expect = (field, expected, actual) => {
    if (expected !== actual) mismatches.push({ field, expected, actual });
  };
  expect("profile.profile_id", profileId, profile.profile_id);
  expect("profile.profile_version", profileVersion, profile.profile_version);
  expect("admission.profile_id", profileId, admission.profile_id);
  expect("admission.profile_version", profileVersion, admission.profile_version);
  expect("admission.profile_digest", profileDigestValue, admission.profile_digest);
  expect("admission.guarantee_digest", textDigest(admission.guarantee),
    admission.guarantee_digest);
  if (mismatches.length > 0) throw new AdmittedProofPackError(
    "proof_pack_admission_binding_mismatch",
    "the exact profile and admission do not identify one artifact",
    { mismatches }
  );
  const base = {
    profile: structuredClone(profile),
    admission: structuredClone(admission),
    profile_digest: profileDigestValue,
    admission_digest: canonicalDigest(admission),
    admission_version: admissionVersion,
    ...await readParameterCompanion(directory, profile, admission),
    certification_identity: {
      method: admission.certification.method,
      adequacy_declaration_digest: `sha256:${admission.certification.adequacy_declaration_digest}`,
      adequacy_result_digest: `sha256:${admission.certification.adequacy_result_digest}`
    }
  };
  if (evaluator) {
    const resolved = await exactProofEvaluator({ proofPack: base });
    if (resolved.status === "resolved") base.test_validity_evaluator = resolved;
  }
  const result = deepFreeze(base);
  ADMITTED_PACK_SNAPSHOTS.add(result);
  return result;
}

function readComponentExclusionApplicability(reading, profileId) {
  if (reading.status === "rejected") {
    if (reading.reason?.code === "ENOENT") return null;
    throw new AdmittedProofPackError(
      "proof_pack_component_exclusion_applicability_invalid",
      "the shipped component exclusion applicability companion could not be read",
      { profile_id: profileId, cause: reading.reason?.code ?? "unknown" }
    );
  }
  let companion;
  try {
    companion = JSON.parse(reading.value.toString("utf8"));
  } catch (error) {
    throw new AdmittedProofPackError(
      "proof_pack_component_exclusion_applicability_invalid",
      "the shipped component exclusion applicability companion is not JSON",
      { profile_id: profileId, cause: error.message }
    );
  }
  if (!validateComponentExclusionApplicability(companion)) throw new AdmittedProofPackError(
    "proof_pack_component_exclusion_applicability_invalid",
    "the shipped component exclusion applicability companion is schema-invalid",
    { profile_id: profileId, diagnostics: structuredClone(
      validateComponentExclusionApplicability.errors
    ) }
  );
  return companion;
}

function profileComponents(profile) {
  return [
    ["reference_binding", profile.reference_binding_patterns],
    ["claim", profile.claim_patterns],
    ["relation", profile.relation_patterns],
    ["collection", profile.collection_patterns],
    ["resolver_fact", profile.resolver_fact_patterns],
    ["evidence", profile.evidence_patterns]
  ].flatMap(([kind, patterns]) => (patterns ?? []).map((pattern) => ({
    kind,
    component_id: pattern.pattern_id,
  })));
}

function assertSorted(values, field) {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCodeUnits(values[index - 1], values[index]) >= 0) {
      throw new AdmittedProofPackError(
        "proof_pack_component_exclusion_applicability_binding_mismatch",
        `${field} must be unique and in canonical code-unit order`,
        { field }
      );
    }
  }
}

function rebindComponentExclusionApplicability(companion, profile, admission) {
  if (!validateComponentExclusionApplicability(companion)) throw new AdmittedProofPackError(
    "proof_pack_component_exclusion_applicability_invalid",
    "the component exclusion applicability companion is schema-invalid",
    { diagnostics: structuredClone(validateComponentExclusionApplicability.errors) }
  );
  const known = new Map(profileComponents(profile).map((component) => [
    `${component.kind}\u0000${component.component_id}`, component
  ]));
  const domain = [...new Set(admission.explicit_exclusions)].sort(compareCodeUnits);
  const unbound = [];
  const components = companion.components.map((component) => {
    const key = `${component.selector.kind}\u0000${component.selector.component_id}`;
    const declared = known.get(key);
    if (!declared) {
      unbound.push({ field: "companion.components", component: key });
      return component;
    }
    const applicable = [...new Set(component.applicable_exclusion_ids)]
      .sort(compareCodeUnits);
    for (const exclusionId of applicable) {
      if (!domain.includes(exclusionId)) unbound.push({
        field: `component.${key}.applicable_exclusion_ids`, exclusion_id: exclusionId
      });
    }
    return {
      ...component,
      exclusion_ids: [...domain],
      applicable_exclusion_ids: applicable
    };
  });
  if (unbound.length > 0) throw new AdmittedProofPackError(
    "proof_pack_component_exclusion_applicability_binding_mismatch",
    "an authored companion component is not admitted by the current profile and admission",
    { mismatches: unbound }
  );
  return {
    ...companion,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest(profile),
    admission_digest: canonicalDigest(admission),
    components: components.sort((left, right) => compareCodeUnits(
      `${left.selector.kind}\u0000${left.selector.component_id}`,
      `${right.selector.kind}\u0000${right.selector.component_id}`
    ))
  };
}

function assertComponentExclusionApplicability(companion, profile, admission) {
  if (companion === null) return {
    component_exclusion_applicability: null,
    component_exclusion_applicability_digest: null
  };
  if (!validateComponentExclusionApplicability(companion)) throw new AdmittedProofPackError(
    "proof_pack_component_exclusion_applicability_invalid",
    "the component exclusion applicability companion is schema-invalid",
    { diagnostics: structuredClone(validateComponentExclusionApplicability.errors) }
  );
  const actualProfileDigest = profileDigest(profile);
  const actualAdmissionDigest = canonicalDigest(admission);
  const mismatches = [];
  const expect = (field, expected, actual) => {
    if (expected !== actual) mismatches.push({ field, expected, actual });
  };
  expect("companion.profile_id", profile.profile_id, companion.profile_id);
  expect("companion.profile_version", profile.profile_version, companion.profile_version);
  expect("companion.profile_digest", actualProfileDigest, companion.profile_digest);
  expect("companion.admission_digest", actualAdmissionDigest, companion.admission_digest);
  const known = new Map(profileComponents(profile).map((component) => [
    `${component.kind}\u0000${component.component_id}`, component
  ]));
  const seen = new Set();
  const componentKeys = companion.components.map(({ selector }) =>
    `${selector.kind}\u0000${selector.component_id}`
  );
  assertSorted(componentKeys, "companion.components");
  for (const component of companion.components) {
    const { selector, exclusion_ids: exclusions,
      applicable_exclusion_ids: applicable } = component;
    const key = `${selector.kind}\u0000${selector.component_id}`;
    if (seen.has(key)) mismatches.push({ field: "companion.components", component: key });
    seen.add(key);
    const expected = known.get(key);
    if (!expected) mismatches.push({ field: "companion.components", component: key });
    const normalizedDomain = [...new Set(admission.explicit_exclusions)].sort(compareCodeUnits);
    const normalizedExclusions = [...new Set(exclusions)].sort(compareCodeUnits);
    if (JSON.stringify(exclusions) !== JSON.stringify(normalizedExclusions) ||
        JSON.stringify(normalizedExclusions) !== JSON.stringify(normalizedDomain)) {
      mismatches.push({ field: `component.${key}.exclusion_ids` });
    }
    assertSorted(exclusions, `component.${key}.exclusion_ids`);
    assertSorted(applicable, `component.${key}.applicable_exclusion_ids`);
    if (applicable.some((id) => !normalizedDomain.includes(id))) {
      mismatches.push({ field: `component.${key}.applicable_exclusion_ids` });
    }
  }
  if (mismatches.length > 0) throw new AdmittedProofPackError(
    "proof_pack_component_exclusion_applicability_binding_mismatch",
    "the component exclusion applicability companion is not bound to this pack",
    { mismatches }
  );
  return {
    component_exclusion_applicability: structuredClone(companion),
    component_exclusion_applicability_digest: canonicalDigest(companion)
  };
}

async function readParameterCompanion(directory, profile, admission) {
  let companion;
  try { companion = await readJson(new URL("parameter-contract.json", directory)); }
  catch (error) {
    throw new AdmittedProofPackError(error.code === "ENOENT"
      ? "proof_pack_parameter_companion_missing" : "proof_pack_parameter_companion_invalid",
    "the required parameter companion could not be read", {
      limb: "mechanical_failure", field: "parameter-contract.json", cause: error.message
    });
  }
  const digest = parameterDigest(companion);
  if (digest !== admission.parameter_contract_digest) throw new AdmittedProofPackError(
    "proof_pack_parameter_binding_mismatch", "parameter bytes do not match their admission", {
      limb: "mechanical_failure", field: "admission.parameter_contract_digest",
      expected: admission.parameter_contract_digest, actual: digest
    });
  const validated = validatePackParameterContract(companion, profile);
  return { parameter_contract: validated, parameter_contract_digest: digest };
}

function assertAdmittedProofPackSnapshot(pack) {
  if (!ADMITTED_PACK_SNAPSHOTS.has(pack) || !Object.isFrozen(pack)) {
    throw new AdmittedProofPackError(
      "proof_pack_snapshot_unrecognized",
      "aggregate assessment requires the exact snapshot returned by the admitted-pack loader"
    );
  }
  return pack;
}

const loadAdmittedProofPack = (profileId) =>
  readAdmittedProofPack(profileId, { evaluator: true });
const loadExactAdmittedProofPack = (identity) =>
  readExactAdmittedProofPack(identity, { evaluator: true });

const loadAdmittedProofPackMeaning = (profileId) =>
  readAdmittedProofPack(profileId, { evaluator: false });
const loadExactAdmittedProofPackMeaning = (identity) =>
  readExactAdmittedProofPack(identity, { evaluator: false });

export {
  canonicalDigest as admissionDigest,
  AdmittedProofPackError,
  assertAdmittedProofPackSnapshot,
  assertComponentExclusionApplicability,
  loadExactAdmittedProofPack,
  loadExactAdmittedProofPackMeaning,
  loadAdmittedProofPack,
  loadAdmittedProofPackMeaning,
  readProofPackCatalog,
  rebindComponentExclusionApplicability
};
