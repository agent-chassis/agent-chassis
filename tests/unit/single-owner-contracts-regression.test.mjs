import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES,
  ControlledContractCarrierSetManifestError,
  canonicalControlledContractCarrierSetManifestBytes,
  constructControlledContractCarrierSetManifest,
  parseControlledContractCarrierSetManifest
} from "../../packages/wiki-core/src/lib/controlled-contract-carrier-set-manifest.mjs";
import {
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest
} from "../../packages/wiki-core/src/index.mjs";
import {
  TerminalReviewContractBindingError,
  compareTerminalReviewContractBindingIdentity,
  computeTerminalReviewContractBindingDigest,
  constructTerminalReviewContractBinding,
  sameTerminalReviewContractBinding
} from "../../packages/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs";
import { readCanonicalContractGenerationIdentity } from
  "../../packages/agent-launch-cli/src/lib/slice-integration-authorization.mjs";
import { publishNewControlledContractCarrierGeneration } from
  "../../packages/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const GENERATION_A = "b".repeat(64);

function manifestMember(wkId, focus, generation = GENERATION_A, contentDigest = DIGEST_A) {
  const basename = `${wkId}${focus === null ? "" : `-${focus}`}.controlled-acceptance.json`;
  return {
    member_kind: "carrier",
    carrier_kind: "contract",
    filename: basename,
    path: `.carrier-generations/${generation}/${basename}`,
    content_digest: contentDigest,
    byte_length: 7
  };
}

function manifest(wkId = "WK-2271", focus = null) {
  return constructControlledContractCarrierSetManifest({
    repository: "agent-chassis/agent-chassis",
    wkId,
    focus,
    profile: { profile_id: "canonical_authoring", profile_version: "1.0.0" },
    generation: GENERATION_A,
    generationPath: `.carrier-generations/${GENERATION_A}`,
    members: [manifestMember(wkId, focus)]
  });
}

function manifestRefusal(value, code) {
  assert.throws(
    () => parseControlledContractCarrierSetManifest(value),
    (error) => error instanceof ControlledContractCarrierSetManifestError && error.code === code
  );
}

test("root and focused carrier-set manifests share one strict pure parser", () => {
  for (const [wkId, focus] of [["WK-2271", null], ["WK-2271", "proof-focus"]]) {
    const value = manifest(wkId, focus);
    const parsed = parseControlledContractCarrierSetManifest(
      canonicalControlledContractCarrierSetManifestBytes(value), { wkId, focus });
    assert.deepEqual(parsed, value);
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.carrier_census), true);
  }
});

test("slice-integration observation authenticates root and focused manifests through the owner", (t) => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "single-manifest-owner-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const contracts = path.join(repo, "wiki", "contracts");
  mkdirSync(contracts, { recursive: true });
  const carrierBytes = Buffer.from("{\"x\":1}");
  const contentDigest = `sha256:${createHash("sha256").update(carrierBytes).digest("hex")}`;
  for (const [focus, generation] of [[null, "b".repeat(64)], ["proof-focus", "c".repeat(64)]]) {
    const member = manifestMember("WK-2271", focus, generation, contentDigest);
    const value = constructControlledContractCarrierSetManifest({
      repository: "agent-chassis/agent-chassis",
      wkId: "WK-2271",
      focus,
      profile: { profile_id: "canonical_authoring", profile_version: "1.0.0" },
      generation,
      generationPath: `.carrier-generations/${generation}`,
      members: [member]
    });
    const generationDirectory = path.join(contracts, ".carrier-generations", generation);
    mkdirSync(generationDirectory, { recursive: true });
    writeFileSync(path.join(generationDirectory, member.filename), carrierBytes);
    const manifestBytes = canonicalControlledContractCarrierSetManifestBytes(value);
    writeFileSync(path.join(generationDirectory, "manifest.json"), manifestBytes);
    const stem = focus === null ? "WK-2271" : `WK-2271-${focus}`;
    writeFileSync(path.join(contracts, `${stem}.carrier-set-manifest.json`), manifestBytes);
  }
  const identity = readCanonicalContractGenerationIdentity(repo, "WK-2271");
  assert.equal(identity.state, "present");
  assert.equal(identity.carrier_count, 2);
  assert.deepEqual(identity.manifest_digests.map(({ path: manifestPath }) => manifestPath), [
    "wiki/contracts/WK-2271-proof-focus.carrier-set-manifest.json",
    "wiki/contracts/WK-2271.carrier-set-manifest.json"
  ].sort());
});

