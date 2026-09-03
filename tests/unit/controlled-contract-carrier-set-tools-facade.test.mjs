import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as facade from
  "../../packages/wiki-core/src/lib/controlled-contract-carrier-set-tools.mjs";

const TESTS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const LIB_DIR = "packages/wiki-core/src/lib";
const MAX_PHYSICAL_LINES = 500;

const EXPECTED_FACADE_EXPORTS = Object.freeze([
  "assertBoundedStringArray",
  "assertCanonicalCarrierSetIsNotFencedLegacy",
  "assertControlledContractCarrierExpectedDigest",
  "assertControlledContractSourceLease",
  "clearControlledContractAuthoringContinuationsForTest",
  "composeSelectedProofPack",
  "deriveCanonicalControlledContractAuthoringState",
  "deriveControlledContractProofPlanBinding",
  "deriveControlledContractSelectedPackEvaluationInputs",
  "getControlledContractAuthoringContinuation",
  "persistedEvaluationInputBindings",
  "projectedSelectedPackCount",
  "publishNewControlledContractCarrierGeneration",
  "readCanonicalProofPlanInputs",
  "readCanonicalProofPlanRequest",
  "readControlledContractAuthoringCarriers",
  "readControlledContractCarrierFile",
  "readControlledContractCarrierSetManifestDigest",
  "rememberControlledContractAuthoringContinuation",
  "resolveCanonicalControlledContractCarrierDirectory",
  "resolveCanonicalControlledContractCarrierSet",
  "resolveCanonicalControlledContractGenerationSelection",
  "resolveControlledContractAuthoringContinuationMutation",
  "resolveControlledContractEvaluationInputBinding",
  "rollbackControlledContractCarrierSetPublication",
  "selectedPackIdentityKey",
  "setCanonicalAuthoringPublisherHookForTest",
  "updateControlledContractAuthoringProofGraphContinuation",
  "validateControlledContractCarrierSetManifest",
  "withCanonicalControlledContractSourceLease",
  "writeControlledContractCarrierFile",
  "writeControlledContractCarrierFileInternal",
  "writeControlledContractCarrierSet"
]);

const RESULTING_PRODUCTION_FILES = Object.freeze([
  "controlled-contract-carrier-set-tools.mjs",
  "controlled-contract-carrier-set-evaluation.mjs",
  "controlled-contract-carrier-set-resolution.mjs",
  "controlled-contract-authoring-continuations.mjs",
  "controlled-contract-authoring-continuation-storage.mjs",
  "controlled-contract-carrier-set-authoring.mjs",
  "controlled-contract-source-lease-primitives.mjs",
  "controlled-contract-source-lease-acquisition.mjs",
  "controlled-contract-carrier-writes.mjs"
].map((name) => `${LIB_DIR}/${name}`));

function physicalLineCount(relativePath) {
  const source = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  const lines = source.split("\n");
  return source.endsWith("\n") ? lines.length - 1 : lines.length;
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function focusKey(focus) {
  return focus ?? "<root>";
}

function carrierStem(wkId, focus) {
  return focus === null ? wkId : `${wkId}-${focus}`;
}

async function createCarrierRepository(t) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "carrier-generation-facade-"));
  await mkdir(path.join(repoRoot, "wiki", "contracts"), { recursive: true });
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  return repoRoot;
}

async function publishClaimGeneration({ repoRoot, wkId, focus = null, claimId, value }) {
  const contracts = path.join(repoRoot, "wiki", "contracts");
  const filename = `${carrierStem(wkId, focus)}.controlled-acceptance.json`;
  const claim = {
    schema_version: "claim-generation-verification-fixture.v1",
    verification_claim_id: claimId,
    observed_value: value
  };
  const bytes = canonicalJsonBytes(claim);
  const contentDigest = sha256(bytes);
  const generation = createHash("sha256")
    .update(`${filename}\0${contentDigest}`, "utf8")
    .digest("hex");
  const generationPath = `.carrier-generations/${generation}`;
  const member = {
    member_kind: "carrier",
    carrier_kind: "contract",
    filename,
    path: `${generationPath}/${filename}`,
    content_digest: contentDigest,
    byte_length: bytes.byteLength
  };
  const manifest = {
    schema_version: "controlled-contract-carrier-set-manifest.v1",
    repository: "facade-generation-test",
    wk_id: wkId,
    focus,
    profile: {
      profile_id: "canonical_authoring",
      profile_version: "1.0.0"
    },
    generation: { id: generation, path: generationPath },
    carriers: [member],
    carrier_census: [member]
  };
  manifest.manifest_digest = sha256(canonicalJsonBytes(manifest));
  const manifestBytes = canonicalJsonBytes(manifest);
  const generationDirectory = path.join(contracts, generationPath);
  await mkdir(generationDirectory, { recursive: true });
  await writeFile(path.join(generationDirectory, filename), bytes);
  await writeFile(path.join(generationDirectory, "manifest.json"), manifestBytes);
  await writeFile(
    path.join(contracts, `${carrierStem(wkId, focus)}.carrier-set-manifest.json`),
    manifestBytes
  );
  return Object.freeze({
    focus,
    generation,
    filename,
    claim,
    contentDigest,
    bytes
  });
}

