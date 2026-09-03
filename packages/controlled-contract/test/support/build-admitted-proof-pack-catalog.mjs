import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalDigest,
  runProofPackAdequacy
} from "./proof-pack-adequacy.mjs";
import { profileDigest } from "./stable-v1-proof-pack-runtime.mjs";
import { sha256 } from "../../lib/exact-binding-common.mjs";
import { executableDependencyClosure } from "./executable-dependency-closure.mjs";

const packageRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const profilesRoot = path.join(packageRoot, "profiles");
const certificationRoot = path.join(packageRoot, "test/certification/profiles");
const intentCatalogPath = path.join(packageRoot, "proof-intents/catalog.json");
const TEST_VALIDITY_ID = "proof.verification.test-validity";

function destinationArgument(argv) {
  if (argv.length !== 2 || argv[0] !== "--destination" || !argv[1] ||
      argv[1].startsWith("--")) throw new Error(
    "usage: build-admitted-proof-pack-catalog.mjs --destination <empty-directory>"
  );
  return path.resolve(argv[1]);
}

async function requireEmptyDirectory(directory) {
  const metadata = await stat(directory).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(
      "generation destination must already exist and be empty"
    );
    throw error;
  });
  if (!metadata.isDirectory() || (await readdir(directory)).length !== 0) throw new Error(
    "generation destination must already exist and be empty"
  );
}

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;
const keyOf = ({ profile_id: id, profile_version: version }) => `${id}@${version}`;
const expectedVersion = (id) => id === "proof.idempotency.effect-nonduplication"
  ? "3.0.0" : "2.0.0";

function assertCatalogs(profileCatalog, certificationCatalog, intentCatalog) {
  if (profileCatalog.schema_version !== "controlled-contract-proof-pack-catalog.v1" ||
      certificationCatalog.schema_version !== profileCatalog.schema_version ||
      JSON.stringify(certificationCatalog) !== JSON.stringify(profileCatalog) ||
      profileCatalog.packs.length !== 38) throw new Error(
    "stable portfolio requires identical 38-pack runtime and certification catalogs"
  );
  const keys = profileCatalog.packs.map(keyOf);
  if (new Set(keys).size !== 38 ||
      profileCatalog.packs.some((pack) => pack.profile_version !==
        expectedVersion(pack.profile_id))) throw new Error(
    "stable portfolio has a duplicate, unknown, or stale profile identity"
  );
  if (intentCatalog.schema_version !== "controlled-contract-proof-intent-catalog.v1" ||
      intentCatalog.intents.length !== 38 ||
      intentCatalog.intents.reduce((sum, intent) => sum + intent.capable_packs.length, 0) !== 40) {
    throw new Error("stable intent catalog requires exactly 38 intents and 40 edges");
  }
  const known = new Set(keys);
  for (const intent of intentCatalog.intents) {
    for (const pack of intent.capable_packs) if (!known.has(keyOf(pack))) throw new Error(
      `stable intent ${intent.intent_id} selects an unknown or stale pack`
    );
    if (!intent.compatibility.contract_schema_versions.every(
      (value) => value === "controlled-acceptance-contract.v1") ||
        !intent.compatibility.vocabulary_versions.every(
          (value) => value === "controlled-contract-vocabulary.v1")) throw new Error(
      `stable intent ${intent.intent_id} retains an experimental compatibility family`
    );
  }
}

