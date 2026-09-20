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
  loadProofPack,
  runProofPackAdequacy
} from "./proof-pack-adequacy.mjs";
import { profileDigest } from "./stable-v1-proof-pack-runtime.mjs";
import {
  assertComponentExclusionApplicability,
  rebindComponentExclusionApplicability
} from "../../lib/admitted-proof-packs.mjs";
import { sha256 } from "../../lib/deterministic-projection-primitives.mjs";
import { executableDependencyClosure } from "./executable-dependency-closure.mjs";

const packageRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const profilesRoot = path.join(packageRoot, "profiles");
const certificationRoot = path.join(packageRoot, "test/certification/profiles");
const intentCatalogPath = path.join(packageRoot, "proof-intents/catalog.json");
import { runTestValidityCertification } from "./test-validity-certification.mjs";

const TEST_VALIDITY_ID = "proof.verification.test-validity";
const COMPONENT_EXCLUSION_APPLICABILITY = "component-exclusion-applicability.json";

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
import { exactProofEvaluatorIdentities } from "../../lib/proof-evaluator-registry.mjs";
import { validatePackParameterContract } from "../../lib/pack-parameter-contract.mjs";
const currentCatalog = await readJson(path.join(profilesRoot, "catalog.json"));
const expectedVersion = id => {
  const entry = currentCatalog.packs.find(pack => pack.profile_id === id);
  if (!entry) throw new Error(`unknown current catalog identity ${id}`);
  return entry.profile_version;
};
for (const identity of exactProofEvaluatorIdentities()) {
  if (!currentCatalog.packs.some(pack => keyOf(pack) === keyOf(identity))) {
    throw new Error(`Evaluator identity is outside the current catalog: ${keyOf(identity)}`);
  }
}

function assertCatalogs(profileCatalog, certificationCatalog, intentCatalog) {
  if (profileCatalog.schema_version !== "controlled-contract-proof-pack-catalog.v1" ||
      certificationCatalog.schema_version !== profileCatalog.schema_version ||
      JSON.stringify(certificationCatalog) !== JSON.stringify(profileCatalog) ||
      profileCatalog.packs.length === 0) throw new Error(
    "stable portfolio requires identical 37-pack runtime and certification catalogs"
  );
  const keys = profileCatalog.packs.map(keyOf);
  if (new Set(keys).size !== keys.length ||
      profileCatalog.packs.some((pack) => pack.profile_version !==
        expectedVersion(pack.profile_id))) throw new Error(
    "stable portfolio has a duplicate, unknown, or stale profile identity"
  );
  if (intentCatalog.schema_version !== "controlled-contract-proof-intent-catalog.v2" ||
      intentCatalog.intents.length === 0) {
    throw new Error("stable intent catalog requires exactly 37 intents and 39 edges");
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

function admissionFor(profile, adequacy, result, parameterContract) {
  if (profile.schema_version !== "controlled-contract-verification-profile.v2" ||
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
    schema_version: "controlled-contract-admitted-proof-pack.v3",
    parameter_contract_digest: canonicalDigest(parameterContract),
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
    }
  };
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

export async function generatePack(destination, pack, { preflight = false } = {}) {
  process.stderr.write(`${preflight ? "Preparing" : "Certifying"} ${keyOf(pack)}\n`);
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
  adequacy = await refreshExecutableDigests(adequacy);
  await writeFile(path.join(certificationOutput, "adequacy.json"), jsonBytes(adequacy));
  if (preflight) {
    if (pack.profile_id !== TEST_VALIDITY_ID) await loadProofPack(certificationOutput);
    return;
  }
  const result = pack.profile_id === TEST_VALIDITY_ID
    ? runTestValidityCertification(profile, adequacy,
      await readJson(path.join(certificationOutput, "corpus.json")))
    : await runProofPackAdequacy(certificationOutput, { variationMode: "full_census" });
  await writeFile(path.join(certificationOutput,
    "certification-result.full-census.json"), jsonBytes(result));
  if (pack.profile_id === TEST_VALIDITY_ID) await writeFile(
    path.join(certificationOutput, "result.json"), jsonBytes(result));

  const parameterContract = validatePackParameterContract(
    await readJson(path.join(runtimeDirectory, "parameter-contract.json")), profile);
  const admission = admissionFor(profile, adequacy, result, parameterContract);
  await Promise.all([
    writeFile(path.join(runtimeOutput, "admission.json"), jsonBytes(admission)),
    writeFile(path.join(certificationOutput, "admission.json"), jsonBytes(admission))
  ]);

  const companionPath = path.join(runtimeOutput, COMPONENT_EXCLUSION_APPLICABILITY);
  const companion = await readJson(companionPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (companion !== null) {
    const rebound = rebindComponentExclusionApplicability(companion, profile, admission);
    await writeFile(companionPath, jsonBytes(rebound));

    assertComponentExclusionApplicability(rebound, profile, admission);
  }
  process.stderr.write(`Certified ${keyOf(pack)}: ${result.control_count} controls, ${result.negative_fixture_count} negatives, ${result.coverage_witness_count} witnesses\n`);
  return { pack, admission };
}

async function generateProspectiveCorpus(staging) {
  const [profileCatalog, certificationCatalog, intentCatalog] = await Promise.all([
    readJson(path.join(profilesRoot, "catalog.json")),
    readJson(path.join(certificationRoot, "catalog.json")),
    readJson(intentCatalogPath)
  ]);
  assertCatalogs(profileCatalog, certificationCatalog, intentCatalog);
  const population = profileCatalog.packs;
  for (const pack of population) await generatePack(staging, pack, { preflight: true });
  const prospective = [];
  for (const pack of population) {
    prospective.push(await generatePack(staging, pack));
  }
  const validity = prospective.find(
    ({ pack }) => pack.profile_id === TEST_VALIDITY_ID
  )?.admission;
  if (!validity || validity.certification.executable_control_count !== 10 ||
      validity.certification.negative_fixture_count !== 9 ||
      validity.certification.coverage_witness_count !== 9) throw new Error(
    "Current test-validity admission must record exactly 10/9/9"
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
  return { profiles: prospective.length, intents: intentCatalog.intents.length,
    edges: intentCatalog.intents.reduce((sum, intent) => sum + intent.capable_packs.length, 0) };
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

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const destination = destinationArgument(process.argv.slice(2));
  const result = await generateAndPublish(destination);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
