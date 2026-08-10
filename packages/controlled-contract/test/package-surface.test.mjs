import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const packageRoot = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

function childEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(entryPath));
    else result.push(entryPath);
  }
  return result;
}

test("the published package exposes bounded assessment and selection commands and no development surface", async () => {
  const manifest = JSON.parse(await readFile(
    path.join(packageRoot, "package.json"), "utf8"
  ));
  assert.deepEqual(manifest.exports["."], {
    types: "./current.d.mts",
    default: "./current.mjs"
  });
  assert.deepEqual(manifest.exports["./current.mjs"],
    manifest.exports["."]);
  assert.deepEqual(manifest.bin, {
    "controlled-contract": "bin/assess-contract.mjs",
    "controlled-contract-build-proof-plan": "bin/build-proof-plan.mjs",
    "controlled-contract-describe-proof-pack": "bin/describe-proof-pack.mjs",
    "controlled-contract-discover-proof-intents": "bin/discover-proof-intents.mjs",
    "controlled-contract-inspect-proof-pack-bindings":
      "bin/inspect-proof-pack-bindings.mjs",
    "controlled-contract-select-proof-packs": "bin/select-proof-packs.mjs"
  });
  const published = manifest.files.join("\n");
  for (const excluded of [
    "experimental/", "versions/", "test/**", "adequacy.json",
    "negative-fixtures", "witness-profile-weakenings",
    "controlled-contract-assessment.experimental.v0.1.schema.json"
  ]) assert.doesNotMatch(published, new RegExp(excluded.replace("*", "\\*"), "u"));
  assert.equal(
    manifest.files.includes("schema/controlled-contract-assessment.v1.schema.json"),
    true
  );
  for (const required of [
    "current.d.mts",
    "proof-intents/catalog.json",
    "schema/controlled-contract-proof-intent-catalog.v1.schema.json",
    "schema/controlled-contract-proof-intent-discovery.v1.schema.json",
    "schema/controlled-contract-proof-pack-binding-assistance.v1.schema.json",
    "schema/controlled-contract-proof-pack-authoring.v1.schema.json",
    "schema/controlled-contract-proof-plan-request.v1.schema.json",
    "schema/controlled-contract-proof-plan.v1.schema.json",
    "schema/controlled-contract-multi-pack-assessment.v1.schema.json"
  ]) assert.equal(manifest.files.includes(required), true, required);
  assert.equal(
    manifest.files.includes("lib/deterministic-projection.mjs"),
    true,
    "the package-owned deterministic transformer must ship with admitted users"
  );
  const topLevelDirectories = (await readdir(packageRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map(({ name }) => name);
  for (const retired of ["experimental", "versions", "docs", "prompts"]) {
    assert.equal(topLevelDirectories.includes(retired), false);
  }
});

test("runtime profiles contain only compact admitted artifacts", async () => {
  const profilesRoot = path.join(packageRoot, "profiles");
  const catalog = JSON.parse(await readFile(
    path.join(profilesRoot, "catalog.json"), "utf8"
  ));
  for (const pack of catalog.packs) {
    const directory = path.join(packageRoot, pack.path);
    const admission = JSON.parse(await readFile(
      path.join(directory, "admission.json"), "utf8"
    ));
    const names = (await readdir(directory)).sort();
    const expected = [
      "admission.json", "evaluation-input.template.json", "profile.json"
    ];
    if (admission.schema_version === "controlled-contract-admitted-proof-pack.v2") {
      expected.push("exact-binding-certification.json", "exact-binding.json");
      expected.sort();
    }
    assert.deepEqual(names, expected, pack.profile_id);
  }
  assert.ok(catalog.packs.length > 0);
});

test("the public current surface exposes selection and zero/one/many assessment", async () => {
  const current = await import("../current.mjs");
  assert.equal(typeof current.assessContractFiles, "function");
  assert.equal(typeof current.assessExactBoundContractFiles, "function");
  assert.equal(typeof current.assessStructuralContractFile, "function");
  assert.equal(typeof current.selectProofPacks, "function");
  assert.equal(typeof current.discoverProofIntents, "function");
  assert.equal(typeof current.canonicalProofIntentDiscoveryJson, "function");
  assert.equal(typeof current.inspectProofPackBindings, "function");
  assert.equal(typeof current.canonicalProofPackBindingAssistanceJson, "function");
  assert.equal(typeof current.buildProofPlan, "function");
  assert.equal(typeof current.buildProofPlanFiles, "function");
  assert.equal(typeof current.canonicalProofPlanJson, "function");
  assert.equal(typeof current.describeProofPackAuthoring, "function");
  assert.equal(typeof current.assessProofPlan, "function");
  assert.equal(typeof current.assessProofPlanFiles, "function");
  assert.equal("createSinglePackProofPlan" in current, false);
});

test("the public current declaration exposes discovery types and values", async () => {
  const declaration = await readFile(
    path.join(packageRoot, "current.d.mts"), "utf8"
  );
  for (const name of [
    "ProofIntentDiscoveryError",
    "canonicalProofIntentDiscoveryJson",
    "discoverProofIntents",
    "ProofPackBindingAssistanceError",
    "canonicalProofPackBindingAssistanceJson",
    "inspectProofPackBindings",
    "ProofPlanCompilerError",
    "buildProofPlan",
    "buildProofPlanFiles",
    "canonicalProofPlanJson"
  ]) assert.match(declaration, new RegExp(`\\b${name}\\b`, "u"), name);
});

test("published runtime modules cannot import certification or test code", async () => {
  const sources = [
    ...await filesBelow(path.join(packageRoot, "lib")),
    path.join(packageRoot, "bin", "assess-contract.mjs"),
    path.join(packageRoot, "bin", "build-proof-plan.mjs"),
    path.join(packageRoot, "bin", "discover-proof-intents.mjs"),
    path.join(packageRoot, "bin", "inspect-proof-pack-bindings.mjs"),
    path.join(packageRoot, "bin", "describe-proof-pack.mjs"),
    path.join(packageRoot, "bin", "select-proof-packs.mjs"),
    path.join(packageRoot, "bin", "check-contract.mjs"),
    path.join(packageRoot, "current.mjs")
  ].filter((file) => file.endsWith(".mjs"));
  for (const file of sources) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /(?:^|["'])\.\.\/test\//mu, file);
    assert.doesNotMatch(source, /test\/certification|negative-fixtures|coverage-witness/u,
      file);
  }
});

test("the publication dry run ships discovery runtime and excludes test corpora", async () => {
  const { stdout } = await execFileAsync("npm", [
    "pack", "--dry-run", "--json", "--ignore-scripts"
  ], {
    cwd: packageRoot,
    env: childEnvironment(),
    maxBuffer: 4 * 1024 * 1024
  });
  const publication = JSON.parse(stdout)[0];
  const names = new Set(publication.files.map(({ path: file }) => file));
  for (const required of [
    "current.d.mts",
    "bin/discover-proof-intents.mjs",
    "lib/proof-intent-discovery.mjs",
    "lib/proof-intent-discovery.d.mts",
    "schema/controlled-contract-proof-intent-discovery.v1.schema.json",
    "bin/inspect-proof-pack-bindings.mjs",
    "lib/proof-pack-binding-assistance.mjs",
    "lib/proof-pack-binding-assistance.d.mts",
    "schema/controlled-contract-proof-pack-binding-assistance.v1.schema.json",
    "bin/build-proof-plan.mjs",
    "lib/proof-plan-compiler.mjs",
    "lib/proof-plan-compiler.d.mts",
    "schema/controlled-contract-proof-plan-request.v1.schema.json"
  ]) assert.equal(names.has(required), true, required);
  for (const name of names) {
    assert.doesNotMatch(name, /(?:^|\/)test(?:\/|$)/u);
    assert.doesNotMatch(name, /(?:^|\/)certification(?:\/|$)/u);
    assert.doesNotMatch(name,
      /negative-fixtures|coverage-witness|adequacy\.json/u);
    assert.doesNotMatch(name,
      /(?:adequacy|fixture|witness|corpus)[^/]*\.mjs$/u);
  }
});
