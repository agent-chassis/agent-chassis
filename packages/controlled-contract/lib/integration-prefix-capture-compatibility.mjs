import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compiledValidators } from "./compiled-validator-cache.mjs";
import { loadAdmittedProofPack, readProofPackCatalog } from "./admitted-proof-packs.mjs";
import { assertSchema, validators } from "./exact-binding-common.mjs";
import { canonicalJsonBytes, canonicalValue, sha256 } from "./deterministic-projection-primitives.mjs";
import { profileDigest } from "./profile-digest.mjs";
import {
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034,
  validateProfileSchemaV034
} from "./verification-profile-v034.mjs";
import {
  validateEvaluationInputSchemaV1,
  validateProfileSchemaV1
} from "./verification-profile-schema-v1.mjs";

const ARTIFACTS = Object.freeze(["profile.json", "admission.json",
  "evaluation-input.template.json", "exact-binding.json",
  "exact-binding-certification.json"]);
const PROFILE_ID = "proof.integration.prefix-safety";
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HISTORICAL_RELATIVE = `profiles/${PROFILE_ID}/1.0.0`;
const CURRENT_RELATIVE = `profiles/${PROFILE_ID}/2.0.0`;
const SORTED_ARTIFACTS = Object.freeze(ARTIFACTS.slice().sort());
const { inputValidatorV034 } = await compiledValidators(
  "controlled-contract.integration-prefix-capture-compatibility.v034-input",
  { validators: { inputValidatorV034: VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034 } }
);
const MIGRATIONS = Object.freeze({
  "/profile/schema_version": ["controlled-contract-verification-profile.experimental.v0.2", "controlled-contract-verification-profile.v1"],
  "/profile/profile_version": ["1.0.0", "2.0.0"],
  "/profile/contract_schema_version": ["controlled-acceptance-contract.experimental.v0.2", "controlled-acceptance-contract.v1"],
  "/profile/vocabulary_version": ["cv.experimental.0.34", "controlled-contract-vocabulary.v1"],
  "/profile/vocabulary_signature_digest": ["5bb8257d89877737007ebf38c77d269bce3d1dc823bbf1bffa7f7122e4a7c55c", "596a4c44d98aed1d31dd9ab3842fc054be6f8ffa3d62a3867a3966e75ecab742"],
  "/profile/vocabulary_algebra_digest": ["2653922ce964cffa0836844685c189b872bdacab61ff7efb4ed47fb20b3fdd06", "0fbea1e7377baeef1869cbc55dc588ef5509ed40c768ce2a3c4f58be1133cf9c"],
  "/profile/vocabulary_definitions_digest": ["bdf62efd8e3d0bcbae9e670ed666ad8512d2a945f240ed3b2139379667b1d799", "bb3d2a63cb6fc8c62b9bc36d29d07549dea6ad85e32badb0cbb3cacfd6ad4759"],
  "/profile/vocabulary_complete_digest": ["6d3bf713dd28cd94f605a7a9e3d997ad8745f990418c4a91def60504af25bd7c", "45484504f06968c6b4ac812c24b9f1b6e47e1d34ba21fefebde8dd85d1290fa9"],
  "/admission/profile_version": ["1.0.0", "2.0.0"],
  "/admission/profile_digest": ["80afa275a69c57e9d2c4c395169851198efe043df1e097ea6cae25a2ea00f671", "f0ccdd91e638d72aa09c7e3e46dc4d16ae295d602dde297899ea88017729b32c"],
  "/admission/exact_binding/declaration_digest": ["712af9ee4a4e95371c968353d9fe3c6ce00ddd2f82c4062caf1c2b7524148af3", "8c4f564cdc15d70aa3755d46915daa425c5006ed798a9c99ba1d4e1e30b9fe19"],
  "/admission/exact_binding/certification_result_digest": ["a284494de8104d268c76898011dd36de73e68a35ea9362acb2532fdfa8989f45", "03a5faaeb5bf1fb73807122680391879cdd7b692fff67849f37202c3ade0850e"],
  "/admission/exact_binding/corpus_digest": ["c3b60a2d9b3a2daa537d6c20e1204ca9cfe776304ef505f028bf048a0375b62c", "b4483cf43cc1888e0f4fd1a46ca4d8466f22ed2bd377879a5d5dfbd839eb13c3"],
  "/admission/certification/adequacy_declaration_digest": ["9313dbf8726cc3bb05679e6b60a88f014bbd7088401f168fddcd2ddc7acfee7f", "2f64d49e61b321c8a3b9336d99866cfd45300fd2ab611a3a34a1b915cc30bcca"],
  "/admission/certification/adequacy_result_digest": ["167cf23d4bbcd407f5bcc801e5cc17e1ecba48349dfbb97c77c9eee0e5be57a9", "405cb4f7f6509dc24d1d16f1f2493f258fa321cfd6267eb13bc838ae98f8d970"],
  "/evaluation-input.template/input_version": ["controlled-contract-verification-profile-input.experimental.v0.2", "controlled-contract-verification-profile-input.v1"],
  "/evaluation-input.template/stable_evaluation": [undefined, {}],
  "/exact-binding/profile_version": ["1.0.0", "2.0.0"],
  "/exact-binding/profile_digest": ["80afa275a69c57e9d2c4c395169851198efe043df1e097ea6cae25a2ea00f671", "f0ccdd91e638d72aa09c7e3e46dc4d16ae295d602dde297899ea88017729b32c"],
  "/exact-binding-certification/profile_version": ["1.0.0", "2.0.0"],
  "/exact-binding-certification/profile_digest": ["80afa275a69c57e9d2c4c395169851198efe043df1e097ea6cae25a2ea00f671", "f0ccdd91e638d72aa09c7e3e46dc4d16ae295d602dde297899ea88017729b32c"],
  "/exact-binding-certification/exact_binding_declaration_digest": ["712af9ee4a4e95371c968353d9fe3c6ce00ddd2f82c4062caf1c2b7524148af3", "8c4f564cdc15d70aa3755d46915daa425c5006ed798a9c99ba1d4e1e30b9fe19"],
  "/exact-binding-certification/corpus/corpus_digest": ["c3b60a2d9b3a2daa537d6c20e1204ca9cfe776304ef505f028bf048a0375b62c", "b4483cf43cc1888e0f4fd1a46ca4d8466f22ed2bd377879a5d5dfbd839eb13c3"]
});
const MIGRATION_LABELS = Object.freeze(Object.fromEntries([
  ["/profile/schema_version", "carrier_schema"], ["/profile/profile_version", "profile_version"],
  ["/profile/contract_schema_version", "carrier_schema"], ["/profile/vocabulary_version", "vocabulary"],
  ["/profile/vocabulary_signature_digest", "vocabulary"], ["/profile/vocabulary_algebra_digest", "vocabulary"],
  ["/profile/vocabulary_definitions_digest", "vocabulary"], ["/profile/vocabulary_complete_digest", "vocabulary"],
  ["/admission/profile_version", "profile_version"], ["/admission/profile_digest", "profile_digest"],
  ["/admission/exact_binding/declaration_digest", "certification_identity"],
  ["/admission/exact_binding/certification_result_digest", "certification_identity"],
  ["/admission/exact_binding/corpus_digest", "certification_identity"],
  ["/admission/certification/adequacy_declaration_digest", "certification_identity"],
  ["/admission/certification/adequacy_result_digest", "certification_identity"],
  ["/evaluation-input.template/input_version", "input_schema"],
  ["/evaluation-input.template/stable_evaluation", "stable_evaluation"],
  ["/exact-binding/profile_version", "profile_version"], ["/exact-binding/profile_digest", "profile_digest"],
  ["/exact-binding-certification/profile_version", "certification_identity"],
  ["/exact-binding-certification/profile_digest", "certification_identity"],
  ["/exact-binding-certification/exact_binding_declaration_digest", "certification_identity"],
  ["/exact-binding-certification/corpus/corpus_digest", "certification_identity"]
]));