function assertClaimGenerationSelection(selection, expected, scenario) {
  assert.equal(selection?.schema_version,
    "controlled-contract-manifest-generation-selection.v1",
    `${scenario}: selection must use the generation-selection schema`);
  assert.equal(selection.source, "manifest",
    `${scenario}: claims must come from manifest-selected generations`);
  assert.equal(selection.manifests.length, expected.length,
    `${scenario}: must select every expected generation manifest`);
  assert.equal(selection.descriptors.length, expected.length,
    `${scenario}: must select one carrier for every expected claim`);

  for (const entry of expected) {
    const manifest = selection.manifests.find(
      (candidate) => focusKey(candidate.focus) === focusKey(entry.focus));
    assert.ok(manifest, `${scenario}: missing ${focusKey(entry.focus)} generation`);
    assert.equal(manifest.generation, entry.generation,
      `${scenario}: ${focusKey(entry.focus)} selected the wrong generation`);

    const descriptor = selection.descriptors.find(
      (candidate) => focusKey(candidate.focus) === focusKey(entry.focus));
    assert.ok(descriptor, `${scenario}: missing ${focusKey(entry.focus)} claim carrier`);
    assert.equal(descriptor.path, `wiki/contracts/${entry.filename}`,
      `${scenario}: claim must retain its canonical repository identity`);
    assert.equal(descriptor.content_digest, entry.contentDigest,
      `${scenario}: claim bytes must match the selected manifest member`);
    assert.deepEqual(
      JSON.parse(Buffer.from(descriptor.bytes_base64, "base64").toString("utf8")),
      entry.claim,
      `${scenario}: verification must observe the selected claim content`
    );
  }
}

async function resolveGeneration(repoRoot, wkId) {
  return facade.resolveCanonicalControlledContractGenerationSelection({ repoRoot, wkId });
}

test("carrier-set tools facade preserves the exact pre-extraction export surface", () => {
  assert.deepEqual(Object.keys(facade).sort(), [...EXPECTED_FACADE_EXPORTS].sort());
});

test("carrier-set tools facade and every extracted production module stay under 500 lines", () => {
  for (const file of RESULTING_PRODUCTION_FILES) {
    const lines = physicalLineCount(file);
    assert.ok(lines > 0, `${file} must exist and be non-empty`);
    assert.ok(lines < MAX_PHYSICAL_LINES,
      `${file} is ${lines} physical lines; every production module must be under 500`);
  }
});

test("generation selection verifies a root-only claim population", async (t) => {
  const repoRoot = await createCarrierRepository(t);
  const root = await publishClaimGeneration({
    repoRoot, wkId: "WK-9101", claimId: "claim-root", value: "root-v1"
  });

  assertClaimGenerationSelection(
    await resolveGeneration(repoRoot, "WK-9101"),
    [root],
    "root-only"
  );
});

test("generation selection verifies a focused-only claim population", async (t) => {
  const repoRoot = await createCarrierRepository(t);
  const focused = await publishClaimGeneration({
    repoRoot,
    wkId: "WK-9102",
    focus: "implementation",
    claimId: "claim-focused",
    value: "focused-v1"
  });

  const selection = await resolveGeneration(repoRoot, "WK-9102");
  assertClaimGenerationSelection(selection, [focused], "focused-only");
  assert.equal(selection.manifests.some((entry) => entry.focus === null), false,
    "focused-only: selection must not invent a root generation");
});

test("generation selection verifies root-plus-focused claims together", async (t) => {
  const repoRoot = await createCarrierRepository(t);
  const root = await publishClaimGeneration({
    repoRoot, wkId: "WK-9103", claimId: "claim-root", value: "root-v1"
  });
  const focused = await publishClaimGeneration({
    repoRoot,
    wkId: "WK-9103",
    focus: "implementation",
    claimId: "claim-focused",
    value: "focused-v1"
  });

  assertClaimGenerationSelection(
    await resolveGeneration(repoRoot, "WK-9103"),
    [root, focused],
    "root-plus-focused"
  );
});

