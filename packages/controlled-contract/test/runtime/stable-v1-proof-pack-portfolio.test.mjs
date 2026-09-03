import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { profileDigest } from "../../lib/verification-profile-v1.mjs";
import { executableDependencyClosure } from
  "../support/executable-dependency-closure.mjs";

const execute = promisify(execFile);
const packageRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const profilesRoot = path.join(packageRoot, "profiles");
const certificationRoot = path.join(packageRoot, "test/certification/profiles");
const generator = path.join(
  packageRoot, "test/support/build-admitted-proof-pack-catalog.mjs"
);
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expectedVersion = (id) => id === "proof.idempotency.effect-nonduplication"
  ? "3.0.0" : "2.0.0";

async function filesBelow(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(
      path.join(directory, entry.name), relative
    ));
    else output.push(relative);
  }
  return output.sort();
}

async function manifest(directory) {
  const files = await filesBelow(directory);
  return Promise.all(files.map(async (file) =>
    `${sha(await readFile(path.join(directory, file)))}  ${file}`));
}

async function copyGeneratorRepository(owner, name) {
  const isolatedRoot = path.join(owner, name);
  const isolatedPackage = path.join(isolatedRoot, "packages/controlled-contract");
  await mkdir(path.dirname(isolatedPackage), { recursive: true });
  await cp(packageRoot, isolatedPackage, { recursive: true });
  return {
    root: isolatedRoot,
    packageRoot: isolatedPackage,
    generator: path.join(
      isolatedPackage, "test/support/build-admitted-proof-pack-catalog.mjs"
    )
  };
}

async function assertGeneratorRefusesWithoutEffects(isolated, owner, name) {
  const destination = path.join(owner, name);
  await mkdir(destination);
  await assert.rejects(execute(process.execPath, [
    isolated.generator, "--destination", destination
  ]));
  assert.deepEqual(await readdir(destination), [], name);
}

function normalizedProfile(profile) {
  const value = structuredClone(profile);
  for (const field of ["schema_version", "profile_version", "contract_schema_version",
    "vocabulary_version", "vocabulary_signature_digest", "vocabulary_algebra_digest",
    "vocabulary_definitions_digest", "vocabulary_complete_digest"]) delete value[field];
  return value;
}