test("manifest owner refuses malformed, contradictory, incomplete, reordered, and wrong bytes", () => {
  manifestRefusal(Buffer.from("{bad\n"),
    CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED_JSON);

  const wrongSchema = structuredClone(manifest());
  wrongSchema.schema_version = "controlled-contract-carrier-set-manifest.v0";
  manifestRefusal(wrongSchema, CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY);

  assert.throws(() => parseControlledContractCarrierSetManifest(manifest(), {
    wkId: "WK-9999", focus: null
  }), (error) => error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY);
  assert.throws(() => parseControlledContractCarrierSetManifest(manifest(), {
    wkId: "WK-2271", focus: "wrong-focus"
  }), (error) => error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY);

  const wrongPath = structuredClone(manifest());
  wrongPath.generation.path = ".carrier-generations/wrong";
  manifestRefusal(wrongPath, CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY);

  const censusMismatch = structuredClone(manifest());
  censusMismatch.carrier_census[0].byte_length += 1;
  manifestRefusal(censusMismatch, CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY);

  const duplicate = structuredClone(manifest());
  duplicate.carriers.push(structuredClone(duplicate.carriers[0]));
  duplicate.carrier_census.push(structuredClone(duplicate.carrier_census[0]));
  manifestRefusal(duplicate, CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER);

  const second = manifestMember("WK-2271", null);
  second.carrier_kind = "proof_plan";
  second.filename = "WK-2271.proof-plan.json";
  second.path = `.carrier-generations/${GENERATION_A}/${second.filename}`;
  const ordered = constructControlledContractCarrierSetManifest({
    repository: "agent-chassis/agent-chassis",
    wkId: "WK-2271",
    profile: { profile_id: "canonical_authoring", profile_version: "1.0.0" },
    generation: GENERATION_A,
    generationPath: `.carrier-generations/${GENERATION_A}`,
    members: [manifestMember("WK-2271", null), second].sort((left, right) =>
      left.filename.localeCompare(right.filename))
  });
  const reordered = structuredClone(ordered);
  reordered.carriers.reverse();
  reordered.carrier_census.reverse();
  manifestRefusal(reordered, CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER);

  const wrongDigest = structuredClone(manifest());
  wrongDigest.manifest_digest = `sha256:${"0".repeat(64)}`;
  manifestRefusal(wrongDigest, CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.DIGEST);

  const noncanonicalBytes = Buffer.concat([
    canonicalControlledContractCarrierSetManifestBytes(manifest()), Buffer.from(" \n")
  ]);
  manifestRefusal(noncanonicalBytes, CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY);
});

test("canonical work-record source digest ignores generated evidence and moves on authored change", () => {
  const record = {
    schema_version: "work-record.v1",
    id: "WK-2271",
    initiative: "IN-0030",
    title: "single owner"
  };
  const generated = {
    ...record,
    derived_evidence: { generated: true, values: [1, 2] },
    projections: [{ kind: "generated", source_digest: DIGEST_A }]
  };
  assert.equal(computeWorkRecordSourceDigest(generated), computeWorkRecordSourceDigest(record));
  assert.notEqual(computeWorkRecordSourceDigest({ ...record, title: "authored movement" }),
    computeWorkRecordSourceDigest(record));
});

function reviewBinding(overrides = {}) {
  const reviewSliceId = overrides.reviewSliceId ?? "SLICE-009";
  const recordId = overrides.recordId ?? "WK-2271";
  return constructTerminalReviewContractBinding({
    recordId,
    initiative: overrides.initiative ?? "IN-0030",
    reviewSliceId,
    reviewSubject: overrides.reviewSubject ?? `${recordId}#${reviewSliceId}`,
    reviewUnitContract: overrides.reviewUnitContract ?? canonicalizeWorkRecordJson({
      id: reviewSliceId,
      work_kind: "review",
      acceptance: { criteria: ["findings only"], validation: [] }
    })
  });
}

test("terminal-review binding owner constructs, digests, and compares the exact contract", () => {
  const base = reviewBinding();
  const repeated = reviewBinding();
  const identity = {
    reviewSubject: base.review_subject,
    reviewContractDigest: computeTerminalReviewContractBindingDigest(base)
  };
  assert.equal(sameTerminalReviewContractBinding(base, repeated), true);
  assert.deepEqual(compareTerminalReviewContractBindingIdentity(repeated, identity), {
    current: true,
    reason: null
  });
  for (const moved of [
    reviewBinding({ initiative: "IN-0099" }),
    reviewBinding({ reviewSliceId: "SLICE-010" }),
    reviewBinding({ reviewUnitContract: canonicalizeWorkRecordJson({
      id: "SLICE-009", work_kind: "review", acceptance: { criteria: ["changed"], validation: [] }
    }) })
  ]) {
    assert.notEqual(computeTerminalReviewContractBindingDigest(moved),
      computeTerminalReviewContractBindingDigest(base));
  }
  assert.throws(() => reviewBinding({ reviewSubject: "WK-2271#SLICE-010" }),
    TerminalReviewContractBindingError);
});

function productionMjsFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionMjsFiles(target);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [target] : [];
  });
}

function assertPublicationManifestSerializationOwned(source) {
  assert.match(source,
    /import\s*\{[\s\S]*canonicalControlledContractCarrierSetManifestBytes[\s\S]*\}\s*from\s*"\.\/controlled-contract-carrier-set-manifest\.mjs";/u);
  assert.doesNotMatch(source, /canonicalJsonBytes\s*\(\s*(?:manifest|value)\s*\)/u);
  assert.doesNotMatch(source,
    /(?:JSON\.stringify|Buffer\.from)\s*\([^\n]*(?:manifest|carrier-set-manifest)/iu);
  assert.equal(
    [...source.matchAll(/canonicalControlledContractCarrierSetManifestBytes\s*\(/gu)].length,
    4,
    "every authoring, integration-capture, comparison, and validation path must call the owner"
  );
}

test("publication writes owner-canonical manifest bytes and a local serializer mutation is rejected", async (t) => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "single-manifest-publication-owner-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(path.join(repo, "wiki", "contracts"), { recursive: true });
  const contract = JSON.parse(readFileSync(
    path.join(ROOT, "wiki/contracts/WK-2271.controlled-acceptance.json"), "utf8"));
  const receipt = await publishNewControlledContractCarrierGeneration({
    repoRoot: repo,
    wkId: "WK-2271",
    repository: "agent-chassis/agent-chassis",
    members: { "WK-2271.controlled-acceptance.json": contract }
  });
  const visiblePath = path.join(repo, "wiki", "contracts", receipt.manifest_basename);
  const visibleBytes = readFileSync(visiblePath);
  const visibleManifest = parseControlledContractCarrierSetManifest(visibleBytes, {
    wkId: "WK-2271", focus: null
  });
  const ownerBytes = canonicalControlledContractCarrierSetManifestBytes(visibleManifest);
  assert.deepEqual(visibleBytes, ownerBytes);
  assert.deepEqual(readFileSync(path.join(
    repo, "wiki", "contracts", visibleManifest.generation.path, "manifest.json"
  )), ownerBytes);
  assert.equal(receipt.manifest_content_digest,
    `sha256:${createHash("sha256").update(ownerBytes).digest("hex")}`);

  const publicationPath = path.join(ROOT,
    "packages/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs");
  const publicationSource = readFileSync(publicationPath, "utf8");
  assertPublicationManifestSerializationOwned(publicationSource);
  const localSerializerMutation = publicationSource.replace(
    "const manifestBytes = canonicalControlledContractCarrierSetManifestBytes(manifest);",
    "const manifestBytes = canonicalJsonBytes(manifest);"
  );
  assert.notEqual(localSerializerMutation, publicationSource,
    "the falsifier must mutate a real publication path");
  assert.throws(() => assertPublicationManifestSerializationOwned(localSerializerMutation));
});

test("production ownership search finds one implementation for each corrected contract", () => {
  const files = productionMjsFiles(path.join(ROOT, "packages"));
  const sources = files.map((file) => [file, readFileSync(file, "utf8")]);
  const manifestOwners = sources.filter(([, source]) =>
    source.includes('"controlled-contract-carrier-set-manifest.v1"'));
  const bindingOwners = sources.filter(([, source]) =>
    source.includes('"agent_launch.terminal_review_contract_binding.v1"'));
  const digestOwners = sources.filter(([, source]) =>
    /function computeWorkRecordSourceDigest\s*\(/u.test(source));
  assert.deepEqual(manifestOwners.map(([file]) => path.relative(ROOT, file)), [
    "packages/wiki-core/src/lib/controlled-contract-carrier-set-manifest.mjs"
  ]);
  assert.deepEqual(bindingOwners.map(([file]) => path.relative(ROOT, file)), [
    "packages/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs"
  ]);
  assert.deepEqual(digestOwners.map(([file]) => path.relative(ROOT, file)), [
    "packages/wiki-core/src/lib/work-record-schema.mjs"
  ]);
  assertPublicationManifestSerializationOwned(readFileSync(path.join(ROOT,
    "packages/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs"), "utf8"));
});