test("generation selection tracks focus addition and removal", async (t) => {
  const repoRoot = await createCarrierRepository(t);
  const root = await publishClaimGeneration({
    repoRoot, wkId: "WK-9104", claimId: "claim-root", value: "root-v1"
  });
  const alpha = await publishClaimGeneration({
    repoRoot, wkId: "WK-9104", focus: "alpha", claimId: "claim-alpha", value: "a1"
  });
  assertClaimGenerationSelection(
    await resolveGeneration(repoRoot, "WK-9104"),
    [root, alpha],
    "focus addition alpha"
  );

  const beta = await publishClaimGeneration({
    repoRoot, wkId: "WK-9104", focus: "beta", claimId: "claim-beta", value: "b1"
  });
  assertClaimGenerationSelection(
    await resolveGeneration(repoRoot, "WK-9104"),
    [root, alpha, beta],
    "focus addition beta"
  );

  await unlink(path.join(
    repoRoot, "wiki", "contracts", "WK-9104-alpha.carrier-set-manifest.json"
  ));
  assertClaimGenerationSelection(
    await resolveGeneration(repoRoot, "WK-9104"),
    [root, beta],
    "focus removal alpha"
  );
});

test("generation selection observes selected-focus content movement", async (t) => {
  const repoRoot = await createCarrierRepository(t);
  const before = await publishClaimGeneration({
    repoRoot, wkId: "WK-9105", focus: "scale", claimId: "claim-scale", value: "before"
  });
  assertClaimGenerationSelection(
    await resolveGeneration(repoRoot, "WK-9105"),
    [before],
    "selected focus before movement"
  );

  const after = await publishClaimGeneration({
    repoRoot, wkId: "WK-9105", focus: "scale", claimId: "claim-scale", value: "after"
  });
  const selection = await resolveGeneration(repoRoot, "WK-9105");
  assert.notEqual(after.generation, before.generation,
    "selected-focus movement must create a distinct generation identity");
  assert.notEqual(after.contentDigest, before.contentDigest,
    "selected-focus movement must change the verified claim bytes");
  assertClaimGenerationSelection(selection, [after], "selected focus after movement");
});

test("whole-generation selection prevents root-only masking", async (t) => {
  const repoRoot = await createCarrierRepository(t);
  const root = await publishClaimGeneration({
    repoRoot, wkId: "WK-9106", claimId: "claim-root", value: "root-current"
  });
  const focused = await publishClaimGeneration({
    repoRoot,
    wkId: "WK-9106",
    focus: "security",
    claimId: "claim-security",
    value: "focused-current"
  });
  await writeFile(
    path.join(repoRoot, "wiki", "contracts", root.filename),
    canonicalJsonBytes({ verification_claim_id: "claim-root", observed_value: "stale" })
  );

  const rootSet = await facade.resolveCanonicalControlledContractCarrierSet({
    repoRoot, wkId: "WK-9106", focus: null
  });
  assert.equal(rootSet.members.length, 1,
    "masking fixture must demonstrate that a root-only carrier-set lookup sees one member");
  assertClaimGenerationSelection(
    await resolveGeneration(repoRoot, "WK-9106"),
    [root, focused],
    "root-only masking"
  );
});

test("semantic claim verification kills root-collapse and ignored-focus mutants", async (t) => {
  const repoRoot = await createCarrierRepository(t);
  const root = await publishClaimGeneration({
    repoRoot, wkId: "WK-9107", claimId: "claim-root", value: "root-v1"
  });
  const focused = await publishClaimGeneration({
    repoRoot,
    wkId: "WK-9107",
    focus: "recovery",
    claimId: "claim-recovery",
    value: "focused-v1"
  });
  const selection = await resolveGeneration(repoRoot, "WK-9107");
  assertClaimGenerationSelection(selection, [root, focused], "mutation baseline");

  const rootCollapseMutant = {
    ...selection,
    manifests: selection.manifests.filter((entry) => entry.focus === null),
    descriptors: selection.descriptors.filter((entry) => entry.focus === null)
  };
  assert.throws(
    () => assertClaimGenerationSelection(
      rootCollapseMutant, [root, focused], "root-collapse mutant"
    ),
    (error) => error instanceof assert.AssertionError &&
      error.message.includes("root-collapse mutant"),
    "claim verification must kill a generation selector collapsed to root"
  );

  const ignoredFocusMutant = {
    ...selection,
    descriptors: selection.descriptors.filter((entry) => entry.focus === null)
  };
  assert.throws(
    () => assertClaimGenerationSelection(
      ignoredFocusMutant, [root, focused], "ignored-focus mutant"
    ),
    (error) => error instanceof assert.AssertionError &&
      error.message.includes("ignored-focus mutant"),
    "claim verification must kill a selector that ignores a selected focused carrier"
  );
});
