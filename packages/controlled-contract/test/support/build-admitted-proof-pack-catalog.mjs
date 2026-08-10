import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalDigest,
  runProofPackAdequacy
} from "./proof-pack-adequacy.mjs";
import {
  assertCanonicalCertificationFile
} from "../../lib/exact-binding-admission.mjs";
import {
  assertCanonicalDeclarationFile
} from "../../lib/exact-binding.mjs";
import { sha256 } from "../../lib/exact-binding-common.mjs";

const packageRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const certificationProfilesRoot = path.join(
  packageRoot, "test", "certification", "profiles"
);
const admittedProfilesRoot = path.join(packageRoot, "profiles");
const certificationCatalogPath = path.join(certificationProfilesRoot, "catalog.json");

async function candidateDirectories() {
  const candidates = [];
  for (const family of await readdir(certificationProfilesRoot, { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    const familyPath = path.join(certificationProfilesRoot, family.name);
    for (const version of await readdir(familyPath, { withFileTypes: true })) {
      if (!version.isDirectory()) continue;
      const directory = path.join(familyPath, version.name);
      try {
        await readFile(path.join(directory, "adequacy.json"));
        candidates.push(directory);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return candidates.sort();
}

async function buildAdmission(directory) {
  const [profileSource, evaluationInputTemplate, adequacy, result,
    exactDeclarationRead, exactCertificationRead] = await Promise.all([
    readFile(path.join(directory, "profile.json"), "utf8"),
    readFile(path.join(directory, "evaluation-input.template.json"), "utf8"),
    readFile(path.join(directory, "adequacy.json"), "utf8").then(JSON.parse),
    runProofPackAdequacy(directory, { variationMode: "full_census" }),
    readFile(path.join(directory, "exact-binding.json")).catch(
      (error) => error?.code === "ENOENT" ? null : Promise.reject(error)
    ),
    readFile(path.join(directory, "exact-binding-certification.json")).catch(
      (error) => error?.code === "ENOENT" ? null : Promise.reject(error)
    )
  ]);
  const profile = JSON.parse(profileSource);
  if (!result.passed || result.diagnostics.length > 0) throw new Error(
    `${profile.profile_id} failed release certification: ${JSON.stringify(result.diagnostics)}`
  );
  if (Boolean(exactDeclarationRead) !== Boolean(exactCertificationRead)) throw new Error(
    `${profile.profile_id} has an incomplete exact-binding admission tuple`
  );
  let exactBinding = null;
  if (exactDeclarationRead) {
    const declaration = assertCanonicalDeclarationFile(exactDeclarationRead);
    const certification = assertCanonicalCertificationFile(exactCertificationRead);
    if (declaration.profile_id !== profile.profile_id ||
        declaration.profile_version !== profile.profile_version ||
        declaration.profile_digest !== adequacy.profile_digest ||
        certification.profile_id !== profile.profile_id ||
        certification.profile_version !== profile.profile_version ||
        certification.profile_digest !== adequacy.profile_digest ||
        certification.exact_binding_declaration_digest !== sha256(exactDeclarationRead)) {
      throw new Error(`${profile.profile_id} exact-binding tuple is stale`);
    }
    exactBinding = {
      declaration_digest: sha256(exactDeclarationRead),
      certification_result_digest: sha256(exactCertificationRead),
      executable_control_count: certification.corpus.executable_control_count,
      binding_kinds: [...new Set(declaration.requirements.map(
        ({ binding_kind: kind }) => kind
      ))].sort(),
      relation_operators: [...new Set(declaration.relations.map(
        ({ operator }) => operator
      ))].sort(),
      corpus_id: certification.corpus.corpus_id,
      corpus_version: certification.corpus.corpus_version,
      corpus_digest: certification.corpus.corpus_digest,
      passed_control_ids: certification.result.passed_control_ids
    };
  }
  const admission = {
    schema_version: exactBinding
      ? "controlled-contract-admitted-proof-pack.v2"
      : "controlled-contract-admitted-proof-pack.v1",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: adequacy.profile_digest,
    guarantee: adequacy.guarantee,
    guarantee_digest: adequacy.guarantee_digest,
    explicit_exclusions: [...adequacy.explicit_exclusions].sort(),
    certification: {
      method: "executable_adequacy_full_negative_corpus",
      adequacy_declaration_digest: canonicalDigest(adequacy),
      adequacy_result_digest: canonicalDigest(result),
      executable_control_count: result.control_count,
      negative_fixture_count: result.negative_fixture_count,
      coverage_witness_count: result.coverage_witness_count
    },
    ...(exactBinding ? { exact_binding: exactBinding } : {})
  };
  const admittedDirectory = path.join(
    admittedProfilesRoot, profile.profile_id, profile.profile_version
  );
  await mkdir(admittedDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "admission.json"),
      `${JSON.stringify(admission, null, 2)}\n`),
    writeFile(path.join(admittedDirectory, "profile.json"), profileSource),
    writeFile(path.join(admittedDirectory, "admission.json"),
      `${JSON.stringify(admission, null, 2)}\n`),
    writeFile(path.join(admittedDirectory, "evaluation-input.template.json"),
      evaluationInputTemplate),
    ...(exactBinding ? [
      writeFile(path.join(admittedDirectory, "exact-binding.json"), exactDeclarationRead),
      writeFile(path.join(admittedDirectory, "exact-binding-certification.json"),
        exactCertificationRead)
    ] : [])
  ]);
  process.stdout.write(
    `${profile.profile_id}@${profile.profile_version}: ` +
      `${result.control_count} controls, ${result.negative_fixture_count} fixtures, ` +
      `${result.coverage_witness_count} witnesses\n`
  );
  return {
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    path: path.relative(packageRoot, admittedDirectory).replaceAll("\\", "/")
  };
}

const packs = [];
for (const directory of await candidateDirectories()) {
  packs.push(await buildAdmission(directory));
}
packs.sort((left, right) => left.profile_id < right.profile_id ? -1 : 1);
const catalogSource = `${JSON.stringify({
  schema_version: "controlled-contract-proof-pack-catalog.v1",
  packs
}, null, 2)}\n`;
await Promise.all([
  writeFile(path.join(admittedProfilesRoot, "catalog.json"), catalogSource),
  writeFile(certificationCatalogPath, catalogSource)
]);
