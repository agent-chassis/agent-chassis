import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ExactBindingError,
  assertSchema,
  canonicalDigest,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  sha256,
  sortedUnique
} from "./exact-binding-common.mjs";
import { assertCanonicalDeclarationFile } from "./exact-binding.mjs";
import { profileDigestV034 } from "./verification-profile-v034.mjs";

function parseJson(raw, code, label) {
  try {
    return JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (error) {
    throw new ExactBindingError(code, `${label} is not valid JSON`, {
      cause: error.message
    });
  }
}

function assertCanonicalCertificationFile(rawBytes) {
  const certification = parseJson(
    rawBytes,
    "exact_binding_certification_json_invalid",
    "exact-binding certification"
  );
  if (!Buffer.from(rawBytes).equals(canonicalJsonBytes(certification, { file: true }))) {
    throw new ExactBindingError(
      "exact_binding_certification_noncanonical",
      "certification bytes must be canonical JSON plus exactly one LF"
    );
  }
  assertSchema(
    "controlled-contract-exact-binding-certification-result.v1.schema.json",
    certification,
    "exact_binding_certification_schema_invalid"
  );
  const passed = certification.result.passed_control_ids;
  if (!sortedUnique(passed) ||
      passed.length !== certification.corpus.executable_control_count) {
    throw new ExactBindingError(
      "exact_binding_certification_population_invalid",
      "passed controls must be sorted, unique, and equal the executable count"
    );
  }
  return deepFreeze(certification);
}

function mismatch(field, expected, actual) {
  if (expected === actual) return null;
  return { field, expected, actual };
}

async function loadExactBindingAdmissionV1(packDirectory, expectedProfileId, {
  rawFiles = null
} = {}) {
  if (typeof packDirectory !== "string" || path.resolve(packDirectory) !== packDirectory) {
    throw new ExactBindingError(
      "exact_binding_pack_directory_invalid",
      "trusted pack directory must be an absolute path"
    );
  }
  const names = [
    "profile.json", "admission.json", "exact-binding.json",
    "exact-binding-certification.json"
  ];
  let raw = rawFiles;
  try {
    if (raw === null) raw = await Promise.all(
      names.map((name) => readFile(path.join(packDirectory, name)))
    );
    if (!Array.isArray(raw) || raw.length !== names.length ||
        raw.some((value) => !Buffer.isBuffer(value))) throw new Error(
      "captured pack tuple is incomplete"
    );
  } catch (error) {
    throw new ExactBindingError(
      "exact_binding_admitted_carrier_missing",
      "the admitted profile/declaration/certification tuple is incomplete",
      { cause_code: error?.code ?? "unknown" }
    );
  }
  const profile = parseJson(raw[0], "exact_binding_profile_json_invalid", "profile");
  const admission = parseJson(raw[1], "exact_binding_admission_json_invalid", "admission");
  assertSchema(
    "controlled-contract-admitted-proof-pack.v2.schema.json",
    admission,
    "exact_binding_admission_schema_invalid"
  );
  const declaration = assertCanonicalDeclarationFile(raw[2]);
  const certification = assertCanonicalCertificationFile(raw[3]);
  const profileDigest = profileDigestV034(profile);
  const declarationDigest = sha256(raw[2]);
  const certificationDigest = sha256(raw[3]);
  const exact = admission.exact_binding;
  const declaredKinds = [...new Set(declaration.requirements.map(
    ({ binding_kind: kind }) => kind
  ))].sort(compareCodeUnits);
  const declaredOperators = [...new Set(declaration.relations.map(
    ({ operator }) => operator
  ))].sort(compareCodeUnits);
  const mismatches = [
    mismatch("expected.profile_id", expectedProfileId, profile.profile_id),
    mismatch("admission.profile_id", profile.profile_id, admission.profile_id),
    mismatch("admission.profile_version", profile.profile_version, admission.profile_version),
    mismatch("admission.profile_digest", profileDigest, admission.profile_digest),
    mismatch("admission.guarantee_digest", sha256(admission.guarantee),
      admission.guarantee_digest),
    mismatch("declaration.profile_id", profile.profile_id, declaration.profile_id),
    mismatch("declaration.profile_version", profile.profile_version,
      declaration.profile_version),
    mismatch("declaration.profile_digest", profileDigest, declaration.profile_digest),
    mismatch("admission.exact_binding.declaration_digest", declarationDigest,
      exact.declaration_digest),
    mismatch("admission.exact_binding.certification_result_digest", certificationDigest,
      exact.certification_result_digest),
    mismatch("certification.profile_id", profile.profile_id, certification.profile_id),
    mismatch("certification.profile_version", profile.profile_version,
      certification.profile_version),
    mismatch("certification.profile_digest", profileDigest, certification.profile_digest),
    mismatch("certification.exact_binding_declaration_digest", declarationDigest,
      certification.exact_binding_declaration_digest),
    mismatch("certification.corpus.corpus_id", exact.corpus_id,
      certification.corpus.corpus_id),
    mismatch("certification.corpus.corpus_version", exact.corpus_version,
      certification.corpus.corpus_version),
    mismatch("certification.corpus.corpus_digest", exact.corpus_digest,
      certification.corpus.corpus_digest),
    mismatch("certification.corpus.executable_control_count", exact.executable_control_count,
      certification.corpus.executable_control_count),
    mismatch("certification.result.passed_control_ids",
      JSON.stringify(exact.passed_control_ids),
      JSON.stringify(certification.result.passed_control_ids)),
    mismatch("admission.exact_binding.binding_kinds", JSON.stringify(declaredKinds),
      JSON.stringify(exact.binding_kinds)),
    mismatch("admission.exact_binding.relation_operators",
      JSON.stringify(declaredOperators), JSON.stringify(exact.relation_operators))
  ].filter(Boolean);
  if (!sortedUnique(exact.binding_kinds) ||
      (exact.relation_operators.length > 0 && !sortedUnique(exact.relation_operators)) ||
      !sortedUnique(exact.passed_control_ids)) {
    mismatches.push({ field: "admission.exact_binding.canonical_order" });
  }
  if (mismatches.length > 0) throw new ExactBindingError(
    "exact_binding_admission_binding_mismatch",
    "profile, admission, declaration, and certification do not identify one tuple",
    { mismatches }
  );
  return deepFreeze({
    profile: structuredClone(profile),
    admission: structuredClone(admission),
    declaration,
    certification,
    profile_digest: profileDigest,
    admission_digest: canonicalDigest(admission),
    exact_binding_declaration_digest: declarationDigest,
    exact_binding_certification_digest: certificationDigest
  });
}

export {
  assertCanonicalCertificationFile,
  loadExactBindingAdmissionV1
};
