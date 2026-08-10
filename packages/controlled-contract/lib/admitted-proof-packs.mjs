import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { profileDigestV034 } from "./verification-profile-v034.mjs";
import { loadExactBindingAdmissionV1 } from "./exact-binding-admission.mjs";

const packageRoot = new URL("../", import.meta.url);
const catalogUrl = new URL("profiles/catalog.json", packageRoot);
const [catalogSchema, admissionSchema, admissionSchemaV2] = await Promise.all([
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
  ))
]);
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateCatalog = ajv.compile(catalogSchema);
const validateAdmission = ajv.compile(admissionSchema);
const validateAdmissionV2 = ajv.compile(admissionSchemaV2);
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
    "exact-binding-certification.json"
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
        )
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
      admission_version: 2
    });
    ADMITTED_PACK_SNAPSHOTS.add(result);
    return result;
  }
  if (!validateAdmission(admission)) throw new AdmittedProofPackError(
    "proof_pack_admission_invalid",
    "the shipped proof-pack admission is schema-invalid",
    { profile_id: profileId, diagnostics: structuredClone(validateAdmission.errors) }
  );
  const actualProfileDigest = profileDigestV034(profile);
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
  const result = deepFreeze({
    profile: structuredClone(profile),
    admission: structuredClone(admission),
    profile_digest: actualProfileDigest,
    admission_digest: canonicalDigest(admission),
    catalog_entry: structuredClone(entry),
    admission_version: 1
  });
  ADMITTED_PACK_SNAPSHOTS.add(result);
  return result;
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
  loadAdmittedProofPack,
  readProofPackCatalog
};
