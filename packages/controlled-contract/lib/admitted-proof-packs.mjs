import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { compiledValidators } from "./compiled-validator-cache.mjs";
import { profileDigest } from "./profile-digest.mjs";
import { loadExactBindingAdmissionV1 } from "./exact-binding-admission.mjs";
import { resolveExactProofEvaluator } from "./proof-evaluator-registry.mjs";

const packageRoot = new URL("../", import.meta.url);
const catalogUrl = new URL("profiles/catalog.json", packageRoot);
const [catalogSchema, admissionSchema, admissionSchemaV2,
  componentExclusionApplicabilitySchema] = await Promise.all([
  readJson(new URL(
    "schema/controlled-contract-proof-pack-catalog.v1.schema.json",
    packageRoot
  )),
  readJson(new URL(
    "schema/controlled-contract-admitted-proof-pack.v1.schema.json",
    packageRoot
  )),
  readJson(new URL(
    "schema/controlled-contract-admitted-proof-pack.v2.schema.json",
    packageRoot
  )),
  readJson(new URL(
    "schema/controlled-contract-component-exclusion-applicability.v1.schema.json",
    packageRoot
  ))
]);
const {
  validateCatalog,
  validateAdmission,
  validateAdmissionV2,
  validateComponentExclusionApplicability
} = await compiledValidators("controlled-contract.admitted-proof-packs", {
  validators: {
    validateCatalog: catalogSchema,
    validateAdmission: admissionSchema,
    validateAdmissionV2: admissionSchemaV2,
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

async function loadAdmittedProofPack(profileId) {
  const catalog = await readProofPackCatalog();
  const entry = catalog.packs.find(({ profile_id: candidate }) => candidate === profileId);
  if (!entry) throw new AdmittedProofPackError(
    "proof_pack_not_found",
    `no admitted proof pack is published for ${profileId}`,
    { profile_id: profileId }
  );
  const directory = new URL(`${entry.path}/`, packageRoot);
  const names = [
    "profile.json", "admission.json", "exact-binding.json",
    "exact-binding-certification.json", "component-exclusion-applicability.json"
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
    reads[4], profileId
  );
  if (admission.schema_version === "controlled-contract-admitted-proof-pack.v2") {
    if (!validateAdmissionV2(admission)) throw new AdmittedProofPackError(
      "proof_pack_admission_invalid",
      "the shipped v2 proof-pack admission is schema-invalid",
      { profile_id: profileId, diagnostics: structuredClone(validateAdmissionV2.errors) }
    );
    const exactPack = await loadExactBindingAdmissionV1(
      path.resolve(fileURLToPath(directory)), profileId,
      {
        rawFiles: reads.map((reading) =>
          reading.status === "fulfilled" ? reading.value : null
        ).slice(0, 4)
      }
    );
    const mismatches = [];
    if (entry.profile_version !== exactPack.profile.profile_version) mismatches.push({
      field: "catalog.profile_version",
      expected: entry.profile_version,
      actual: exactPack.profile.profile_version
    });
    if (mismatches.length > 0) throw new AdmittedProofPackError(
      "proof_pack_admission_binding_mismatch",
      "the shipped catalog and v2 admission do not identify one artifact",
      { profile_id: profileId, mismatches }
    );
    const result = deepFreeze({
      ...structuredClone(exactPack),
      admission_digest: canonicalDigest(exactPack.admission),
      catalog_entry: structuredClone(entry),
      admission_version: 2,
      ...assertComponentExclusionApplicability(companion, exactPack.profile,
        exactPack.admission)
    });
    ADMITTED_PACK_SNAPSHOTS.add(result);
    return result;
  }
  if (!validateAdmission(admission)) throw new AdmittedProofPackError(
    "proof_pack_admission_invalid",
    "the shipped proof-pack admission is schema-invalid",
    { profile_id: profileId, diagnostics: structuredClone(validateAdmission.errors) }
  );
  const actualProfileDigest = profile.schema_version ===
    "controlled-contract-test-validity-profile.v1"
    ? canonicalDigest(profile)
    : profileDigest(profile);
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
    admission_version: 1,
    ...assertComponentExclusionApplicability(companion, profile, admission)
  };
  if (profile.profile_id === "proof.verification.test-validity") {
    const evaluator = await resolveExactProofEvaluator({
      proofPack: resultValue,
      evaluationStage: profile.evaluation_stages[0]
    });
    if (evaluator.status !== "resolved") throw new AdmittedProofPackError(
      "proof_pack_exact_evaluator_unavailable",
      "the admitted test-validity pack has no exact evaluator",
      { profile_id: profile.profile_id, profile_version: profile.profile_version }
    );
    resultValue.test_validity_evaluator = evaluator;
  }
  const result = deepFreeze(resultValue);
  ADMITTED_PACK_SNAPSHOTS.add(result);
  return result;
}

async function loadExactAdmittedProofPack({
  profileId,
  profileVersion,
  evaluationStage
}) {
  for (const [field, value] of Object.entries({ profileId, profileVersion, evaluationStage })) {
    if (typeof value !== "string" || value.length === 0) throw new AdmittedProofPackError(
      "proof_pack_exact_identity_invalid",
      `${field} must be a non-empty exact identity`, { field }
    );
  }
  if (!/^proof\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(profileId) ||
      !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(profileVersion) ||
      !/^[a-z][a-z0-9_]*$/u.test(evaluationStage)) {
    throw new AdmittedProofPackError(
      "proof_pack_exact_identity_invalid",
      "exact proof-pack identities must use the closed profile, version, and stage grammar"
    );
  }
  const directory = new URL(`profiles/${profileId}/${profileVersion}/`, packageRoot);
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
  if (!validateAdmission(admission)) throw new AdmittedProofPackError(
    "proof_pack_admission_invalid", "the exact proof-pack admission is schema-invalid",
    { diagnostics: structuredClone(validateAdmission.errors) }
  );
  const profileDigestValue = profile.schema_version ===
    "controlled-contract-test-validity-profile.v1"
    ? canonicalDigest(profile) : profileDigest(profile);
  const mismatches = [];
  const expect = (field, expected, actual) => {
    if (expected !== actual) mismatches.push({ field, expected, actual });
  };
  expect("profile.profile_id", profileId, profile.profile_id);
  expect("profile.profile_version", profileVersion, profile.profile_version);
  expect("profile.evaluation_stage", true,
    profile.evaluation_stages?.includes(evaluationStage) === true);
  expect("admission.profile_id", profileId, admission.profile_id);
  expect("admission.profile_version", profileVersion, admission.profile_version);
  expect("admission.profile_digest", profileDigestValue, admission.profile_digest);
  expect("admission.guarantee_digest", textDigest(admission.guarantee),
    admission.guarantee_digest);
  if (mismatches.length > 0) throw new AdmittedProofPackError(
    "proof_pack_admission_binding_mismatch",
    "the exact profile, stage, and admission do not identify one artifact",
    { mismatches }
  );
  const base = {
    profile: structuredClone(profile),
    admission: structuredClone(admission),
    profile_digest: profileDigestValue,
    admission_digest: canonicalDigest(admission),
    admission_version: 1,
    evaluation_stage: evaluationStage,
    certification_identity: {
      method: admission.certification.method,
      adequacy_declaration_digest: `sha256:${admission.certification.adequacy_declaration_digest}`,
      adequacy_result_digest: `sha256:${admission.certification.adequacy_result_digest}`
    }
  };
  const evaluator = await resolveExactProofEvaluator({
    proofPack: base,
    evaluationStage
  });
  if (evaluator.status === "resolved") base.test_validity_evaluator = evaluator;
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
    evaluation_stage: pattern.required_by_stage
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
  const actualProfileDigest = profile.schema_version ===
    "controlled-contract-test-validity-profile.v1"
    ? canonicalDigest(profile)
    : profileDigest(profile);
  const actualAdmissionDigest = canonicalDigest(admission);
  const mismatches = [];
  const expect = (field, expected, actual) => {
    if (expected !== actual) mismatches.push({ field, expected, actual });
  };
  expect("companion.profile_id", profile.profile_id, companion.profile_id);
  expect("companion.profile_version", profile.profile_version, companion.profile_version);
  expect("companion.profile_digest", actualProfileDigest, companion.profile_digest);
  expect("companion.admission_digest", actualAdmissionDigest, companion.admission_digest);
  const stageSet = new Set(profile.evaluation_stages ?? []);
  const known = new Map(profileComponents(profile).map((component) => [
    `${component.kind}\u0000${component.component_id}`, component
  ]));
  const seen = new Set();
  const componentKeys = companion.components.map(({ selector }) =>
    `${selector.kind}\u0000${selector.component_id}`
  );
  assertSorted(componentKeys, "companion.components");
  for (const component of companion.components) {
    const { selector, evaluation_stage: stage, exclusion_ids: exclusions,
      applicable_exclusion_ids: applicable } = component;
    const key = `${selector.kind}\u0000${selector.component_id}`;
    if (seen.has(key)) mismatches.push({ field: "companion.components", component: key });
    seen.add(key);
    const expected = known.get(key);
    if (!expected) mismatches.push({ field: "companion.components", component: key });
    else expect(`component.${key}.evaluation_stage`, expected.evaluation_stage, stage);
    if (!stageSet.has(stage)) mismatches.push({ field: `component.${key}.evaluation_stage`, actual: stage });
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

function assertAdmittedProofPackSnapshot(pack) {
  if (!ADMITTED_PACK_SNAPSHOTS.has(pack) || !Object.isFrozen(pack)) {
    throw new AdmittedProofPackError(
      "proof_pack_snapshot_unrecognized",
      "aggregate assessment requires the exact snapshot returned by the admitted-pack loader"
    );
  }
  return pack;
}

export {
  AdmittedProofPackError,
  assertAdmittedProofPackSnapshot,
  assertComponentExclusionApplicability,
  loadExactAdmittedProofPack,
  loadAdmittedProofPack,
  readProofPackCatalog
};