class IntegrationPrefixCompatibilityError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = "IntegrationPrefixCompatibilityError";
    this.code = code; this.details = structuredClone(details);
  }
}

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactValue = (left, right) => Object.is(left, right) ||
  (left !== undefined && right !== undefined &&
    canonicalJsonBytes(left).equals(canonicalJsonBytes(right)));
const pointer = (base, key) => `${base}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
function differences(left, right, at = "") {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return [{ pointer: at || "/", ...(left === undefined ? {} : { old_value: left }),
        ...(right === undefined ? {} : { new_value: right }) }];
    }
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) =>
      differences(left[index], right[index], pointer(at, index))).flat();
  }
  if (!plain(left) || !plain(right)) {
    return [{ pointer: at || "/", ...(left === undefined ? {} : { old_value: left }),
      ...(right === undefined ? {} : { new_value: right }) }];
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.flatMap((key) => differences(left[key], right[key], pointer(at, key)));
}
function equality(value) { return { equal: value.length === 0, differences: value }; }
function indexBy(array, field) { return new Map((array ?? []).map((item) => [item[field], item])); }
function componentSummary(oldProfile, currentProfile, oldAdmission, currentAdmission,
  oldInput, currentInput, oldBinding, currentBinding, oldCertification, currentCertification) {
  const compare = (a, b) => equality(differences(a, b));
  return {
    guarantee: compare(oldAdmission.guarantee, currentAdmission.guarantee),
    claims: compare(oldProfile.claim_patterns, currentProfile.claim_patterns),
    relations: compare(oldBinding.relations, currentBinding.relations),
    roles: compare(oldProfile.reference_roles, currentProfile.reference_roles),
    counts: compare(oldProfile.number_roles, currentProfile.number_roles),
    binding_patterns: compare(oldProfile.reference_binding_patterns, currentProfile.reference_binding_patterns),
    relation_patterns: compare(oldProfile.relation_patterns, currentProfile.relation_patterns),
    reference_role_count_bindings: compare(oldProfile.reference_role_count_bindings, currentProfile.reference_role_count_bindings),
    exact_binding_requirements: compare(oldBinding.requirements, currentBinding.requirements),
    exact_binding_relations: compare(oldBinding.relations, currentBinding.relations),
    exact_binding_roles: compare(oldBinding.requirements?.flatMap(({ role_coverage: roles = [] }) => roles),
      currentBinding.requirements?.flatMap(({ role_coverage: roles = [] }) => roles)),
    exclusions: compare(oldAdmission.explicit_exclusions, currentAdmission.explicit_exclusions),
    carrier_schema: { old: oldProfile.schema_version, current: currentProfile.schema_version },
    input_schema: { old: oldInput.input_version, current: currentInput.input_version },
    vocabulary: { old: oldProfile.vocabulary_version, current: currentProfile.vocabulary_version },
    stable_evaluation: { old: oldInput.stable_evaluation ?? null, current: currentInput.stable_evaluation ?? null },
    certification_identity: { old: oldAdmission.certification, current: currentAdmission.certification },
    declaration_identity: { old: identity(oldBinding), current: identity(currentBinding) },
    certification_result_identity: { old: identity(oldCertification), current: identity(currentCertification) },
    corpus_identity: { old: { admission: oldAdmission.exact_binding, certification: oldCertification.corpus },
      current: { admission: currentAdmission.exact_binding, certification: currentCertification.corpus } }
  };
}
function identity(value) {
  return Object.fromEntries(["schema_version", "profile_id", "profile_version", "profile_digest",
    "exact_binding_declaration_digest"].map((key) => [key, value?.[key] ?? null]));
}

async function observeMembership(directory, version) {
  let names;
  try { names = await readdir(directory); } catch (error) {
    throw new IntegrationPrefixCompatibilityError("source_unavailable", `cannot read ${version} source directory`, { cause: error.code });
  }
  const actual = names.slice().sort();
  const missing = SORTED_ARTIFACTS.filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !SORTED_ARTIFACTS.includes(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new IntegrationPrefixCompatibilityError("unexpected_artifact",
      `${version} source directory is not exact`, { names: actual,
        membership: { directory, version, expected: SORTED_ARTIFACTS, actual, missing, unexpected } });
  }
  return actual;
}
async function readBoundSources(directory, version) {
  await observeMembership(directory, version);
  const result = {};
  for (const name of ARTIFACTS) {
    const filename = path.join(directory, name);
    let before, value, after;
    try {
      before = await readFile(filename); value = JSON.parse(before.toString("utf8"));
      after = await readFile(filename);
    } catch (error) {
      throw new IntegrationPrefixCompatibilityError("source_unavailable", `${version}/${name} is unavailable or malformed`, { artifact: name, cause: error.code ?? error.message });
    }
    if (!before.equals(after)) throw new IntegrationPrefixCompatibilityError("source_changed", `${version}/${name} changed while being read`, { artifact: name });
    if (!plain(value)) throw new IntegrationPrefixCompatibilityError("malformed_artifact", `${version}/${name} must be an object`, { artifact: name });
    result[name] = { path: filename, digest: sha256(before), bytes: before, value };
  }
  return result;
}
function validateCarriers(sources) {
  const admission = sources["admission.json"].value;
  const admittedValidator = validators["controlled-contract-admitted-proof-pack.v2.schema.json"];
  if (!admittedValidator) throw new IntegrationPrefixCompatibilityError(
    "schema_owner_unavailable", "admitted v2 schema owner is unavailable");
  if (!admittedValidator(admission)) throw new IntegrationPrefixCompatibilityError(
    "malformed_artifact", "admission does not satisfy the admitted v2 owner", {
      diagnostics: structuredClone(admittedValidator.errors)
    });
  assertSchema("controlled-contract-exact-binding-declaration.v1.schema.json", sources["exact-binding.json"].value, "malformed_artifact");
  assertSchema("controlled-contract-exact-binding-certification-result.v1.schema.json", sources["exact-binding-certification.json"].value, "malformed_artifact");
  if (!validators["controlled-contract-exact-binding-declaration.v1.schema.json"] ||
      !validators["controlled-contract-exact-binding-certification-result.v1.schema.json"]) {
    throw new IntegrationPrefixCompatibilityError("schema_owner_unavailable", "exact-binding schema owner is unavailable");
  }
  const profile = sources["profile.json"].value;
  const input = sources["evaluation-input.template.json"].value;
  const profileValidator = profile.profile_version === "1.0.0"
    ? validateProfileSchemaV034 : validateProfileSchemaV1;
  const inputValidator = profile.profile_version === "1.0.0"
    ? inputValidatorV034 : validateEvaluationInputSchemaV1;
  if (!profileValidator(profile)) throw new IntegrationPrefixCompatibilityError(
    "malformed_artifact", "profile does not satisfy its version-specific owner", {
      diagnostics: structuredClone(profileValidator.errors)
    });
  if (!inputValidator(input)) throw new IntegrationPrefixCompatibilityError(
    "malformed_artifact", "evaluation input does not satisfy its version-specific owner", {
      diagnostics: structuredClone(inputValidator.errors)
    });
  if (profile.profile_id !== PROFILE_ID || admission.profile_id !== PROFILE_ID ||
      admission.profile_version !== profile.profile_version) {
    throw new IntegrationPrefixCompatibilityError("malformed_artifact", "profile and admission identities differ");
  }
}
function bindSources(sources) { return Object.fromEntries(ARTIFACTS.map((name) => [name, {
  path: sources[name].path, sha256: sources[name].digest
}])); }
function artifactEvidence(observedSources, canonicalSources, relative = CURRENT_RELATIVE) {
  return ARTIFACTS.map((name) => ({
    artifact: name,
    expected: {
      path: canonicalSources?.[name]?.path ?? path.resolve(ROOT, relative, name),
      sha256: canonicalSources?.[name]?.digest ?? null
    },
    actual: {
      path: observedSources?.[name]?.path ?? null,
      sha256: observedSources?.[name]?.digest ?? null
    }
  }));
}

function mismatchedArtifacts(observedSources, canonicalSources) {
  return ARTIFACTS.flatMap((name) => {
    const expected = { path: canonicalSources[name].path, sha256: canonicalSources[name].digest };
    const actual = { path: observedSources[name].path, sha256: observedSources[name].digest };
    return expected.path === actual.path && expected.sha256 === actual.sha256
      ? [] : [{ artifact: name, expected, actual }];
  });
}

function assertCanonicalHistoricalBinding(oldSources, canonicalHistoricalSources) {
  const mismatched = mismatchedArtifacts(oldSources, canonicalHistoricalSources);
  if (mismatched.length > 0) throw new IntegrationPrefixCompatibilityError(
    "historical_source_binding_mismatch",
    "the historical input is not the canonical checked-in 1.0.0 profile source",
    { expected_directory: path.resolve(ROOT, HISTORICAL_RELATIVE), mismatched_artifacts: mismatched });
  return true;
}
function boundDifferences(canonicalDifferences) {
  return canonicalDifferences.map((entry) => ({ ...entry,
    expected_value: entry.old_value,
    actual_value: entry.new_value
  }));
}
function assertAdmittedCurrentBinding(catalogEntry, admitted, currentSources, canonicalSources) {
  const expectedEntry = {
    profile_id: PROFILE_ID,
    profile_version: "2.0.0",
    path: CURRENT_RELATIVE
  };
  const mismatches = [];
  const expect = (field, expected, actual) => {
    if (!exactValue(expected, actual)) mismatches.push({ field, expected, actual });
  };
  expect("catalog.entry", expectedEntry, catalogEntry);
  expect("catalog.snapshot", catalogEntry, admitted.catalog_entry);
  expect("admitted.profile", canonicalSources["profile.json"].value, admitted.profile);
  expect("admitted.admission", canonicalSources["admission.json"].value, admitted.admission);
  expect("admission.profile_id", PROFILE_ID, admitted.profile.profile_id);
  expect("admission.profile_version", "2.0.0", admitted.profile.profile_version);
  expect("admission.profile_digest", profileDigest(canonicalSources["profile.json"].value), admitted.profile_digest);
  expect("admission.exact_binding.declaration_digest", canonicalSources["exact-binding.json"].digest,
    admitted.admission.exact_binding?.declaration_digest);
  expect("admission.exact_binding.certification_result_digest", canonicalSources["exact-binding-certification.json"].digest,
    admitted.admission.exact_binding?.certification_result_digest);
  const mismatched = mismatchedArtifacts(currentSources, canonicalSources);
  const exact = mismatched.length === 0;
  if (mismatches.length > 0 || mismatched.length > 0) throw new IntegrationPrefixCompatibilityError(
    "proof_pack_admission_binding_mismatch",
    "the catalog and admitted snapshot do not bind the canonical v2 proof pack",
    { mismatches, artifact_evidence: mismatched }
  );
  return exact;
}
async function verifySourcesUnchanged(sources, version) {
  try {

    await observeMembership(path.dirname(sources[ARTIFACTS[0]].path), version);
    for (const name of ARTIFACTS) {
      const bytes = await readFile(sources[name].path);
      if (!bytes.equals(sources[name].bytes) || sha256(bytes) !== sources[name].digest) {
        throw new IntegrationPrefixCompatibilityError("source_changed", `${version}/${name} changed during comparison`, { artifact: name });
      }
    }
  } catch (error) {
    if (error instanceof IntegrationPrefixCompatibilityError) throw error;
    throw new IntegrationPrefixCompatibilityError("source_unavailable", `${version} source unavailable during final verification`, { cause: error.code ?? error.message });
  }
}

async function compareIntegrationPrefixCaptureCompatibility(options = {}) {
  const oldDirectory = options.oldDirectory ?? path.join(ROOT, HISTORICAL_RELATIVE);
  const currentDirectory = options.currentDirectory ?? path.join(ROOT, CURRENT_RELATIVE);
  const readCatalog = options.readProofPackCatalog ?? readProofPackCatalog;
  const loadAdmission = options.loadAdmittedProofPack ?? loadAdmittedProofPack;
  const readCanonicalSources = options.readCanonicalSources ??
    (() => readBoundSources(path.join(ROOT, CURRENT_RELATIVE), "2.0.0"));
  const beforeFinalObservation = options.beforeFinalObservation ?? (async () => {});
  let oldSources, currentSources;
  try { oldSources = await readBoundSources(oldDirectory, "1.0.0"); currentSources = await readBoundSources(currentDirectory, "2.0.0"); }
  catch (error) { if (error instanceof IntegrationPrefixCompatibilityError) return { schema_version: "controlled-contract-integration-prefix-compatibility.v1", outcome: "source_unavailable", error: { code: error.code, details: error.details } }; throw error; }
  let catalog, admission, canonicalSources;
  try { validateCarriers(oldSources); validateCarriers(currentSources); }
  catch (error) {
    const carrierDifferences = ARTIFACTS.flatMap((name) => differences(
      oldSources[name].value, currentSources[name].value, `/${name.replace(/\.json$/u, "")}`));
    const explicitOnly = carrierDifferences.length > 0 && carrierDifferences.every(({ pointer: at, old_value, new_value }) => {
      const expected = MIGRATIONS[at];
      return expected !== undefined && exactValue(old_value, expected[0]) && exactValue(new_value, expected[1]);
    });
    if (explicitOnly) {
      let canonicalDifferences = carrierDifferences;
      try {
        const canonical = await readCanonicalSources();
        canonicalSources = canonical;
        validateCarriers(canonical);
        await verifySourcesUnchanged(canonical, "2.0.0");
        canonicalDifferences = ARTIFACTS.flatMap((name) => differences(canonical[name].value, currentSources[name].value,
          `/${name.replace(/\.json$/u, "")}`));
      } catch (canonicalError) {
        return { schema_version: "controlled-contract-integration-prefix-compatibility.v1", outcome: "source_unavailable",
          sources: { old: bindSources(oldSources), current: bindSources(currentSources) },
          error: { code: canonicalError.code ?? "source_unavailable", details: {
            ...(canonicalError.details ?? {}), differences: carrierDifferences,
            canonical_differences: [], artifact_evidence: artifactEvidence(currentSources)
          } } };
      }
      return { schema_version: "controlled-contract-integration-prefix-compatibility.v1", outcome: "incompatible",
      sources: { old: bindSources(oldSources), current: bindSources(currentSources) }, differences: carrierDifferences,
      error: { code: error.code ?? "malformed_artifact", details: { diagnostics: error.details ?? {},
        differences: carrierDifferences, canonical_differences: boundDifferences(canonicalDifferences),
        artifact_evidence: artifactEvidence(currentSources, canonicalSources) } } };
    }
    return { schema_version: "controlled-contract-integration-prefix-compatibility.v1", outcome: "source_unavailable", error: { code: error.code ?? "malformed_artifact", details: error.details ?? {} } };
  }
  const old = Object.fromEntries(ARTIFACTS.map((name) => [name, oldSources[name].value]));
  const current = Object.fromEntries(ARTIFACTS.map((name) => [name, currentSources[name].value]));
  const allDifferences = ARTIFACTS.flatMap((name) => differences(old[name], current[name], `/${name.replace(/\.json$/u, "")}`));
  const classified = allDifferences.map((entry) => {
    const expected = MIGRATIONS[entry.pointer];
    const exact = expected !== undefined && exactValue(entry.old_value, expected[0]) &&
      exactValue(entry.new_value, expected[1]);
    return { ...entry, classification: exact ? MIGRATION_LABELS[entry.pointer] : "unmapped" };
  });
  const components = componentSummary(old["profile.json"], current["profile.json"], old["admission.json"], current["admission.json"],
    old["evaluation-input.template.json"], current["evaluation-input.template.json"], old["exact-binding.json"], current["exact-binding.json"],
    old["exact-binding-certification.json"], current["exact-binding-certification.json"]);
  try {
    catalog = await readCatalog();
    admission = await loadAdmission(PROFILE_ID);
    canonicalSources = await readCanonicalSources();
  } catch (error) { return { schema_version: "controlled-contract-integration-prefix-compatibility.v1", outcome: "source_unavailable", sources: { old: bindSources(oldSources), current: bindSources(currentSources) }, error: { code: error.code ?? "admission_unavailable", details: error.details ?? {} } }; }
  const catalogEntry = catalog.packs.find((entry) => entry.profile_id === PROFILE_ID);
  const canonicalDifferences = ARTIFACTS.flatMap((name) => differences(
    canonicalSources[name].value, currentSources[name].value, `/${name.replace(/\.json$/u, "")}`));
  let currentExact;
  try {
    currentExact = assertAdmittedCurrentBinding(catalogEntry, admission, currentSources, canonicalSources);
  } catch (error) {
    if (error.code === "proof_pack_admission_binding_mismatch" &&
        !exactValue(catalogEntry, admission.catalog_entry)) {
      try {
        const reobservedCatalog = await readCatalog();
        const reobservedAdmission = await loadAdmission(PROFILE_ID);
        const reobservedEntry = reobservedCatalog.packs.find((entry) => entry.profile_id === PROFILE_ID);
        if (exactValue(reobservedEntry, catalogEntry) &&
            exactValue(reobservedAdmission.catalog_entry, admission.catalog_entry)) {
          return { schema_version: "controlled-contract-integration-prefix-compatibility.v1", outcome: "incompatible",
            sources: { old: bindSources(oldSources), current: bindSources(currentSources) }, differences: classified,
            error: { code: error.code, details: { ...error.details, differences: classified,
              canonical_differences: boundDifferences(canonicalDifferences), stable_owner_divergence: true } } };
        }
      } catch (reobserveError) {
        return { schema_version: "controlled-contract-integration-prefix-compatibility.v1", outcome: "source_unavailable",
          sources: { old: bindSources(oldSources), current: bindSources(currentSources) }, differences: classified,
          error: { code: reobserveError.code ?? "source_unavailable", details: { ...(reobserveError.details ?? {}),
            differences: classified, canonical_differences: boundDifferences(canonicalDifferences) } } };
      }
      return { schema_version: "controlled-contract-integration-prefix-compatibility.v1", outcome: "source_unavailable",
        sources: { old: bindSources(oldSources), current: bindSources(currentSources) }, differences: classified,
        error: { code: "source_unavailable", details: { ...error.details, differences: classified,
          canonical_differences: boundDifferences(canonicalDifferences), owner_observation_moved: true } } };
    }
    const code = error.code ?? "source_unavailable";
    const outcome = code === "proof_pack_source_mismatch" || code === "proof_pack_admission_binding_mismatch"
      ? "incompatible" : "source_unavailable";
    return { schema_version: "controlled-contract-integration-prefix-compatibility.v1", outcome,
      sources: { old: bindSources(oldSources), current: bindSources(currentSources) }, differences: classified,
      error: { code, details: { ...error.details, differences: classified,
        canonical_differences: boundDifferences(canonicalDifferences),
        artifact_evidence: artifactEvidence(currentSources, canonicalSources) } } };
  }
  let historicalExact, canonicalHistoricalSources;
  try {
    canonicalHistoricalSources = await readBoundSources(path.join(ROOT, HISTORICAL_RELATIVE), "1.0.0");
    historicalExact = assertCanonicalHistoricalBinding(oldSources, canonicalHistoricalSources);
  } catch (error) {
    const code = error.code ?? "source_unavailable";
    return { schema_version: "controlled-contract-integration-prefix-compatibility.v1",
      outcome: code === "historical_source_binding_mismatch" ? "incompatible" : "source_unavailable",
      sources: { old: bindSources(oldSources), current: bindSources(currentSources) }, differences: classified,
      error: { code, details: { ...(error.details ?? {}), differences: classified,
        canonical_differences: boundDifferences(canonicalDifferences),
        artifact_evidence: artifactEvidence(oldSources, canonicalHistoricalSources, HISTORICAL_RELATIVE) } } };
  }
  const semanticEqual = Object.values(components).filter((value) => value?.equal !== undefined).every((value) => value.equal);
  const lossless = semanticEqual && classified.every(({ classification }) => classification !== "unmapped") &&
    classified.length > 0 && new Set(classified.map(({ pointer: p }) => p)).size === classified.length &&
    currentExact && historicalExact;
  try {
    await beforeFinalObservation({ catalog, admission, canonicalSources });
    await verifySourcesUnchanged(oldSources, "1.0.0");
    await verifySourcesUnchanged(currentSources, "2.0.0");
    const finalCatalog = await readCatalog();
    const finalAdmission = await loadAdmission(PROFILE_ID);
    const finalEntry = finalCatalog.packs.find((entry) => entry.profile_id === PROFILE_ID);
    if (!exactValue(finalEntry, catalogEntry) || !exactValue(finalAdmission.catalog_entry, admission.catalog_entry) ||
        !exactValue(finalAdmission.profile_digest, admission.profile_digest) ||
        !exactValue(finalAdmission.admission_digest, admission.admission_digest)) {
      throw new IntegrationPrefixCompatibilityError("source_unavailable",
        "catalog or admitted proof-pack source moved during comparison", {
          initial_catalog: catalogEntry, final_catalog: finalEntry,
          initial_admission_digest: admission.admission_digest,
          final_admission_digest: finalAdmission.admission_digest
        });
    }
    assertAdmittedCurrentBinding(finalEntry, finalAdmission, currentSources, canonicalSources);
  } catch (error) {
    const code = error.code ?? "source_unavailable";
    return { schema_version: "controlled-contract-integration-prefix-compatibility.v1", outcome: "source_unavailable",
      sources: { old: bindSources(oldSources), current: bindSources(currentSources) }, differences: classified,
      error: { code, details: { ...(error.details ?? {}), differences: classified,
        artifact_evidence: artifactEvidence(currentSources, canonicalSources) } } };
  }
  return {
    schema_version: "controlled-contract-integration-prefix-compatibility.v1",
    outcome: lossless ? "lossless_with_migration" : "incompatible",
    source_profile: canonicalValue({ profile_id: old["profile.json"].profile_id, profile_version: old["profile.json"].profile_version }),
    target_profile: canonicalValue({ profile_id: current["profile.json"].profile_id, profile_version: current["profile.json"].profile_version }),
    sources: { old: bindSources(oldSources), current: bindSources(currentSources) },
    differences: classified,
    comparison: components,
    migration: { total: classified.length, explicit: classified.filter(({ classification }) => classification !== "unmapped"), complete: classified.every(({ classification }) => classification !== "unmapped") },
    catalog: { admitted: Boolean(catalogEntry), entry: catalogEntry ?? null },
    admission: { observed: true, profile_digest: admission.profile_digest, version: admission.admission_version },
    profile_digests: { old: profileDigest(old["profile.json"]), current: profileDigest(current["profile.json"]) },
    canonical_result_digest: sha256(canonicalJsonBytes({ classified, components })),
    authoritative: false, route_compatible: false, proof_credit: false
  };
}

export {
  ARTIFACTS,
  IntegrationPrefixCompatibilityError,
  compareIntegrationPrefixCaptureCompatibility,
  compareIntegrationPrefixCaptureCompatibility as compareIntegrationPrefixCompatibility
};