async function exactBindingAdmission(
  declarationBytes,
  certificationBytes,
  certificationDirectory
) {
  if (!declarationBytes && !certificationBytes) return null;
  if (!declarationBytes || !certificationBytes) throw new Error(
    "incomplete exact-binding admission tuple"
  );
  const declaration = JSON.parse(declarationBytes);
  const certification = JSON.parse(certificationBytes);
  if (certification.result.status !== "passed" ||
      certification.result.failed_control_ids.length !== 0 ||
      certification.result.passed_control_ids.length !==
        certification.corpus.executable_control_count ||
      certification.exact_binding_declaration_digest !== sha256(declarationBytes)) throw new Error(
    `${declaration.profile_id} has a stale exact-binding certification`
  );
  if (certification.corpus.executable_module) {
    const modulePath = path.resolve(
      repositoryRoot, certification.corpus.executable_module
    );
    const moduleBytes = await readFile(modulePath);
    if (sha256(moduleBytes) !== certification.corpus.executable_module_digest) {
      throw new Error(`${declaration.profile_id} exact-binding executable corpus is stale`);
    }
    const executable = await import(pathToFileURL(modulePath));
    if (typeof executable.runExactBindingCertificationControls !== "function") {
      throw new Error(`${declaration.profile_id} exact-binding corpus has no runner`);
    }
    const executed = await executable.runExactBindingCertificationControls({
      certificationDirectory
    });
    if (executed.failed_control_ids.length > 0 ||
        JSON.stringify(executed.passed_control_ids) !==
          JSON.stringify(certification.result.passed_control_ids)) throw new Error(
      `${declaration.profile_id} exact-binding executable controls failed`
    );
  }
  return {
    declaration_digest: sha256(declarationBytes),
    certification_result_digest: sha256(certificationBytes),
    executable_control_count: certification.corpus.executable_control_count,
    binding_kinds: [...new Set(declaration.requirements.map(
      ({ binding_kind: kind }) => kind))].sort(),
    relation_operators: [...new Set(declaration.relations.map(
      ({ operator }) => operator))].sort(),
    corpus_id: certification.corpus.corpus_id,
    corpus_version: certification.corpus.corpus_version,
    corpus_digest: certification.corpus.corpus_digest,
    passed_control_ids: certification.result.passed_control_ids
  };
}

function admissionFor(profile, adequacy, result, exactBinding) {
  if (profile.schema_version !== "controlled-contract-verification-profile.v1" ||
      profile.contract_schema_version !== "controlled-acceptance-contract.v1" ||
      profile.vocabulary_version !== "controlled-contract-vocabulary.v1" ||
      profile.profile_version !== expectedVersion(profile.profile_id) ||
      adequacy.profile_digest !== profileDigest(profile) ||
      !result.passed || result.diagnostics?.length > 0) throw new Error(
    `${profile.profile_id} has a stale or failed stable certification`
  );
  const negativeFixtureCount = result.negative_fixture_count;
  if (!Number.isInteger(negativeFixtureCount) || negativeFixtureCount < 0) throw new Error(
    `${profile.profile_id} certification has an invalid negative fixture count`
  );
  return {
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
      method: negativeFixtureCount === 0 &&
        result.coverage_witness_count === 0
        ? "executable_semantic_adequacy"
        : "executable_adequacy_full_negative_corpus",
      adequacy_declaration_digest: canonicalDigest(adequacy),
      adequacy_result_digest: canonicalDigest(result),
      executable_control_count: result.control_count,
      negative_fixture_count: negativeFixtureCount,
      coverage_witness_count: result.coverage_witness_count
    },
    ...(exactBinding ? { exact_binding: exactBinding } : {})
  };
}

async function optionalBytes(file) {
  return readFile(file).catch((error) => error?.code === "ENOENT"
    ? null : Promise.reject(error));
}

async function refreshExecutableDigests(adequacy) {
  if (!adequacy.executable_module) return adequacy;
  const executableModuleDigest = sha256(await readFile(path.resolve(
    repositoryRoot, adequacy.executable_module
  )));
  const executableDependencyDigests = await executableDependencyClosure(
    repositoryRoot,
    adequacy.executable_module
  );
  return {
    ...adequacy,
    executable_module_digest: executableModuleDigest,
    executable_dependency_digests: executableDependencyDigests
  };
}