test("the current portfolio is one complete stable-v1 universe", async () => {
  const [runtimeCatalog, certificationCatalog, intentCatalog] = await Promise.all([
    readJson(path.join(profilesRoot, "catalog.json")),
    readJson(path.join(certificationRoot, "catalog.json")),
    readJson(path.join(packageRoot, "proof-intents/catalog.json"))
  ]);
  assert.deepEqual(certificationCatalog, runtimeCatalog);
  assert.equal(runtimeCatalog.packs.length, 38);
  assert.equal(new Set(runtimeCatalog.packs.map(({ profile_id: id }) => id)).size, 38);
  assert.equal(intentCatalog.intents.length, 38);
  assert.equal(intentCatalog.intents.reduce(
    (sum, intent) => sum + intent.capable_packs.length, 0), 40);
  const currentCatalogUniverse = JSON.stringify({
    runtime_profiles: runtimeCatalog,
    certification_profiles: certificationCatalog,
    proof_intents: intentCatalog
  });
  assert.doesNotMatch(currentCatalogUniverse,
    /(?:\bv0\.[234]\b|\bexperimental[ _-](?:carrier|schema)\b|\bcontrolled-[^"\s]*experimental[^"\s]*|\bcv\.experimental(?:\.|\b))/iu);
  const current = new Set(runtimeCatalog.packs.map(
    ({ profile_id: id, profile_version: version }) => `${id}@${version}`
  ));
  let exactTuples = 0;
  let exactControls = 0;
  const admissionVersions = { v1: 0, v2: 0 };
  for (const pack of runtimeCatalog.packs) {
    assert.equal(pack.profile_version, expectedVersion(pack.profile_id));
    const runtimeDirectory = path.join(profilesRoot, pack.profile_id, pack.profile_version);
    const certificationDirectory = path.join(
      certificationRoot, pack.profile_id, pack.profile_version
    );
    const [profile, certifiedProfile, admission, certifiedAdmission] = await Promise.all([
      readJson(path.join(runtimeDirectory, "profile.json")),
      readJson(path.join(certificationDirectory, "profile.json")),
      readJson(path.join(runtimeDirectory, "admission.json")),
      readJson(path.join(certificationDirectory, "admission.json"))
    ]);
    assert.deepEqual(certifiedProfile, profile);
    assert.deepEqual(certifiedAdmission, admission);
    assert.equal(profile.schema_version, "controlled-contract-verification-profile.v1");
    assert.equal(profile.contract_schema_version, "controlled-acceptance-contract.v1");
    assert.equal(profile.vocabulary_version, "controlled-contract-vocabulary.v1");
    assert.equal(admission.profile_digest, profileDigest(profile));
    if (admission.schema_version === "controlled-contract-admitted-proof-pack.v1") {
      admissionVersions.v1 += 1;
    } else if (admission.schema_version === "controlled-contract-admitted-proof-pack.v2") {
      admissionVersions.v2 += 1;
      assert.equal(Number.isInteger(admission.certification.negative_fixture_count), true);
      assert(admission.certification.negative_fixture_count >= 0);
    }
    if (pack.profile_id !== "proof.verification.test-validity") {
      const sourceVersion = pack.profile_version === "3.0.0" ? "2.0.0" : "1.0.0";
      const source = await readJson(path.join(
        profilesRoot, pack.profile_id, sourceVersion, "profile.json"
      ));
      assert.deepEqual(normalizedProfile(profile), normalizedProfile(source),
        `${pack.profile_id} unaccounted semantic delta`);
      const [sourceAdequacy, targetAdequacy] = await Promise.all([
        readJson(path.join(certificationRoot, pack.profile_id, sourceVersion, "adequacy.json")),
        readJson(path.join(certificationDirectory, "adequacy.json"))
      ]);
      assert.equal(targetAdequacy.guarantee, sourceAdequacy.guarantee);
      assert.deepEqual(targetAdequacy.explicit_exclusions,
        sourceAdequacy.explicit_exclusions);
    }
    if (admission.exact_binding) {
      exactTuples += 1;
      exactControls += admission.exact_binding.executable_control_count;
    }
  }
  assert.deepEqual([exactTuples, exactControls], [13, 236]);
  assert.deepEqual(admissionVersions, { v1: 25, v2: 13 });
  for (const intent of intentCatalog.intents) {
    for (const pack of intent.capable_packs) assert.ok(current.has(
      `${pack.profile_id}@${pack.profile_version}`
    ));
    assert.deepEqual(intent.compatibility.contract_schema_versions,
      ["controlled-acceptance-contract.v1"]);
    assert.deepEqual(intent.compatibility.vocabulary_versions,
      ["controlled-contract-vocabulary.v1"]);
  }
});
test("every executable exact-binding corpus reproduces its stable certification", async () => {
  const catalog = await readJson(path.join(profilesRoot, "catalog.json"));
  let tuples = 0;
  let passedControls = 0;
  for (const pack of catalog.packs) {
    const directory = path.join(certificationRoot, pack.profile_id, pack.profile_version);
    let certification;
    try { certification = await readJson(path.join(directory,
      "exact-binding-certification.json")); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    tuples += 1;
    passedControls += certification.result.passed_control_ids.length;
    assert.equal(certification.result.status, "passed");
    assert.deepEqual(certification.result.failed_control_ids, []);
    if (certification.corpus.executable_module) {
      const module = await import(pathToFileURL(path.resolve(
        packageRoot, "../..", certification.corpus.executable_module
      )));
      const result = await module.runExactBindingCertificationControls({
        certificationDirectory: directory
      });
      assert.deepEqual(result.failed_control_ids, []);
      assert.deepEqual(result.passed_control_ids,
        certification.result.passed_control_ids);
    }
  }
  assert.deepEqual([tuples, passedControls], [13, 236]);
});

test("current declarations name the complete neutral stable runtime closure", async () => {
  const forbidden = /(?:v0\.34|v034|experimental)/iu;
  const retiredOwners = new Set([
    "packages/controlled-contract/lib/native-contract-carrier.mjs",
    "packages/controlled-contract/lib/test-proof-contract.mjs",
    "packages/controlled-contract/lib/verification-profile.mjs"
  ]);
  const isForbidden = (dependencyPath) =>
    forbidden.test(dependencyPath) || retiredOwners.has(dependencyPath);
  const catalog = await readJson(path.join(profilesRoot, "catalog.json"));
  const generic = catalog.packs.filter(
    ({ profile_id: id }) => id !== "proof.verification.test-validity"
  );
  assert.equal(generic.length, 37);
  const stableRuntimeClosure = await executableDependencyClosure(
    repositoryRoot,
    "packages/controlled-contract/test/support/stable-v1-proof-pack-runtime.mjs"
  );
  let forbiddenDeclarations = 0;
  for (const pack of generic) {
    const adequacy = await readJson(path.join(
      certificationRoot, pack.profile_id, pack.profile_version, "adequacy.json"
    ));
    for (const {path: dependencyPath, sha256: digest} of
      adequacy.executable_dependency_digests) {
      assert.match(digest, /^[a-f0-9]{64}$/u, `${pack.profile_id}: ${dependencyPath}`);
    }
    forbiddenDeclarations += adequacy.executable_dependency_digests.filter(
      ({ path: dependencyPath }) =>
        isForbidden(dependencyPath)).length;
  }
  assert.equal(forbiddenDeclarations, 0);
  assert.deepEqual(stableRuntimeClosure.filter(({ path: dependencyPath }) =>
    isForbidden(dependencyPath)), []);
  for (const {path: dependencyPath} of stableRuntimeClosure) {
    assert.equal(await (await import("node:fs/promises")).stat(path.join(
      repositoryRoot, dependencyPath
    )).then((entry) => entry.isFile()), true, dependencyPath);
  }
});

test("full-corpus generation is atomic, refuses partial input, and is deterministic", async () => {
  const owner = await mkdtemp(path.join(os.tmpdir(), "wk2085-generator-test-"));
  try {
    const first = path.join(owner, "first");
    const second = path.join(owner, "second");
    const nonempty = path.join(owner, "nonempty");
    await Promise.all([
      import("node:fs/promises").then(({ mkdir }) => mkdir(first)),
      import("node:fs/promises").then(({ mkdir }) => mkdir(second)),
      import("node:fs/promises").then(({ mkdir }) => mkdir(nonempty))
    ]);
    await writeFile(path.join(nonempty, "sentinel"), "unchanged\n");
    await assert.rejects(execute(process.execPath, [generator, "--pack", "anything"]));
    await assert.rejects(execute(process.execPath, [generator]));
    await assert.rejects(execute(process.execPath,
      [generator, "--destination", nonempty]));
    assert.deepEqual(await readdir(nonempty), ["sentinel"]);
    await execute(process.execPath, [generator, "--destination", first]);
    await execute(process.execPath, [generator, "--destination", second]);
    assert.deepEqual(await manifest(first), await manifest(second));
  } finally {
    await rm(owner, { recursive: true, force: true });
  }
});

test("named invalid prospective states refuse before caller-visible effects", async () => {
  const owner = await mkdtemp(path.join(repositoryRoot, ".wk2085-generator-invalid-"));
  try {
    const isolated = await copyGeneratorRepository(owner, "repository");
    const runtimeCatalogPath = path.join(isolated.packageRoot, "profiles/catalog.json");
    const certificationCatalogPath = path.join(
      isolated.packageRoot, "test/certification/profiles/catalog.json"
    );
    const intentCatalogPath = path.join(isolated.packageRoot, "proof-intents/catalog.json");
    const originalRuntime = await readFile(runtimeCatalogPath);
    const originalCertification = await readFile(certificationCatalogPath);
    const originalIntent = await readFile(intentCatalogPath);
    const restoreCatalogs = async () => Promise.all([
      writeFile(runtimeCatalogPath, originalRuntime),
      writeFile(certificationCatalogPath, originalCertification),
      writeFile(intentCatalogPath, originalIntent)
    ]);

    for (const [name, mutate] of [
      ["partial", async () => {
        const catalog = JSON.parse(originalRuntime);
        catalog.packs.pop();
        const bytes = `${JSON.stringify(catalog, null, 2)}\n`;
        await Promise.all([
          writeFile(runtimeCatalogPath, bytes),
          writeFile(certificationCatalogPath, bytes)
        ]);
      }],
      ["duplicate", async () => {
        const catalog = JSON.parse(originalRuntime);
        catalog.packs.at(-1).profile_id = catalog.packs[0].profile_id;
        catalog.packs.at(-1).profile_version = catalog.packs[0].profile_version;
        const bytes = `${JSON.stringify(catalog, null, 2)}\n`;
        await Promise.all([
          writeFile(runtimeCatalogPath, bytes),
          writeFile(certificationCatalogPath, bytes)
        ]);
      }],
      ["unknown", async () => {
        const catalog = JSON.parse(originalRuntime);
        catalog.packs.at(-1).profile_id = "proof.unknown.fixture";
        const bytes = `${JSON.stringify(catalog, null, 2)}\n`;
        await Promise.all([
          writeFile(runtimeCatalogPath, bytes),
          writeFile(certificationCatalogPath, bytes)
        ]);
      }],
      ["mixed", async () => {
        const catalog = JSON.parse(originalIntent);
        catalog.intents[0].compatibility.contract_schema_versions = [
          "controlled-acceptance-contract.experimental.v0.3"
        ];
        await writeFile(intentCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
      }],
      ["invalid", async () => writeFile(runtimeCatalogPath, "{invalid\n")]
    ]) {
      await restoreCatalogs();
      await mutate();
      await assertGeneratorRefusesWithoutEffects(isolated, owner, `destination-${name}`);
    }

    await restoreCatalogs();
    const catalog = JSON.parse(originalRuntime);
    const first = catalog.packs[0];
    const adequacyPath = path.join(isolated.packageRoot,
      "test/certification/profiles", first.profile_id, first.profile_version,
      "adequacy.json");
    const adequacy = JSON.parse(await readFile(adequacyPath));
    adequacy.profile_digest = "0".repeat(64);
    await writeFile(adequacyPath, `${JSON.stringify(adequacy, null, 2)}\n`);
    await assertGeneratorRefusesWithoutEffects(isolated, owner, "destination-stale");

    await restoreCatalogs();
    await rm(path.join(isolated.packageRoot, first.path, "profile.json"));
    await assertGeneratorRefusesWithoutEffects(isolated, owner, "destination-missing");
  } finally {
    await rm(owner, { recursive: true, force: true });
  }
});

test("a deterministic 27th-pack failure leaves the caller destination empty", async () => {
  const owner = await mkdtemp(path.join(repositoryRoot, ".wk2085-generator-late-"));
  try {
    const isolated = await copyGeneratorRepository(owner, "repository");
    const catalog = await readJson(path.join(isolated.packageRoot, "profiles/catalog.json"));
    const pack = catalog.packs[26];
    const adequacy = await readJson(path.join(isolated.packageRoot,
      "test/certification/profiles", pack.profile_id, pack.profile_version,
      "adequacy.json"));
    await writeFile(path.join(isolated.root, adequacy.executable_module),
      "throw new Error(\"deterministic late-pack refusal\");\n");
    await assertGeneratorRefusesWithoutEffects(
      isolated, owner, "destination-late-pack"
    );
  } finally {
    await rm(owner, { recursive: true, force: true });
  }
});
