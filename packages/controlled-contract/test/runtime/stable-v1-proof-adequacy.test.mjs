import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runProofPackAdequacy, canonicalDigest } from "../support/proof-pack-adequacy.mjs";
import { runTestValidityCertification } from "../support/test-validity-certification.mjs";
import { profileDigest } from "../../lib/profile-digest.mjs";
import { executableDependencyClosure } from "../support/executable-dependency-closure.mjs";
import { assertComponentExclusionApplicability, loadExactAdmittedProofPack } from
  "../../lib/admitted-proof-packs.mjs";

const packageRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const catalog = await readJson(path.join(packageRoot, "profiles/catalog.json"));
const current = [...catalog.packs];
const execFileAsync = promisify(execFile);
const certificationDirectory = (pack) => path.join(packageRoot,
  "test/certification/profiles", pack.profile_id, pack.profile_version);

test("all current definitions execute their complete certification populations", async () => {
  assert.ok(current.length > 0);
  assert.equal(new Set(current.map((p) => `${p.profile_id}@${p.profile_version}`)).size,
    current.length);
  for (const pack of current) {
    const directory = certificationDirectory(pack);
    const [profile, adequacy, certified] = await Promise.all([
      readJson(path.join(directory, "profile.json")),
      readJson(path.join(directory, "adequacy.json")),
      readJson(path.join(directory, "certification-result.full-census.json"))
    ]);
    const actual = pack.profile_id === "proof.verification.test-validity"
      ? runTestValidityCertification(profile, adequacy,
        await readJson(path.join(directory, "corpus.json")))
      : await runProofPackAdequacy(directory, { variationMode: "full_census" });
    assert.equal(actual.passed, true, `${pack.profile_id}: ${JSON.stringify(actual.diagnostics)}`);
    assert.deepEqual(actual, certified, `${pack.profile_id} certification drift`);
  }
});

test("current publication binds source-clean evaluator bytes to complete certification",
  async (t) => {
  const generator = await import("../support/build-admitted-proof-pack-catalog.mjs");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "wk2568-current-publication-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const entryProbe = path.join(temporary, "entry-probe");
  await mkdir(entryProbe);
  const testValidity = current.find(
    ({ profile_id: profileId }) => profileId === "proof.verification.test-validity"
  );
  assert.ok(testValidity, "the catalog must select a current test-validity definition");
  await generator.generatePack(entryProbe, testValidity, { preflight: true });

  const generatedRoot = path.join(temporary, "published");
  await mkdir(generatedRoot);
  const generatorPath = path.join(packageRoot,
    "test/support/build-admitted-proof-pack-catalog.mjs");
  const { stdout } = await execFileAsync(process.execPath, [
    generatorPath, "--destination", generatedRoot
  ], { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 });
  const publication = JSON.parse(stdout);
  assert.equal(publication.profiles, current.length);
  assert.deepEqual(await readJson(path.join(packageRoot,
    "test/certification/profiles/catalog.json")), catalog);
  assert.deepEqual(await readJson(path.join(generatedRoot,
    "test/certification/profiles/catalog.json")), catalog);
  const totals = { definitions: 0, controls: 0, negatives: 0, witnesses: 0 };
  for (const pack of current) {
    const runtime = path.join(packageRoot, pack.path);
    const certification = certificationDirectory(pack);
    const generatedRuntime = path.join(generatedRoot, pack.path);
    const generatedCertification = path.join(generatedRoot,
      "test/certification/profiles", pack.profile_id, pack.profile_version);
    for (const name of [
      "profile.json", "admission.json", "evaluation-input.template.json", "parameter-contract.json"
    ]) {
      assert.equal(await readFile(path.join(runtime, name), "utf8"),
        await readFile(path.join(certification, name), "utf8"), `${pack.profile_id}/${name}`);
      assert.equal(await readFile(path.join(generatedRuntime, name), "utf8"),
        await readFile(path.join(runtime, name), "utf8"), `${pack.profile_id}/generated/${name}`);
    }
    for (const name of ["adequacy.json", "certification-result.full-census.json"]) {
      assert.equal(await readFile(path.join(generatedCertification, name), "utf8"),
        await readFile(path.join(certification, name), "utf8"),
        `${pack.profile_id}/generated/${name}`);
    }
    const [profile, admission, adequacy, result] = await Promise.all([
      readJson(path.join(runtime, "profile.json")),
      readJson(path.join(runtime, "admission.json")),
      readJson(path.join(certification, "adequacy.json")),
      readJson(path.join(certification, "certification-result.full-census.json"))
    ]);
    assert.equal(profile.schema_version, "controlled-contract-verification-profile.v2");
    assert.equal(admission.profile_digest, profileDigest(profile));
    assert.equal(adequacy.profile_digest, admission.profile_digest);
    assert.equal(admission.certification.adequacy_declaration_digest, canonicalDigest(adequacy));
    assert.equal(admission.certification.adequacy_result_digest, canonicalDigest(result));
    assert.equal(result.passed, true);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.authority, { kind: "experimental_local", authoritative: false });
    assert.deepEqual(adequacy.executable_dependency_digests,
      await executableDependencyClosure(repositoryRoot, adequacy.executable_module));
    const loaded = await loadExactAdmittedProofPack({
      profileId: pack.profile_id, profileVersion: pack.profile_version
    });
    assert.equal(loaded.profile_digest, admission.profile_digest);
    const companion = await readJson(path.join(runtime,
      "component-exclusion-applicability.json")).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (companion !== null) assertComponentExclusionApplicability(companion, profile, admission);
    totals.definitions += 1;
    totals.controls += result.control_count;
    totals.negatives += result.negative_fixture_count;
    totals.witnesses += result.coverage_witness_count;
    if (pack.profile_id === "proof.verification.test-validity") {
      assert.deepEqual([result.control_count, result.negative_fixture_count,
        result.coverage_witness_count], [10, 9, 9]);
      assert.equal(await readFile(path.join(generatedCertification, "result.json"), "utf8"),
        await readFile(path.join(certification, "result.json"), "utf8"));
      assert.equal(await readFile(path.join(generatedRuntime, "evaluator.mjs"), "utf8"),
        await readFile(path.join(runtime, "evaluator.mjs"), "utf8"));
    }
  }
  assert.equal(totals.definitions, current.length);
  console.log(JSON.stringify(totals));
});