async function generatePack(destination, pack) {
  const runtimeDirectory = path.join(profilesRoot, pack.profile_id, pack.profile_version);
  const certificationDirectory = path.join(
    certificationRoot, pack.profile_id, pack.profile_version
  );
  const runtimeOutput = path.join(destination, pack.path);
  const certificationOutput = path.join(destination, "test/certification/profiles",
    pack.profile_id, pack.profile_version);
  const [runtimeProfile, certificationProfile] = await Promise.all([
    readJson(path.join(runtimeDirectory, "profile.json")),
    readJson(path.join(certificationDirectory, "profile.json"))
  ]);
  if (JSON.stringify(runtimeProfile) !== JSON.stringify(certificationProfile) ||
      certificationProfile.profile_id !== pack.profile_id ||
      certificationProfile.profile_version !== pack.profile_version) throw new Error(
    `${keyOf(pack)} runtime/certification profile identity mismatch`
  );
  await Promise.all([
    cp(runtimeDirectory, runtimeOutput, { recursive: true }),
    cp(certificationDirectory, certificationOutput, { recursive: true })
  ]);
  const profile = await readJson(path.join(certificationOutput, "profile.json"));
  let adequacy = await readJson(path.join(certificationOutput, "adequacy.json"));
  let result;
  if (pack.profile_id === TEST_VALIDITY_ID) {
    result = await readJson(path.join(
      certificationOutput, "certification-result.full-census.json"
    ));
  } else {
    adequacy = await refreshExecutableDigests(adequacy);
    await writeFile(path.join(certificationOutput, "adequacy.json"), jsonBytes(adequacy));
    result = await runProofPackAdequacy(certificationOutput, {
      variationMode: "full_census"
    });
    await writeFile(path.join(certificationOutput,
      "certification-result.full-census.json"), jsonBytes(result));
  }
  const [declarationBytes, certificationBytes] = await Promise.all([
    optionalBytes(path.join(certificationOutput, "exact-binding.json")),
    optionalBytes(path.join(certificationOutput, "exact-binding-certification.json"))
  ]);
  const exactBinding = await exactBindingAdmission(
    declarationBytes,
    certificationBytes,
    certificationOutput
  );
  const admission = admissionFor(profile, adequacy, result, exactBinding);
  await Promise.all([
    writeFile(path.join(runtimeOutput, "admission.json"), jsonBytes(admission)),
    writeFile(path.join(certificationOutput, "admission.json"), jsonBytes(admission))
  ]);
  return { pack, admission };
}

async function generateProspectiveCorpus(staging) {
  const [profileCatalog, certificationCatalog, intentCatalog] = await Promise.all([
    readJson(path.join(profilesRoot, "catalog.json")),
    readJson(path.join(certificationRoot, "catalog.json")),
    readJson(intentCatalogPath)
  ]);
  assertCatalogs(profileCatalog, certificationCatalog, intentCatalog);
  const prospective = [];
  for (const pack of profileCatalog.packs) {
    prospective.push(await generatePack(staging, pack));
  }
  if (prospective.filter(({ admission }) => admission.exact_binding).length !== 13 ||
      prospective.reduce((sum, { admission }) =>
        sum + (admission.exact_binding?.executable_control_count ?? 0), 0) !== 236) throw new Error(
    "stable portfolio exact-binding population is incomplete"
  );
  const validity = prospective.find(
    ({ pack }) => pack.profile_id === TEST_VALIDITY_ID
  )?.admission;
  if (!validity || validity.certification.executable_control_count !== 38 ||
      validity.certification.negative_fixture_count !== 37 ||
      validity.certification.coverage_witness_count !== 37) throw new Error(
    "stable test-validity admission must record exactly 38/37/37"
  );

  await Promise.all([
    mkdir(path.join(staging, "proof-intents"), { recursive: true }),
    mkdir(path.join(staging, "test/certification/profiles"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(staging, "profiles/catalog.json"), jsonBytes(profileCatalog)),
    writeFile(path.join(staging, "test/certification/profiles/catalog.json"),
      jsonBytes(certificationCatalog)),
    writeFile(path.join(staging, "proof-intents/catalog.json"), jsonBytes(intentCatalog))
  ]);
  return { profiles: prospective.length, intents: 38, edges: 40,
    exact_binding_tuples: 13, exact_binding_controls: 236 };
}

async function generateAndPublish(destination) {
  await requireEmptyDirectory(destination);
  const stagingOwner = await mkdtemp(path.join(os.tmpdir(), "stable-proof-corpus-"));
  const staging = path.join(stagingOwner, "corpus");
  let result;
  let primaryError = null;
  try {
    await mkdir(staging);
    result = await generateProspectiveCorpus(staging);
    await cp(staging, destination, { recursive: true });
  } catch (error) {
    primaryError = error;
  }
  let cleanupError = null;
  try {
    await rm(stagingOwner, { recursive: true });
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError) {
    if (cleanupError && primaryError.cause === undefined) primaryError.cause = cleanupError;
    throw primaryError;
  }
  if (cleanupError) throw cleanupError;
  return result;
}

const destination = destinationArgument(process.argv.slice(2));
const result = await generateAndPublish(destination);
process.stdout.write(`${JSON.stringify(result)}\n`);
